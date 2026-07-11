import * as pty from 'node-pty'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFileSync } from 'child_process'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import {
  isWindows,
  getEnhancedPathWithPortable,
  getAdditionalPaths,
} from './platform'
import { getPortableBinDirs } from './portable-deps'

// Full-screen TUIs that are sensitive to rapid resize during startup.
// Suppressing their initial frame prevents default-size cursor output from
// being interpreted after the renderer has already fitted to the tile.
const RESIZE_SENSITIVE_BACKENDS = new Set(['gemini', 'droid', 'hermes'])
const CODEX_RESUME_LAST_SESSION_ID = '__codex_resume_last__'
type Backend = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok'

// Headroom proxy routing. Anthropic-shaped harnesses honor ANTHROPIC_BASE_URL;
// OpenAI-compatible ones honor OPENAI_BASE_URL. Backends not listed here speak a
// proprietary/native API or require backend-specific routing we should not
// override, so we leave their env alone.
const HEADROOM_ANTHROPIC_BACKENDS = new Set<Backend>(['claude', 'grok'])
const HEADROOM_OPENAI_BACKENDS = new Set<Backend>(['codex', 'opencode', 'aider'])

interface HeadroomRouting {
  enabled: boolean
  port: number
}

// Uses a headless xterm.js terminal to correctly interpret all VT/ANSI sequences
// (cursor-up redraws, erase-line, carriage-return overwrites, bracketed paste
// markers, OSC, DCS, …) before serving output to the orchestrator.  This avoids
// the regex-strip approach which left spinner chars, partial Ink redraws, and
// cursor-positioned text fragments in the buffer.
class OutputBuffer {
  private terminal: Terminal
  private serializeAddon: SerializeAddon
  private writeChain: Promise<void> = Promise.resolve()

  constructor(cols: number = 120, rows: number = 30) {
    // Scrollback matches the renderer's terminal (constants.ts) so a restore
    // after workspace switch can rebuild as much history as the user had.
    this.terminal = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true })
    this.serializeAddon = new SerializeAddon()
    this.terminal.loadAddon(this.serializeAddon)
  }

  append(data: string): void {
    // Chain writes so getRecent can await all pending data.
    this.writeChain = this.writeChain.then(
      () => new Promise<void>(resolve => this.terminal.write(data, resolve))
    )
  }

  resize(cols: number, rows: number): void {
    try {
      this.terminal.resize(cols, rows)
    } catch {
      // Terminal may already be disposed
    }
  }

  async getRecent(maxLines: number = 50): Promise<string[]> {
    await this.writeChain
    const buffer = this.terminal.buffer.active
    const lines: string[] = []
    // Walk backwards so we collect the most recent maxLines non-empty rows.
    for (let i = buffer.length - 1; i >= 0 && lines.length < maxLines; i--) {
      const bufLine = buffer.getLine(i)
      if (!bufLine) continue
      const text = bufLine.translateToString(true).trim()
      if (text) lines.unshift(text)
    }
    return lines
  }

  // Clean VT snapshot of the interpreted screen state (scrollback + viewport,
  // colors, cursor) — like a tmux attach. Unlike raw byte replay, this never
  // contains stale cursor-positioning from old terminal sizes, so writing it
  // into a fresh xterm reconstructs the buffer without formatting corruption.
  async serialize(): Promise<string> {
    await this.writeChain
    return this.serializeAddon.serialize()
  }

  clear(): void {
    this.terminal.reset()
    this.writeChain = Promise.resolve()
  }

  stats(): { lines: number; cols: number; rows: number } {
    const buffer = this.terminal.buffer.active
    return { lines: buffer.length, cols: this.terminal.cols, rows: this.terminal.rows }
  }

  dispose(): void {
    this.terminal.dispose()
  }
}

// Raw byte ring buffer — preserves ANSI/VT bytes exactly so a late-attaching
// client (e.g. mobile xterm.js) can replay them and reconstruct the screen.
// OutputBuffer above runs bytes through xterm.js (lossy: cursor positioning,
// alternate screen state, scrollback get flattened to text), so it can't be
// used for replay.
class ReplayBuffer {
  private chunks: string[] = []
  private totalBytes = 0
  private readonly cap: number

  constructor(capBytes: number = 64 * 1024) {
    this.cap = capBytes
  }

  append(data: string): void {
    this.chunks.push(data)
    this.totalBytes += data.length
    while (this.totalBytes > this.cap && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!
      this.totalBytes -= dropped.length
    }
  }

  read(): string {
    return this.chunks.join('')
  }

  size(): number {
    return this.totalBytes
  }

  clear(): void {
    this.chunks.length = 0
    this.totalBytes = 0
  }
}

interface ClaudeProcess {
  id: string
  pty: pty.IPty
  cwd: string
  sessionId?: string
  backend?: Backend
  disposables: { dispose: () => void }[]
  spawnedAt: number
  resizeTimeout?: ReturnType<typeof setTimeout>
  lastResizeCols?: number
  lastResizeRows?: number
  outputBuffer: OutputBuffer
  replayBuffer: ReplayBuffer
  /** Resize-sensitive TUIs: suppress output until the first settled resize */
  suppressOutput?: boolean
  /** Per-PTY temp directory containing Hermes's authoritative active-session file. */
  hermesRuntimeDir?: string
}

// Extended node-pty options - useConpty is a Windows-specific option not in @types/node-pty
interface ExtendedPtyForkOptions extends pty.IPtyForkOptions {
  useConpty?: boolean
}

function getEnhancedEnv(
  backend?: Backend,
  headroom?: HeadroomRouting
): { [key: string]: string } {
  const env = { ...process.env } as { [key: string]: string }
  delete env.CLAUDECODE
  env.SIMPLE_CODE_GUI = '1'

  // Route this harness's LLM traffic through the Headroom compression proxy when
  // enabled and the backend speaks a shape the proxy understands.
  if (headroom?.enabled && backend) {
    const base = `http://127.0.0.1:${headroom.port}`
    if (HEADROOM_ANTHROPIC_BACKENDS.has(backend)) {
      env.ANTHROPIC_BASE_URL = base
    } else if (HEADROOM_OPENAI_BACKENDS.has(backend)) {
      env.OPENAI_BASE_URL = `${base}/v1`
    }
  }
  const enhancedPath = getEnhancedPathWithPortable()

  // On Windows, environment variables are case-insensitive but we need to set the right one
  if (isWindows) {
    // Windows uses 'Path' but Node sometimes uses 'PATH' - set both to be safe
    env.PATH = enhancedPath
    env.Path = enhancedPath

    // Claude Code on Windows requires git-bash - try to find and set it
    if (!env.CLAUDE_CODE_GIT_BASH_PATH) {
      const gitBashPaths = [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        path.join(
          process.env.LOCALAPPDATA || '',
          'Programs',
          'Git',
          'bin',
          'bash.exe'
        ),
        path.join(process.env.PROGRAMFILES || '', 'Git', 'bin', 'bash.exe'),
      ]
      for (const bashPath of gitBashPaths) {
        if (fs.existsSync(bashPath)) {
          env.CLAUDE_CODE_GIT_BASH_PATH = bashPath
          console.log('Found git-bash at:', bashPath)
          break
        }
      }
    }
  } else {
    env.PATH = enhancedPath
  }

  console.log('Enhanced PATH for PTY:', enhancedPath.substring(0, 200) + '...')
  return env
}

// Find executable for the given backend
function findExecutable(
  backend: Backend = 'claude'
): string {
  if (backend === 'gemini') {
    return findGeminiExecutable()
  }
  if (backend === 'codex') {
    return findCodexExecutable()
  }
  if (backend === 'opencode') {
    return findOpenCodeExecutable()
  }
  if (backend === 'aider') {
    return findAiderExecutable()
  }
  if (backend === 'droid') {
    return findDroidExecutable()
  }
  if (backend === 'hermes') {
    return findHermesExecutable()
  }
  if (backend === 'grok') {
    return findGrokExecutable()
  }
  return findClaudeExecutable()
}

// Find gemini executable - on Windows, npm installs .cmd files
function findGeminiExecutable(): string {
  if (!isWindows) {
    return 'gemini'
  }

  // On Windows, check for gemini.cmd in portable npm-global first
  const portableDirs = getPortableBinDirs()
  for (const dir of portableDirs) {
    const geminiCmd = path.join(dir, 'gemini.cmd')
    if (fs.existsSync(geminiCmd)) {
      console.log('Found Gemini at (portable):', geminiCmd)
      return geminiCmd
    }
  }

  // Then check for gemini.cmd in system npm paths
  const additionalPaths = getAdditionalPaths()
  for (const dir of additionalPaths) {
    const geminiCmd = path.join(dir, 'gemini.cmd')
    if (fs.existsSync(geminiCmd)) {
      console.log('Found Gemini at:', geminiCmd)
      return geminiCmd
    }
  }

  // Fall back to just 'gemini' and let PATH resolve it
  return 'gemini'
}

// Find codex executable - on Windows, npm installs .cmd files
function findCodexExecutable(): string {
  const executableNames = isWindows ? ['codex.cmd', 'codex.exe'] : ['codex']
  const searchDirs = [
    ...getPortableBinDirs(),
    ...getAdditionalPaths(),
    ...(process.env.PATH || '').split(path.delimiter),
  ].filter(Boolean)
  const candidates = [...new Set(searchDirs.flatMap(dir =>
    executableNames.map(name => path.join(dir, name))
  ))].filter(candidate => fs.existsSync(candidate))

  let bestCandidate: string | undefined
  let bestVersion: [number, number, number] | undefined
  for (const candidate of candidates) {
    try {
      const output = execFileSync(candidate, ['--version'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: getEnhancedPathWithPortable() },
        shell: isWindows,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      })
      const match = String(output).match(/\b(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?\b/)
      if (!match) continue
      const version: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])]
      const isNewer = !bestVersion
        || version[0] > bestVersion[0]
        || (version[0] === bestVersion[0] && version[1] > bestVersion[1])
        || (version[0] === bestVersion[0] && version[1] === bestVersion[1] && version[2] > bestVersion[2])
      if (isNewer) {
        bestCandidate = candidate
        bestVersion = version
      }
    } catch {
      // An unreadable or incompatible candidate is skipped; PATH fallback remains available.
    }
  }

  if (bestCandidate) {
    console.log('Found newest Codex at:', bestCandidate, bestVersion?.join('.'))
    return bestCandidate
  }

  // Let the shell resolve Codex when no candidate can report a version.
  return 'codex'
}

// Find opencode executable - on Windows, npm installs .cmd files
function findOpenCodeExecutable(): string {
  if (!isWindows) {
    return 'opencode'
  }

  // On Windows, check for opencode.cmd in portable npm-global first
  const portableDirs = getPortableBinDirs()
  for (const dir of portableDirs) {
    const opencodeCmd = path.join(dir, 'opencode.cmd')
    if (fs.existsSync(opencodeCmd)) {
      console.log('Found OpenCode at (portable):', opencodeCmd)
      return opencodeCmd
    }
  }

  // Then check for opencode.cmd in system npm paths
  const additionalPaths = getAdditionalPaths()
  for (const dir of additionalPaths) {
    const opencodeCmd = path.join(dir, 'opencode.cmd')
    if (fs.existsSync(opencodeCmd)) {
      console.log('Found OpenCode at:', opencodeCmd)
      return opencodeCmd
    }
  }

  // Fall back to just 'opencode' and let PATH resolve it
  return 'opencode'
}

// Find claude executable - on Windows, npm installs .cmd files, native installer creates .exe
function findClaudeExecutable(): string {
  if (!isWindows) {
    return 'claude'
  }

  // Windows: check for both .cmd (npm) and .exe (native) installations
  const extensions = ['claude.cmd', 'claude.exe']

  // Check portable npm-global first
  const portableDirs = getPortableBinDirs()
  for (const dir of portableDirs) {
    for (const ext of extensions) {
      const claudePath = path.join(dir, ext)
      if (fs.existsSync(claudePath)) {
        console.log('Found Claude at (portable):', claudePath)
        return claudePath
      }
    }
  }

  // Then check system paths (includes ~/.local/bin for native installs)
  const additionalPaths = getAdditionalPaths()
  for (const dir of additionalPaths) {
    for (const ext of extensions) {
      const claudePath = path.join(dir, ext)
      if (fs.existsSync(claudePath)) {
        console.log('Found Claude at:', claudePath)
        return claudePath
      }
    }
  }

  // Fall back to just 'claude' and let PATH resolve it
  return 'claude'
}

// Find aider executable - pip installs to Scripts on Windows, bin on Unix
function findAiderExecutable(): string {
  if (!isWindows) {
    return 'aider'
  }

  // On Windows, check for aider.exe in portable Python Scripts first
  const portableDirs = getPortableBinDirs()
  for (const dir of portableDirs) {
    // pip installs to Scripts directory on Windows
    const aiderExe = path.join(dir, 'aider.exe')
    if (fs.existsSync(aiderExe)) {
      console.log('Found Aider at (portable):', aiderExe)
      return aiderExe
    }
    // Also check parent/Scripts (if dir is the node bin)
    const scriptsDir = path.join(path.dirname(dir), 'Scripts')
    const aiderInScripts = path.join(scriptsDir, 'aider.exe')
    if (fs.existsSync(aiderInScripts)) {
      console.log('Found Aider at (Scripts):', aiderInScripts)
      return aiderInScripts
    }
  }

  // Check common Python Scripts locations
  const pythonPaths = [
    path.join(
      process.env.LOCALAPPDATA || '',
      'Programs',
      'Python',
      'Python312',
      'Scripts'
    ),
    path.join(
      process.env.LOCALAPPDATA || '',
      'Programs',
      'Python',
      'Python311',
      'Scripts'
    ),
    path.join(process.env.APPDATA || '', 'Python', 'Python312', 'Scripts'),
    path.join(process.env.APPDATA || '', 'Python', 'Python311', 'Scripts'),
  ]
  for (const dir of pythonPaths) {
    const aiderExe = path.join(dir, 'aider.exe')
    if (fs.existsSync(aiderExe)) {
      console.log('Found Aider at:', aiderExe)
      return aiderExe
    }
  }

  // Fall back to just 'aider' and let PATH resolve it
  return 'aider'
}

// Find droid executable - native binary installed to ~/.local/bin or PATH
function findDroidExecutable(): string {
  if (!isWindows) {
    return 'droid'
  }

  // On Windows, check for droid.exe in portable dirs first
  const portableDirs = getPortableBinDirs()
  for (const dir of portableDirs) {
    const droidExe = path.join(dir, 'droid.exe')
    if (fs.existsSync(droidExe)) {
      console.log('Found Droid at (portable):', droidExe)
      return droidExe
    }
  }

  // Check common install locations
  const additionalPaths = getAdditionalPaths()
  for (const dir of additionalPaths) {
    const droidExe = path.join(dir, 'droid.exe')
    if (fs.existsSync(droidExe)) {
      console.log('Found Droid at:', droidExe)
      return droidExe
    }
  }

  // Fall back to just 'droid' and let PATH resolve it
  return 'droid'
}

// Find hermes executable - native install normally exposes `hermes` on PATH.
function findHermesExecutable(): string {
  if (!isWindows) {
    return 'hermes'
  }

  const portableDirs = getPortableBinDirs()
  for (const dir of portableDirs) {
    const hermesExe = path.join(dir, 'hermes.exe')
    const hermesCmd = path.join(dir, 'hermes.cmd')
    if (fs.existsSync(hermesExe)) {
      console.log('Found Hermes at (portable):', hermesExe)
      return hermesExe
    }
    if (fs.existsSync(hermesCmd)) {
      console.log('Found Hermes at (portable):', hermesCmd)
      return hermesCmd
    }
  }

  const additionalPaths = getAdditionalPaths()
  for (const dir of additionalPaths) {
    const hermesExe = path.join(dir, 'hermes.exe')
    const hermesCmd = path.join(dir, 'hermes.cmd')
    if (fs.existsSync(hermesExe)) {
      console.log('Found Hermes at:', hermesExe)
      return hermesExe
    }
    if (fs.existsSync(hermesCmd)) {
      console.log('Found Hermes at:', hermesCmd)
      return hermesCmd
    }
  }

  return 'hermes'
}

// Find Grok executable. Grok Build is commonly exposed as `grok`, with `agent`
// as an alternate command name.
function findGrokExecutable(): string {
  if (!isWindows) {
    const pathDirs = (process.env.PATH || '').split(path.delimiter)
    for (const name of ['grok', 'agent']) {
      for (const dir of pathDirs) {
        const grokPath = path.join(dir, name)
        if (fs.existsSync(grokPath)) return name
      }
    }
    return 'grok'
  }

  const names = ['grok.exe', 'grok.cmd', 'agent.exe', 'agent.cmd']

  const portableDirs = getPortableBinDirs()
  for (const dir of portableDirs) {
    for (const name of names) {
      const grokPath = path.join(dir, name)
      if (fs.existsSync(grokPath)) {
        console.log('Found Grok at (portable):', grokPath)
        return grokPath
      }
    }
  }

  const additionalPaths = getAdditionalPaths()
  for (const dir of additionalPaths) {
    for (const name of names) {
      const grokPath = path.join(dir, name)
      if (fs.existsSync(grokPath)) {
        console.log('Found Grok at:', grokPath)
        return grokPath
      }
    }
  }

  return 'grok'
}

// Build backend-specific permission arguments
// Maps our internal permission modes to each backend's CLI flags
function buildPermissionArgs(
  backend: Backend = 'claude',
  permissionMode?: string,
  autoAcceptTools?: string[]
): string[] {
  const args: string[] = []

  switch (backend) {
    case 'claude':
      // Claude Code: --permission-mode and --allowedTools
      if (permissionMode && permissionMode !== 'default') {
        args.push('--permission-mode', permissionMode)
      }
      if (autoAcceptTools && autoAcceptTools.length > 0) {
        args.push('--allowedTools', autoAcceptTools.join(','))
      }
      break

    case 'gemini':
      // Gemini CLI: --approval-mode (default/auto_edit/yolo) and --allowed-tools
      // See: https://geminicli.com/docs/get-started/configuration/
      if (permissionMode) {
        switch (permissionMode) {
          case 'acceptEdits':
            args.push('--approval-mode', 'auto_edit')
            break
          case 'dontAsk':
          case 'bypassPermissions':
            args.push('--approval-mode', 'yolo')
            break
          // 'default' mode = no flag needed
        }
      }
      if (autoAcceptTools && autoAcceptTools.length > 0) {
        // Gemini uses comma-separated list for --allowed-tools
        args.push('--allowed-tools', autoAcceptTools.join(','))
      }
      break

    case 'codex':
      if (permissionMode) {
        switch (permissionMode) {
          case 'acceptEdits':
            // Auto-approve within workspace sandbox; --full-auto is not a valid flag in 0.128+
            args.push('-a', 'never', '-s', 'workspace-write')
            break
          case 'dontAsk':
            args.push(
              '-a',
              'never',
              '-s',
              'workspace-write',
              '-c',
              'sandbox_workspace_write.network_access=true'
            )
            break
          case 'bypassPermissions':
            args.push('--yolo')
            break
          // 'default' mode = no flag needed
        }
      }
      // Codex doesn't support per-tool auto-accept via CLI flags
      break

    case 'opencode':
      // OpenCode doesn't accept permission flags on the CLI (use config instead).
      // Ignore auto-accept tools to avoid invalid arguments.
      break

    case 'aider':
      // Aider doesn't have permission flags - it uses --yes for auto-confirm
      if (permissionMode && permissionMode !== 'default') {
        args.push('--yes')
      }
      break

    case 'droid':
      // Droid doesn't expose permission flags via CLI
      break

    case 'hermes':
      // The user explicitly runs Hermes from this app in YOLO mode. Hermes
      // documents --yolo as the launch-time bypass for dangerous-command
      // approval prompts; the in-chat equivalent is /yolo.
      args.push('--yolo')
      break

    case 'grok':
      // Grok Build accepts Claude-style permission modes.
      if (permissionMode && permissionMode !== 'default') {
        args.push('--permission-mode', permissionMode)
      }
      if (autoAcceptTools && autoAcceptTools.length > 0) {
        args.push('--allowedTools', autoAcceptTools.join(','))
      }
      break
  }

  return args
}

// Claude Code sessions are append-only JSONL trees (each entry has
// parentUuid/uuid). Over time a session can fork into many branches —
// `claude -r <sessionId>` doesn't let us specify which leaf to resume to,
// and in practice it keeps picking stale branches when automated replies
// (e.g. the "Continue from where you left off" auto-prompt) have tacked
// themselves onto an old parent. We prune the JSONL to the linear chain
// leading to the latest REAL user leaf before spawning, so claude CLI has
// no branches to disambiguate.
function claudeSessionJsonlPath(cwd: string, sessionId: string): string {
  // Must match Claude's own encoding (same as encodeProjectPath in session-discovery.ts):
  // each separator char is replaced individually, so "/.config" → "--config" (two dashes),
  // not "-config" (one dash) as the collapsed [^a-zA-Z0-9]+ regex would produce.
  const dir = cwd
    .replace(/[/\\]+$/, '')
    .replace(/[/\\]/g, '-')
    .replace(/:/g, '-')
    .replace(/_/g, '-')
    .replace(/ /g, '-')
    .replace(/\./g, '-')
  return path.join(os.homedir(), '.claude', 'projects', dir, `${sessionId}.jsonl`)
}


export function pruneClaudeSessionToLatestBranch(cwd: string, sessionId: string): void {
  try {
    const filePath = claudeSessionJsonlPath(cwd, sessionId)
    if (!fs.existsSync(filePath)) return

    const rawLines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim().length > 0)
    if (rawLines.length === 0) return

    // Parse each line, tracking which lines are valid JSON vs corrupted.
    // Corrupted lines (concurrent-write collisions) are dropped — Claude Code
    // can't parse them and will exit immediately if they remain in the file.
    const entries: (any | null)[] = rawLines.map(l => {
      try { return JSON.parse(l) } catch { return null }
    })

    const corruptedCount = entries.filter(e => e === null).length
    if (corruptedCount > 0) {
      console.warn(`[PtyManager] ${sessionId}: ${corruptedCount} corrupted line(s) found, will strip them`)
    }

    const byUuid = new Map<string, any>()
    const hasChildren = new Set<string>()
    for (const e of entries) {
      if (e?.uuid) byUuid.set(e.uuid, e)
    }
    for (const e of entries) {
      if (e?.parentUuid && byUuid.has(e.parentUuid)) hasChildren.add(e.parentUuid)
    }

    const leafUuids: string[] = []
    for (const u of byUuid.keys()) {
      if (!hasChildren.has(u)) leafUuids.push(u)
    }
    if (leafUuids.length <= 1 && corruptedCount === 0) return // nothing to do

    // Anchor directly on the most recent real conversation turn (user/assistant)
    // by timestamp, then keep its ancestor chain. `claude -r` can only resume
    // from a user/assistant turn, so that ancestor is what we land on.
    //
    // Earlier this walked up from the single freshest leaf of *any* type. That
    // breaks on heavily-compacted sessions (each compaction forks the tree):
    // if the freshest leaf is a trailing attachment/system/summary marker that
    // got parented onto a stale pre-compaction branch, the walk-up lands on an
    // old turn and we resume a pre-compaction view of the conversation. Picking
    // the newest user/assistant entry globally always lands on the latest real
    // turn regardless of which branch the freshest non-conversation entry is on.
    const CONVERSATION_TYPES = new Set(['user', 'assistant'])
    let terminusUuid: string | undefined
    let terminusTs = ''
    for (const [uuid, e] of byUuid) {
      if (!CONVERSATION_TYPES.has(e.type || '')) continue
      const ts = e.timestamp || ''
      if (terminusUuid === undefined || ts.localeCompare(terminusTs) > 0) {
        terminusUuid = uuid
        terminusTs = ts
      }
    }
    if (!terminusUuid && corruptedCount === 0) return // nothing safe to prune to

    const chainUuids = new Set<string>()
    if (terminusUuid) {
      let cur: string | null | undefined = terminusUuid
      while (cur) {
        const e = byUuid.get(cur)
        if (!e) break
        chainUuids.add(cur)
        cur = e.parentUuid
      }
    }

    const keepLines: string[] = []
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      // Drop corrupted lines (null = parse error).
      if (e === null) continue
      // Preserve metadata entries (no uuid) and entries on the chosen chain.
      if (!e?.uuid || chainUuids.has(e.uuid)) keepLines.push(rawLines[i])
    }
    if (keepLines.length === rawLines.length) return

    const backupPath = `${filePath}.bak-${Date.now()}`
    fs.copyFileSync(filePath, backupPath)
    fs.writeFileSync(filePath, keepLines.join('\n') + '\n')
    console.log(`[PtyManager] Pruned ${sessionId}: ${rawLines.length} -> ${keepLines.length} lines (backup: ${backupPath})`)
  } catch (e) {
    console.error('[PtyManager] pruneClaudeSessionToLatestBranch failed:', e)
  }
}

function buildResumeArgs(
  backend: string = 'claude',
  sessionId?: string
): string[] {
  if (!sessionId) {
    return []
  }
  switch (backend) {
    case 'gemini':
      return ['--resume', sessionId]
    case 'codex':
      return ['resume', sessionId]
    case 'opencode':
      return ['--session', sessionId]
    case 'aider':
      return ['--restore', sessionId]
    case 'droid':
      return ['-r', sessionId]
    case 'hermes':
      return ['--resume', sessionId]
    case 'grok':
      return ['-r', sessionId]
    case 'claude':
    default:
      return ['-r', sessionId]
  }
}

export class PtyManager {
  private processes: Map<string, ClaudeProcess> = new Map()
  private dataCallbacks: Map<string, (data: string) => void> = new Map()
  private exitCallbacks: Map<string, (code: number) => void> = new Map()
  // Multi-subscriber listeners (additive, do not clobber the primary callback).
  // Used by the mobile server to attach to PTYs already owned by the desktop
  // renderer without disrupting the desktop's data feed.
  private dataListeners: Map<string, Set<(data: string) => void>> = new Map()
  private exitListeners: Map<string, Set<(code: number) => void>> = new Map()

  // Headroom proxy routing applied to newly spawned PTYs. Updated by the app
  // whenever settings change.
  private headroom: HeadroomRouting = { enabled: false, port: 8787 }

  setHeadroomRouting(routing: HeadroomRouting): void {
    this.headroom = routing
  }

  spawn(
    cwd: string,
    sessionId?: string,
    autoAcceptTools?: string[],
    permissionMode?: string,
    model?: string,
    backend?: Backend,
    hermesTmuxSessionId?: string
  ): string {
    const id = crypto.randomUUID()

    if ((!backend || backend === 'claude') && sessionId) {
      pruneClaudeSessionToLatestBranch(cwd, sessionId)
    }

    const permissionArgs = buildPermissionArgs(
      backend || 'claude',
      permissionMode,
      autoAcceptTools
    )

    const args: string[] = []

    // Codex resume: flags must come before the session ID positional arg.
    // Build as: resume <flags> <sessionId>  rather than: resume <sessionId> <flags>
    const resumeCodexLast = backend === 'codex' && sessionId === CODEX_RESUME_LAST_SESSION_ID
    if ((backend === 'codex') && sessionId) {
      args.push('resume')
      args.push(...permissionArgs)
      if (model && model !== 'default') {
        args.push('--model', model)
      }
      args.push(resumeCodexLast ? '--last' : sessionId)
    } else {
      args.push(...buildResumeArgs(backend || 'claude', sessionId))
      args.push(...permissionArgs)
      // Add model if specified (and not default)
      if (model && model !== 'default') {
        args.push('--model', model)
      }
    }

    // Codex >= 0.113 regressed so that --yolo / --dangerously-bypass-approvals-and-sandbox
    // no longer suppresses the interactive "Do you trust this directory?" prompt
    // (openai/codex PR #11874, issues #14345/#14547). A spawned session then stalls on
    // that prompt and looks like permission bypassing isn't applied. Mark the cwd trusted
    // on the command line so the prompt never appears. JSON.stringify quotes/escapes the
    // path (handles spaces); -c is global so it must precede the `resume` subcommand.
    if (backend === 'codex') {
      args.unshift('-c', `projects.${JSON.stringify(cwd)}.trust_level="trusted"`)
    }

    // Hermes's modern TUI is prompt_toolkit-based. Running it directly inside
    // node-pty lets cursor-position redraws corrupt xterm's buffer after a
    // physical wheel scroll. Use a private tmux server as a disposable terminal
    // boundary. The client-detached hook ensures Hermes cannot keep running if
    // Electron or its PTY disappears; durable conversation restore still uses
    // Hermes's own session ID, never the tmux transport.
    const useTmuxForHermes = backend === 'hermes' && process.platform === 'linux'
    let exe = findExecutable(backend)
    if (backend === 'hermes') {
      if (useTmuxForHermes) {
        const tmuxSessionId = (hermesTmuxSessionId || sessionId || id).replace(/[^A-Za-z0-9_-]/g, '-')
        const tmuxSocketName = `ct-hermes-client-${id}`
        args.unshift(
          '--',
          exe,
          '--tui'
        )
        args.push(
          ';',
          'set-hook',
          '-g',
          'client-detached',
          'kill-server'
        )
        args.unshift(
          '-L',
          tmuxSocketName,
          '-f',
          '/dev/null',
          'new-session',
          '-s',
          `ct-hermes-${tmuxSessionId}`,
          '-c',
          cwd,
          '-x',
          '120',
          '-y',
          '30'
        )
        exe = 'tmux'
      } else {
        // Preserve the prior full-screen experience where tmux is unavailable.
        args.unshift('--tui')
      }
    }
    console.log('Spawning', backend, ':', exe, 'in', cwd, 'with args:', args)

    // Expose this PTY's orchestrator session id to the CLI process. The CLI
    // inherits it to any MCP server it spawns (e.g. orchestrator-mcp.mjs), so a
    // session can act on itself — e.g. compact_session defaults to this id.
    const env = getEnhancedEnv(backend, this.headroom)
    env.ORCHESTRATOR_SESSION_ID = id

    // Hermes changes conversation identity inside the TUI when the user runs
    // /resume. Its launcher reports that identity through a temporary JSON
    // file. Give each PTY a private temp directory so the file can be mapped
    // back to exactly one tab without relying on recency or titles.
    let hermesRuntimeDir: string | undefined
    if (backend === 'hermes') {
      hermesRuntimeDir = path.join(os.homedir(), '.cache', 'simple-code-gui', 'hermes-runtime', id)
      fs.mkdirSync(hermesRuntimeDir, { recursive: true })
      env.TMPDIR = hermesRuntimeDir
    }

    const ptyOptions: ExtendedPtyForkOptions = {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env,
      handleFlowControl: true, // Enable XON/XOFF flow control for better backpressure handling
    }

    // Windows: use ConPTY for better escape sequence and UTF-8 handling
    if (isWindows) {
      ptyOptions.useConpty = true
    }

    const shell = pty.spawn(exe, args, ptyOptions)

    const proc: ClaudeProcess = {
      id,
      pty: shell,
      cwd,
      sessionId: resumeCodexLast ? undefined : sessionId,
      backend: backend as Backend | undefined,
      disposables: [],
      spawnedAt: Date.now(),
      outputBuffer: new OutputBuffer(),
      replayBuffer: new ReplayBuffer(),
      hermesRuntimeDir,
    }

    // Resize-sensitive TUIs: suppress output until the first resize sets the
    // real terminal dimensions. This prevents the initial render at 120×30 from
    // showing (and being duplicated when the resize triggers a re-render).
    const isResizeSensitive = RESIZE_SENSITIVE_BACKENDS.has(backend || '')
    if (isResizeSensitive) proc.suppressOutput = true

    this.processes.set(id, proc)

    // Store disposables from onData/onExit for proper cleanup
    const dataDisposable = shell.onData(data => {
      proc.outputBuffer.append(data)
      if (proc.suppressOutput) return // swallow until first resize
      proc.replayBuffer.append(data)
      const callback = this.dataCallbacks.get(id)
      if (callback) {
        callback(data)
      }
      const listeners = this.dataListeners.get(id)
      if (listeners) {
        for (const ln of listeners) {
          try { ln(data) } catch (e) { console.error('[pty-manager] data listener threw:', e) }
        }
      }
    })
    proc.disposables.push(dataDisposable)

    const exitDisposable = shell.onExit(({ exitCode }) => {
      const elapsed = Date.now() - proc.spawnedAt

      // If the process exits within 3 seconds with a non-zero code and had a
      // session resume arg, some backends can recover by starting a replacement
      // session. Hermes is deliberately excluded: its resume failure must remain
      // visible instead of silently turning a restored tab into a blank session.
      if (exitCode !== 0 && elapsed < 3000 && sessionId && !resumeCodexLast && backend !== 'hermes') {
        const retryMode = backend === 'codex' ? 'with resume --last' : 'without session resume'
        console.log(`[pty-manager] ${backend || 'claude'} exited quickly (${elapsed}ms, code ${exitCode}) — retrying ${retryMode}`)

        // Preserve callbacks before cleanup deletes them
        const savedDataCb = this.dataCallbacks.get(id)
        const savedExitCb = this.exitCallbacks.get(id)
        this.cleanupProcess(id)
        if (savedDataCb) this.dataCallbacks.set(id, savedDataCb)
        if (savedExitCb) this.exitCallbacks.set(id, savedExitCb)

        // Clear the renderer's terminal so the failed attempt's garbage is gone
        // ESC[2J = clear screen, ESC[H = cursor home
        if (savedDataCb) savedDataCb('\x1b[2J\x1b[H')

        // Re-spawn with the same id slot so the renderer doesn't need to know
        const retryArgs: string[] = []
        if (backend === 'codex') {
          retryArgs.push('resume')
          retryArgs.push(...buildPermissionArgs(backend || 'claude', permissionMode, autoAcceptTools))
          if (model && model !== 'default') retryArgs.push('--model', model)
          retryArgs.push('--last')
        } else {
          if (model && model !== 'default') retryArgs.push('--model', model)
          retryArgs.push(...buildPermissionArgs(backend || 'claude', permissionMode, autoAcceptTools))
        }

        // Mirror the trust override from the initial spawn (see comment above).
        if (backend === 'codex') {
          retryArgs.unshift('-c', `projects.${JSON.stringify(cwd)}.trust_level="trusted"`)
        }

        const retryShell = pty.spawn(exe, retryArgs, ptyOptions)
        const retryProc: ClaudeProcess = {
          id,
          pty: retryShell,
          cwd,
          sessionId: undefined,
          backend: backend as any,
          disposables: [],
          spawnedAt: Date.now(),
          outputBuffer: new OutputBuffer(),
          replayBuffer: new ReplayBuffer(),
        }
        this.processes.set(id, retryProc)

        const retryDataDisp = retryShell.onData(data => {
          retryProc.outputBuffer.append(data)
          retryProc.replayBuffer.append(data)
          const cb = this.dataCallbacks.get(id)
          if (cb) cb(data)
          const listeners = this.dataListeners.get(id)
          if (listeners) {
            for (const ln of listeners) {
              try { ln(data) } catch (e) { console.error('[pty-manager] data listener threw:', e) }
            }
          }
        })
        retryProc.disposables.push(retryDataDisp)

        const retryExitDisp = retryShell.onExit(({ exitCode: retryCode }) => {
          const cb = this.exitCallbacks.get(id)
          if (cb) cb(retryCode)
          const exitListeners = this.exitListeners.get(id)
          if (exitListeners) {
            for (const ln of exitListeners) {
              try { ln(retryCode) } catch (e) { console.error('[pty-manager] exit listener threw:', e) }
            }
          }
          this.cleanupProcess(id)
        })
        retryProc.disposables.push(retryExitDisp)
        return
      }

      const callback = this.exitCallbacks.get(id)
      if (callback) {
        callback(exitCode)
      }
      const exitLn = this.exitListeners.get(id)
      if (exitLn) {
        for (const ln of exitLn) {
          try { ln(exitCode) } catch (e) { console.error('[pty-manager] exit listener threw:', e) }
        }
      }
      this.cleanupProcess(id)
    })
    proc.disposables.push(exitDisposable)

    return id
  }

  write(id: string, data: string): void {
    const proc = this.processes.get(id)
    if (!proc) return

    // Codex's TUI input buffer can't absorb large pastes atomically — pasted text
    // gets silently truncated, requiring manual Space presses to flush the remainder.
    // Chunk-writing with small delays works around the issue.
    if (proc.backend === 'codex' && data.length > 80) {
      const CHUNK = 80
      let offset = 0
      const writeNext = () => {
        if (offset >= data.length) return
        proc.pty.write(data.slice(offset, offset + CHUNK))
        offset += CHUNK
        if (offset < data.length) setTimeout(writeNext, 30)
      }
      writeNext()
    } else {
      proc.pty.write(data)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const proc = this.processes.get(id)
    if (!proc) return

    // Skip if dimensions haven't changed
    if (proc.lastResizeCols === cols && proc.lastResizeRows === rows) return

    // Debounce resize events - Ink-based CLIs (e.g. Gemini) crash with
    // infinite re-render loops when they receive rapid SIGWINCH during startup
    if (proc.resizeTimeout) {
      clearTimeout(proc.resizeTimeout)
    }

    const elapsed = Date.now() - proc.spawnedAt
    const isResizeSensitiveBackend = RESIZE_SENSITIVE_BACKENDS.has(proc.backend || '')

    // Resize-sensitive TUIs re-render on every SIGWINCH. Coalesce resizes
    // during startup so only one SIGWINCH reaches the process after it initializes.
    const debounceMs = isResizeSensitiveBackend && elapsed < 5000 ? 1500 : 50

    proc.resizeTimeout = setTimeout(() => {
      proc.resizeTimeout = undefined
      proc.lastResizeCols = cols
      proc.lastResizeRows = rows
      try {
        proc.pty.resize(cols, rows)
      } catch (e) {
        // PTY may have already exited, ignore resize errors
        console.log('PTY resize ignored (may have exited):', id)
      }
      proc.outputBuffer.resize(cols, rows)

      // First settled resize for resize-sensitive TUIs: stop suppressing output.
      // The resize triggered a clean re-render at the correct size —
      // discard the 120×30 snapshot before accepting that re-render. Restoring
      // those cursor-addressed bytes at the larger size produces real stray
      // cells, not merely a canvas repaint artifact.
      if (proc.suppressOutput) {
        proc.outputBuffer.clear()
        proc.suppressOutput = false
        const cb = this.dataCallbacks.get(id)
        if (cb) cb('\x1b[2J\x1b[H')
      }
    }, debounceMs)
  }

  private cleanupProcess(id: string): void {
    const proc = this.processes.get(id)
    if (proc) {
      // Clear pending resize debounce
      if (proc.resizeTimeout) {
        clearTimeout(proc.resizeTimeout)
        proc.resizeTimeout = undefined
      }
      // Dispose all event listeners first
      for (const disposable of proc.disposables) {
        try {
          disposable.dispose()
        } catch (e) {
          // Ignore dispose errors
        }
      }
      proc.disposables.length = 0
      proc.outputBuffer.dispose()
      if (proc.hermesRuntimeDir) {
        try {
          fs.rmSync(proc.hermesRuntimeDir, { recursive: true, force: true })
        } catch {
          // Runtime identity files are disposable; stale directories can be
          // removed on a later launch if the process dies mid-cleanup.
        }
      }
    }
    this.processes.delete(id)
    this.dataCallbacks.delete(id)
    this.exitCallbacks.delete(id)
    this.dataListeners.delete(id)
    this.exitListeners.delete(id)
  }

  kill(id: string): void {
    const proc = this.processes.get(id)
    if (proc) {
      try {
        // Windows doesn't support SIGKILL, use default signal
        if (isWindows) {
          proc.pty.kill()
        } else {
          proc.pty.kill('SIGKILL')
        }
      } catch (e) {
        // Process may already be dead
      }
      this.cleanupProcess(id)
    }
  }

  killAll(): void {
    console.log(`Killing ${this.processes.size} PTY processes`)
    for (const [id] of this.processes) {
      this.kill(id)
    }
    this.processes.clear()
  }

  // Send a graceful termination signal to every PTY and wait up to
  // `timeoutMs` for them to exit on their own before SIGKILLing holdouts.
  // This gives AI CLI backends a chance to flush their session files to disk
  // so resumed sessions don't lose their most recent turn(s).
  async gracefulShutdown(timeoutMs: number = 1500): Promise<void> {
    if (this.processes.size === 0) return

    const initialCount = this.processes.size
    console.log(`[pty-manager] Graceful shutdown of ${initialCount} processes (timeout ${timeoutMs}ms)`)

    for (const [, proc] of this.processes) {
      try {
        if (isWindows) {
          // Windows ConPTY has no graceful signal — kill() is the only option.
          proc.pty.kill()
        } else {
          proc.pty.kill('SIGTERM')
        }
      } catch {
        // Process may already be dead — cleanupProcess will remove it.
      }
    }

    const start = Date.now()
    while (this.processes.size > 0 && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 50))
    }

    if (this.processes.size > 0) {
      console.log(`[pty-manager] ${this.processes.size}/${initialCount} processes still alive after ${timeoutMs}ms — force-killing`)
      this.killAll()
    }
  }

  getProcess(id: string): ClaudeProcess | undefined {
    return this.processes.get(id)
  }

  onData(id: string, callback: (data: string) => void): void {
    this.dataCallbacks.set(id, callback)
  }

  onExit(id: string, callback: (code: number) => void): void {
    this.exitCallbacks.set(id, callback)
  }

  // Additive subscriber that fires alongside the primary callback set via
  // onData/onExit.  Returns a disposer.  Used for cross-client live attach
  // (e.g. mobile attaching to a desktop-owned PTY) without clobbering the
  // primary feed.
  addDataListener(id: string, callback: (data: string) => void): () => void {
    let set = this.dataListeners.get(id)
    if (!set) {
      set = new Set()
      this.dataListeners.set(id, set)
    }
    set.add(callback)
    return () => {
      const s = this.dataListeners.get(id)
      if (!s) return
      s.delete(callback)
      if (s.size === 0) this.dataListeners.delete(id)
    }
  }

  addExitListener(id: string, callback: (code: number) => void): () => void {
    let set = this.exitListeners.get(id)
    if (!set) {
      set = new Set()
      this.exitListeners.set(id, set)
    }
    set.add(callback)
    return () => {
      const s = this.exitListeners.get(id)
      if (!s) return
      s.delete(callback)
      if (s.size === 0) this.exitListeners.delete(id)
    }
  }

  // Returns the raw byte stream captured since this PTY was spawned, capped
  // by ReplayBuffer.  Late-attaching clients can write this to their xterm
  // to faithfully reconstruct the current screen.
  getReplayBytes(id: string): string | null {
    const proc = this.processes.get(id)
    return proc ? proc.replayBuffer.read() : null
  }

  // Clean serialized snapshot of the interpreted screen state (see
  // OutputBuffer.serialize). Preferred over getReplayBytes for restoring
  // scrollback into a fresh renderer terminal.
  async getSerializedBuffer(id: string): Promise<string | null> {
    const proc = this.processes.get(id)
    return proc ? proc.outputBuffer.serialize() : null
  }

  // Orchestrator API: list all active sessions
  listSessions(): Array<{ id: string; cwd: string; backend: string; sessionId?: string; spawnedAt: number }> {
    const sessions: Array<{ id: string; cwd: string; backend: string; sessionId?: string; spawnedAt: number }> = []
    for (const [id, proc] of this.processes) {
      this.refreshHermesSessionIdentity(proc)
      sessions.push({
        id,
        cwd: proc.cwd,
        backend: proc.backend || 'claude',
        sessionId: proc.sessionId,
        spawnedAt: proc.spawnedAt,
      })
    }
    return sessions
  }

  private refreshHermesSessionIdentity(proc: ClaudeProcess): void {
    if (proc.backend !== 'hermes' || !proc.hermesRuntimeDir) return

    try {
      const activeFile = fs.readdirSync(proc.hermesRuntimeDir)
        .find(name => name.startsWith('hermes-tui-active-session-') && name.endsWith('.json'))
      if (!activeFile) return

      const payload = JSON.parse(fs.readFileSync(path.join(proc.hermesRuntimeDir, activeFile), 'utf8'))
      if (typeof payload.session_id === 'string' && payload.session_id.trim()) {
        proc.sessionId = payload.session_id
      }
    } catch {
      // Hermes may be replacing the file while it switches sessions. Keep the
      // last confirmed identity and retry on the next renderer poll.
    }
  }

  // Orchestrator API: read recent output from a PTY
  async readOutput(id: string, maxLines: number = 50): Promise<string[] | null> {
    const proc = this.processes.get(id)
    if (!proc) return null
    return proc.outputBuffer.getRecent(maxLines)
  }

  // Debug API: internal buffer/process state for a PTY
  getDebugStats(id: string): Record<string, unknown> | null {
    const proc = this.processes.get(id)
    if (!proc) return null
    const output = proc.outputBuffer.stats()
    return {
      id,
      cwd: proc.cwd,
      backend: proc.backend || 'claude',
      sessionId: proc.sessionId ?? null,
      spawnedAt: proc.spawnedAt,
      outputBufferLines: output.lines,
      outputBufferCols: output.cols,
      outputBufferRows: output.rows,
      replayBufferBytes: proc.replayBuffer.size(),
      lastResizeCols: proc.lastResizeCols ?? null,
      lastResizeRows: proc.lastResizeRows ?? null,
      suppressOutput: proc.suppressOutput ?? false,
    }
  }
}
