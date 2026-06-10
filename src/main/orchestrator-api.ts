import * as http from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import { mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import type { BrowserWindow } from 'electron'
import type { PtyManager } from './pty-manager.js'
import type { SessionStore } from './session-store.js'
import { validateWithinProjectRoots } from './mobile-security/index.js'
import { DebugApi } from './debug-api.js'

const ORCHESTRATOR_PORT = 19836

// M2: per-launch shared secret. The orchestrator API is localhost-only, but on a
// multi-user host or against another malicious local process "localhost" is not a
// trust boundary. Both this API and the stdio MCP shim (scripts/orchestrator-mcp.mjs)
// derive the same file path (plain Node, no Electron), so the shim can read the
// secret the app writes. File is 0600 in a 0700 dir.
// Secrets are per-port (orchestrator-secret-<port>) so multiple instances (e.g.
// an isolated test instance on 19837, see docs/agent-debug-testing.md) don't
// clobber each other's secret. The legacy un-suffixed file is still written for
// the base port as a fallback for older shim copies.
// ORCHESTRATOR_SECRET_DIR env override lets an isolated test environment (fake
// HOME, see scripts/test-env.sh) still write its secret where the MCP shim
// running under the real HOME can find it.
const ORCHESTRATOR_SECRET_DIR = process.env.ORCHESTRATOR_SECRET_DIR || join(homedir(), '.claude-terminal')
const ORCHESTRATOR_SECRET_FILE = join(ORCHESTRATOR_SECRET_DIR, 'orchestrator-secret')

function orchestratorSecretFileForPort(port: number): string {
  return join(ORCHESTRATOR_SECRET_DIR, `orchestrator-secret-${port}`)
}

function provisionOrchestratorSecret(port: number): string {
  const secret = randomBytes(32).toString('hex')
  mkdirSync(ORCHESTRATOR_SECRET_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(orchestratorSecretFileForPort(port), secret, { mode: 0o600 })
  if (port === ORCHESTRATOR_PORT) {
    writeFileSync(ORCHESTRATOR_SECRET_FILE, secret, { mode: 0o600 })
  }
  return secret
}

function secretMatches(expected: string, provided?: string | string[]): boolean {
  if (!expected || !provided) return false
  const got = Array.isArray(provided) ? provided[0] : provided
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function flattenLeaves(node: any): { id: string; tabIds: string[]; activeTabId: string }[] {
  if (!node) return []
  if (node.type === 'leaf') return [{ id: node.id, tabIds: node.tabIds ?? [], activeTabId: node.activeTabId }]
  return (node.children ?? []).flatMap(flattenLeaves)
}
const MAX_PORT_RETRIES = 5

export class OrchestratorApi {
  private server: http.Server | null = null
  private ptyManager: PtyManager
  private ptyToProject: Map<string, string>
  private ptyToBackend: Map<string, string>
  private sessionStore: SessionStore
  private getMainWindow: () => BrowserWindow | null
  private activePort: number = ORCHESTRATOR_PORT
  private secret: string = ''
  readonly debugApi: DebugApi

  constructor(
    ptyManager: PtyManager,
    ptyToProject: Map<string, string>,
    ptyToBackend: Map<string, string>,
    sessionStore: SessionStore,
    getMainWindow: () => BrowserWindow | null,
  ) {
    this.ptyManager = ptyManager
    this.ptyToProject = ptyToProject
    this.ptyToBackend = ptyToBackend
    this.sessionStore = sessionStore
    this.getMainWindow = getMainWindow
    this.debugApi = new DebugApi(ptyManager, sessionStore, getMainWindow)
  }

  start(): void {
    if (this.server) return

    this.activePort = ORCHESTRATOR_PORT

    this.server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')

      // Only allow localhost
      const remote = req.socket.remoteAddress
      if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
        res.writeHead(403)
        res.end(JSON.stringify({ error: 'Forbidden' }))
        return
      }

      // M2: require the per-launch shared secret. Localhost alone is not a trust
      // boundary against other local processes / users on the same machine.
      if (!this.secret || !secretMatches(this.secret, req.headers['x-orchestrator-secret'])) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }

      const url = new URL(req.url || '/', `http://localhost:${this.activePort}`)
      const path = url.pathname

      // Match: /sessions/:id/output or /sessions/:id/input
      const sessionMatch = path.match(/^\/sessions\/([^/]+)\/(output|input)$/)
      // Match: /sessions/:id (for DELETE)
      const sessionIdMatch = path.match(/^\/sessions\/([^/]+)$/)

      if (req.method === 'GET' && path === '/tiles') {
        this.handleListTiles(res)
      } else if (req.method === 'GET' && path === '/sessions') {
        this.handleListSessions(res)
      } else if (req.method === 'POST' && path === '/sessions') {
        this.handleCreateSession(req, res)
      } else if (req.method === 'DELETE' && sessionIdMatch) {
        this.handleDeleteSession(sessionIdMatch[1], res)
      } else if (req.method === 'GET' && sessionMatch?.[2] === 'output') {
        const maxLines = parseInt(url.searchParams.get('lines') || '50', 10)
        this.handleReadOutput(sessionMatch[1], maxLines, res).catch(err => {
          console.error('[Orchestrator] readOutput error:', err)
          if (!res.headersSent) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: 'Internal error' }))
          }
        })
      } else if (req.method === 'POST' && sessionMatch?.[2] === 'input') {
        this.handleSendInput(sessionMatch[1], req, res)
      } else if (path.startsWith('/debug/')) {
        this.debugApi.handle(req, res, url)
      } else {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Not found' }))
      }
    })

    this.tryListen(this.activePort)
  }

  private tryListen(port: number): void {
    const retryCount = port - ORCHESTRATOR_PORT
    if (retryCount >= MAX_PORT_RETRIES) {
      console.error(`[Orchestrator] Failed to bind after ${MAX_PORT_RETRIES} attempts (ports ${ORCHESTRATOR_PORT}-${port - 1})`)
      this.server?.close()
      this.server = null
      return
    }

    this.server!.listen(port, '127.0.0.1', () => {
      // listen() callbacks from failed earlier attempts stay attached and all
      // fire on the eventual successful bind — only act in the one whose
      // closure port matches the port actually bound.
      const address = this.server?.address()
      const boundPort = typeof address === 'object' && address ? address.port : port
      if (boundPort !== port) return
      this.activePort = port
      // Provision the secret only once the port is actually bound, so each
      // instance writes its own per-port secret file.
      try {
        this.secret = provisionOrchestratorSecret(port)
      } catch (e) {
        console.error('[Orchestrator] Failed to provision API secret:', e)
        this.secret = ''
      }
      console.log(`[Orchestrator] API server started on port ${port}`)
    })

    this.server!.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        console.warn(`[Orchestrator] Port ${port} in use, trying ${port + 1}`)
        this.tryListen(port + 1)
      } else {
        console.error('[Orchestrator] API server error:', e.message)
        this.server?.close()
        this.server = null
      }
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
    try {
      unlinkSync(orchestratorSecretFileForPort(this.activePort))
    } catch {
      // best-effort cleanup; stale files are overwritten on next bind
    }
  }

  private handleListSessions(res: http.ServerResponse): void {
    const sessions = this.ptyManager.listSessions()
    const enriched = sessions.map(s => ({
      ...s,
      projectPath: this.ptyToProject.get(s.id) || s.cwd,
      projectName: (this.ptyToProject.get(s.id) || s.cwd).split('/').pop() || 'unknown',
    }))
    res.writeHead(200)
    res.end(JSON.stringify({ sessions: enriched }))
  }

  private handleListTiles(res: http.ServerResponse): void {
    const workspace = this.sessionStore.getWorkspace()
    const sessions = workspace.sessions ?? []
    const tiles: { tileId: string; tabIds: string[]; activeTabId: string; workspaceSessionId: string; workspaceName: string }[] = []

    for (const ws of sessions) {
      const tree = ws.tileTree
      if (!tree) continue
      const leaves = flattenLeaves(tree)
      for (const leaf of leaves) {
        tiles.push({
          tileId: leaf.id,
          tabIds: leaf.tabIds,
          activeTabId: leaf.activeTabId,
          workspaceSessionId: ws.id,
          workspaceName: ws.name,
        })
      }
    }

    res.writeHead(200)
    res.end(JSON.stringify({ tiles }))
  }

  private async handleReadOutput(id: string, maxLines: number, res: http.ServerResponse): Promise<void> {
    const lines = await this.ptyManager.readOutput(id, maxLines)
    if (lines === null) {
      res.writeHead(404)
      res.end(JSON.stringify({ error: 'Session not found' }))
      return
    }
    res.writeHead(200)
    res.end(JSON.stringify({ lines }))
  }

  private handleCreateSession(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 10240) {
        res.writeHead(413)
        res.end(JSON.stringify({ error: 'Request too large' }))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const cwd = data.cwd
        if (!cwd || typeof cwd !== 'string') {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'cwd is required' }))
          return
        }

        // Resolve effective backend (same logic as pty:spawn IPC handler)
        const workspace = this.sessionStore.getWorkspace()

        // M2: spawn cwd must be inside a registered project root (same H2 gate as
        // the mobile spawn path). Fails closed so a local caller can't spawn a
        // backend in an arbitrary directory (e.g. $HOME, /etc).
        const projectRoots = workspace.projects.map((p: any) => p.path).filter(Boolean)
        const cwdCheck = validateWithinProjectRoots(cwd, projectRoots, { mustExist: true, mustBeDirectory: true })
        if (!cwdCheck.valid) {
          res.writeHead(403)
          res.end(JSON.stringify({ error: 'cwd is not within a registered project' }))
          return
        }

        const project = workspace.projects.find((p: any) => p.path === cwd)
        const globalSettings = this.sessionStore.getSettings()

        const normalizedGlobalBackend = globalSettings.backend === 'default'
          ? undefined
          : globalSettings.backend

        const requestedBackend = data.backend === 'default' ? undefined : data.backend
        const effectiveBackend = requestedBackend
          || (project?.backend && project.backend !== 'default'
            ? project.backend
            : normalizedGlobalBackend || 'claude')

        const effectiveModel = data.model || undefined
        const autoAcceptTools = project?.autoAcceptTools ?? globalSettings.autoAcceptTools
        const permissionMode = project?.permissionMode ?? globalSettings.permissionMode

        const id = this.ptyManager.spawn(cwd, undefined, autoAcceptTools, permissionMode, effectiveModel, effectiveBackend)
        this.ptyToProject.set(id, cwd)
        this.ptyToBackend.set(id, effectiveBackend)

        const mainWindow = this.getMainWindow()

        this.ptyManager.onData(id, (data) => {
          try {
            mainWindow?.webContents.send(`pty:data:${id}`, data)
          } catch (e) {
            console.error('[Orchestrator] Failed to send PTY data:', e)
          }
        })

        this.ptyManager.onExit(id, (code) => {
          try {
            mainWindow?.webContents.send(`pty:exit:${id}`, code)
          } catch (e) {
            console.error('[Orchestrator] Failed to send PTY exit:', e)
          }
          this.ptyToProject.delete(id)
          this.ptyToBackend.delete(id)
        })

        try {
          mainWindow?.webContents.send('orchestrator:session-created', {
            ptyId: id,
            projectPath: cwd,
            backend: effectiveBackend,
            workspaceId: data.workspace_id || undefined,
            tileId: data.tile_id || undefined,
            placement: data.placement || undefined,
          })
        } catch (e) {
          console.error('[Orchestrator] Failed to notify renderer:', e)
        }

        res.writeHead(201)
        res.end(JSON.stringify({ session_id: id, backend: effectiveBackend, cwd }))
      } catch {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    })
  }

  private handleDeleteSession(id: string, res: http.ServerResponse): void {
    const proc = this.ptyManager.getProcess(id)
    if (!proc) {
      res.writeHead(404)
      res.end(JSON.stringify({ error: 'Session not found' }))
      return
    }

    // Notify renderer to close the tab before killing the PTY
    // (kill() disposes the onExit listener, so the normal pty:exit event won't fire)
    const mainWindow = this.getMainWindow()
    mainWindow?.webContents.send(`pty:exit:${id}`, 0)

    this.ptyToProject.delete(id)
    this.ptyToBackend.delete(id)
    this.ptyManager.kill(id)

    res.writeHead(200)
    res.end(JSON.stringify({ success: true, message: `Session ${id} closed` }))
  }

  private handleSendInput(id: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 10240) {
        res.writeHead(413)
        res.end(JSON.stringify({ error: 'Input too large' }))
        req.destroy()
      }
    })
    req.on('end', async () => {
      try {
        const data = JSON.parse(body)
        const input = data.input || data.text || data.message || ''
        if (!input) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'No input provided' }))
          return
        }

        const proc = this.ptyManager.getProcess(id)
        if (!proc) {
          res.writeHead(404)
          res.end(JSON.stringify({ error: 'Session not found' }))
          return
        }

        // In raw mode, send input as-is (for permission prompts, single keypresses)
        // Otherwise write input first, then send Enter after a short delay.
        // This mimics how a user pastes text then presses Enter — TUI apps like
        // Claude Code need a moment to process multi-line pastes before the
        // trailing \r is recognized as a submit action.
        // Codex (Rust/crossterm TUI) needs a longer settle time than Claude Code (Ink/React).
        const raw = data.raw === true
        const backend = this.ptyToBackend.get(id) ?? 'claude'
        // Codex chunks writes in 80-char pieces at 30ms each, so the Enter delay
        // must cover the full chunked write time plus some settle margin.
        const enterDelay = backend === 'codex'
          ? Math.ceil(input.length / 80) * 30 + 300
          : 150

        // For opencode: if the session appears to be at a bash/shell prompt rather
        // than the agent prompt, send Ctrl-C first to cancel the active subprocess
        // and return control to the opencode TUI before pasting.
        if (!raw && backend === 'opencode') {
          const recentLines = await this.ptyManager.readOutput(id, 8)
          const lastLine = (recentLines ?? []).filter(l => l.trim()).at(-1) ?? ''
          // Strip ANSI escapes to check the raw prompt character
          const stripped = lastLine.replace(/\x1b\[[0-9;]*[mGKHFABCDJ]/g, '').trimEnd()
          const atShellPrompt = /[$%#>]\s*$/.test(stripped)
          if (atShellPrompt) {
            this.ptyManager.write(id, '\x03') // Ctrl-C
            await new Promise(resolve => setTimeout(resolve, 300))
          }
        }

        if (raw) {
          this.ptyManager.write(id, input)
        } else {
          this.ptyManager.write(id, input)
          await new Promise(resolve => setTimeout(resolve, enterDelay))
          this.ptyManager.write(id, '\r')
        }
        res.writeHead(200)
        res.end(JSON.stringify({ success: true, message: `Input sent to session ${id}` }))
      } catch {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    })
  }
}

export { ORCHESTRATOR_PORT }
