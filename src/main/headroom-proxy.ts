import { spawn, ChildProcess, execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import * as http from 'http'

export interface HeadroomStatus {
  running: boolean
  port: number
  error: string | null
}

export const HEADROOM_DEFAULT_PORT = 8787
// Hermes speaks the Anthropic Messages protocol but against MiniMax's
// `/anthropic` upstream, not api.anthropic.com — so it needs its own proxy
// instance pointed at MiniMax via ANTHROPIC_TARGET_API_URL.
export const HEADROOM_MINIMAX_PORT = 8788
export const HEADROOM_MINIMAX_TARGET = 'https://api.minimax.io/anthropic'

// Resolve the `headroom` executable: an explicit configured path first, then the
// PATH, then the conventional pipx/venv location used by the install docs.
function resolveHeadroomBin(explicitPath?: string): string | null {
  if (explicitPath && existsSync(explicitPath)) return explicitPath

  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const found = execFileSync(which, ['headroom'], { encoding: 'utf8' })
      .split(/\r?\n/)[0]
      ?.trim()
    if (found && existsSync(found)) return found
  } catch {
    /* not on PATH */
  }

  const venvBin = join(
    homedir(),
    '.local',
    'headroom-venv',
    'bin',
    process.platform === 'win32' ? 'headroom.exe' : 'headroom'
  )
  if (existsSync(venvBin)) return venvBin

  return null
}

// Spawns and supervises one `headroom proxy` child process on a fixed port,
// optionally with extra env (e.g. ANTHROPIC_TARGET_API_URL) to point it at a
// non-default upstream.
class ProxyInstance {
  private proc: ChildProcess | null = null
  private lastError: string | null = null
  private starting = false

  constructor(
    private label: string,
    private port: number,
    private extraEnv: Record<string, string> = {}
  ) {}

  isRunning(): boolean {
    return this.proc !== null && this.proc.exitCode === null
  }

  getStatus(): HeadroomStatus {
    return { running: this.isRunning(), port: this.port, error: this.lastError }
  }

  async start(binPath: string): Promise<void> {
    if (this.starting || this.isRunning()) return
    this.starting = true
    this.lastError = null

    try {
      this.proc = spawn(
        binPath,
        // Two opt-in compression levers, both safe because headroom's CCR keeps
        // originals retrievable (the model can fetch full content on demand) and
        // both are type-aware rather than truncating:
        //   --intercept-tool-results  routes accumulated/stale tool outputs and
        //     file-reads (the bulk of a coding session) to the compressors while
        //     the router preserves the latest message and recent context.
        //   --code-aware  AST-based code compression: keeps imports, signatures
        //     and types, compresses function bodies. Needs the tree-sitter dep,
        //     which is present in the headroom venv.
        // Default-off conservative mode only nets ~12%; with these the author's
        // own measurements put a full session near ~47% with accuracy held.
        [
          'proxy',
          '--host', '127.0.0.1',
          '--port', String(this.port),
          '--intercept-tool-results',
          '--code-aware',
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          // Put the headroom binary's own venv/bin first on PATH so the
          // tool-result interceptor finds the `ast-grep` shipped alongside it
          // rather than the unrelated shadow-utils `sg` in /usr/bin.
          env: {
            ...process.env,
            PATH: `${join(binPath, '..')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
            // Compress `user`-role messages too. Off by default in headroom
            // because user content sits in the prefix-cache zone — but in the
            // Anthropic format a coding session's bulk (conversation history and
            // tool_result blocks) lives in user messages, so leaving it off caps
            // session-average compression near ~8%. Enabling it is what lands the
            // session average around the ~50% token-reduction target; the cost is
            // some prefix-cache hits (cheaper cache-reads traded for recompute).
            HEADROOM_COMPRESS_USER_MESSAGES: '1',
            // Aggressive thresholds: crush every payload and outline every file
            // read regardless of size (defaults are 500 tokens / 500 chars).
            // Maximises eligible content at the cost of extra per-request CPU.
            HEADROOM_MIN_TOKENS: '1',
            HEADROOM_INTERCEPT_READ_MIN_CHARS: '1',
            ...this.extraEnv,
          },
        }
      )
      const tag = `[headroom:${this.label}]`
      this.proc.stdout?.on('data', (d) => console.log(tag, d.toString().trimEnd()))
      this.proc.stderr?.on('data', (d) => console.log(tag, d.toString().trimEnd()))
      this.proc.on('exit', (code) => {
        console.log(`${tag} proxy exited with code`, code)
        this.proc = null
        if (code && code !== 0 && !this.lastError) {
          this.lastError = `proxy exited with code ${code}`
        }
      })
      this.proc.on('error', (e) => {
        this.lastError = String(e)
        this.proc = null
      })

      await this.waitReady(15000)
    } catch (e) {
      this.lastError = String(e)
    } finally {
      this.starting = false
    }
  }

  // Poll the proxy's HTTP port until it answers (or it dies / times out).
  private waitReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    return new Promise((resolve) => {
      const tick = (): void => {
        if (!this.isRunning()) return resolve()
        const req = http.get(
          { host: '127.0.0.1', port: this.port, path: '/livez', timeout: 1000 },
          (res) => {
            res.resume()
            resolve()
          }
        )
        req.on('error', () => {
          if (Date.now() > deadline) return resolve()
          setTimeout(tick, 300)
        })
        req.on('timeout', () => {
          req.destroy()
          if (Date.now() > deadline) resolve()
          else setTimeout(tick, 300)
        })
      }
      tick()
    })
  }

  stop(): void {
    if (this.proc) {
      try {
        this.proc.kill()
      } catch {
        /* already gone */
      }
      this.proc = null
    }
  }
}

// Supervises the headroom proxy instances: a primary instance for the
// Anthropic/OpenAI default upstreams, plus a MiniMax-targeted instance so
// Hermes can be compressed without breaking the primary's routing.
export class HeadroomProxyManager {
  private primary: ProxyInstance | null = null
  private minimax: ProxyInstance | null = null
  private port = HEADROOM_DEFAULT_PORT
  private minimaxPort = HEADROOM_MINIMAX_PORT
  private binPath?: string
  private lastError: string | null = null

  constructor(
    private onState?: (status: HeadroomStatus) => void
  ) {}

  getStatus(): HeadroomStatus {
    // Report the primary instance; minimax errors are logged, not surfaced.
    const running = this.primary?.isRunning() ?? false
    return { running, port: this.port, error: this.lastError }
  }

  // Reconcile the running proxies with the desired config. Starts or stops the
  // primary and minimax instances as needed; restarts on port/path change.
  async ensure(cfg: {
    enabled: boolean
    port?: number
    minimaxPort?: number
    binPath?: string
  }): Promise<void> {
    if (!cfg.enabled) {
      this.stop()
      return
    }

    const port = cfg.port ?? HEADROOM_DEFAULT_PORT
    const minimaxPort = cfg.minimaxPort ?? HEADROOM_MINIMAX_PORT
    const configChanged =
      this.port !== port || this.minimaxPort !== minimaxPort || this.binPath !== cfg.binPath
    if (this.primary?.isRunning() && !configChanged) return

    this.stop()
    this.port = port
    this.minimaxPort = minimaxPort
    this.binPath = cfg.binPath
    this.lastError = null

    const bin = resolveHeadroomBin(this.binPath)
    if (!bin) {
      this.lastError =
        'headroom executable not found — install headroom-ai or set the proxy path in Settings'
      this.emit()
      return
    }

    this.primary = new ProxyInstance('primary', this.port)
    this.minimax = new ProxyInstance('minimax', this.minimaxPort, {
      ANTHROPIC_TARGET_API_URL: HEADROOM_MINIMAX_TARGET,
    })

    await Promise.all([this.primary.start(bin), this.minimax.start(bin)])
    this.lastError = this.primary.getStatus().error
    this.emit()
  }

  stop(): void {
    this.primary?.stop()
    this.minimax?.stop()
    this.primary = null
    this.minimax = null
    this.emit()
  }

  private emit(): void {
    this.onState?.(this.getStatus())
  }
}
