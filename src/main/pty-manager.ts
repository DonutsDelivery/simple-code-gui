import * as pty from 'node-pty'
import * as fs from 'fs'
import * as path from 'path'
import { isWindows, getEnhancedPathWithPortable, getAdditionalPaths } from './platform'
import { getPortableBinDirs } from './portable-deps'

interface ClaudeProcess {
  id: string
  pty: pty.IPty
  cwd: string
  sessionId?: string
  backend?: string
}

function getEnhancedEnv(): { [key: string]: string } {
  const env = { ...process.env } as { [key: string]: string }
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
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
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
function findExecutable(backend: string = 'claude'): string {
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
  if (!isWindows) {
    return 'codex'
  }

  // On Windows, check for codex.cmd in portable npm-global first
  const portableDirs = getPortableBinDirs()
  for (const dir of portableDirs) {
    const codexCmd = path.join(dir, 'codex.cmd')
    if (fs.existsSync(codexCmd)) {
      console.log('Found Codex at (portable):', codexCmd)
      return codexCmd
    }
  }

  // Then check for codex.cmd in system npm paths
  const additionalPaths = getAdditionalPaths()
  for (const dir of additionalPaths) {
    const codexCmd = path.join(dir, 'codex.cmd')
    if (fs.existsSync(codexCmd)) {
      console.log('Found Codex at:', codexCmd)
      return codexCmd
    }
  }

  // Fall back to just 'codex' and let PATH resolve it
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

// Find claude executable - on Windows, npm installs .cmd files
function findClaudeExecutable(): string {
  if (!isWindows) {
    return 'claude'
  }

  // On Windows, check for claude.cmd in portable npm-global first
  const portableDirs = getPortableBinDirs()
  for (const dir of portableDirs) {
    const claudeCmd = path.join(dir, 'claude.cmd')
    if (fs.existsSync(claudeCmd)) {
      console.log('Found Claude at (portable):', claudeCmd)
      return claudeCmd
    }
  }

  // Then check for claude.cmd in system npm paths
  const additionalPaths = getAdditionalPaths()
  for (const dir of additionalPaths) {
    const claudeCmd = path.join(dir, 'claude.cmd')
    if (fs.existsSync(claudeCmd)) {
      console.log('Found Claude at:', claudeCmd)
      return claudeCmd
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
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'Scripts'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'Scripts'),
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

// Build backend-specific permission arguments
// Maps our internal permission modes to each backend's CLI flags
function buildPermissionArgs(backend: string = 'claude', permissionMode?: string, autoAcceptTools?: string[]): string[] {
  const args: string[] = []

  switch (backend) {
    case 'claude':
      // Claude Code: --permission-mode and --allowedTools
      if (permissionMode && permissionMode !== 'default') {
        args.push('--permission-mode', permissionMode)
      }
      if (autoAcceptTools && autoAcceptTools.length > 0) {
        for (const tool of autoAcceptTools) {
          args.push('--allowedTools', tool)
        }
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
      // Codex CLI: --full-auto or --dangerously-bypass-approvals-and-sandbox
      // See: https://developers.openai.com/codex/cli/reference/
      if (permissionMode) {
        switch (permissionMode) {
          case 'acceptEdits':
          case 'dontAsk':
            args.push('--full-auto')
            break
          case 'bypassPermissions':
            args.push('--dangerously-bypass-approvals-and-sandbox')
            break
          // 'default' mode = no flag needed
        }
      }
      // Codex doesn't support per-tool auto-accept via CLI flags
      break

    case 'opencode':
      // OpenCode: --allowedTools (comma-separated, non-interactive mode auto-approves)
      // See: https://opencode.ai/docs/permissions/
      if (autoAcceptTools && autoAcceptTools.length > 0) {
        args.push('--allowedTools', autoAcceptTools.join(','))
      }
      // OpenCode permission mode is configured in config file, not CLI flags
      // In non-interactive mode, all permissions are auto-approved anyway
      break

    case 'aider':
      // Aider doesn't have permission flags - it uses --yes for auto-confirm
      if (permissionMode && permissionMode !== 'default') {
        args.push('--yes')
      }
      break
  }

  return args
}

function buildResumeArgs(backend: string = 'claude', sessionId?: string): string[] {
  if (!sessionId) {
    return []
  }
  switch (backend) {
    case 'gemini':
      return ['--resume', sessionId]
    case 'codex':
      return ['--resume', sessionId]
    case 'opencode':
      return ['--session', sessionId]
    case 'aider':
      return ['--restore', sessionId]
    case 'claude':
    default:
      return ['-r', sessionId]
  }
}

export class PtyManager {
  private processes: Map<string, ClaudeProcess> = new Map()
  private dataCallbacks: Map<string, (data: string) => void> = new Map()
  private exitCallbacks: Map<string, (code: number) => void> = new Map()

  spawn(cwd: string, sessionId?: string, autoAcceptTools?: string[], permissionMode?: string, model?: string, backend?: string): string {
    const id = crypto.randomUUID()

    const args: string[] = []
    args.push(...buildResumeArgs(backend || 'claude', sessionId))

    // Add model if specified (and not default)
    if (model && model !== 'default') {
      args.push('--model', model)
    }

    // Add backend-specific permission arguments
    const permissionArgs = buildPermissionArgs(backend || 'claude', permissionMode, autoAcceptTools)
    args.push(...permissionArgs)

    const exe = findExecutable(backend)
    console.log('Spawning', backend, ':', exe, 'in', cwd, 'with args:', args)

    const ptyOptions: pty.IPtyForkOptions = {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: getEnhancedEnv(),
      handleFlowControl: true  // Enable XON/XOFF flow control for better backpressure handling
    }

    // Windows: try winpty instead of ConPTY for better escape sequence handling
    if (isWindows) {
      (ptyOptions as any).useConpty = false;
    }

    const shell = pty.spawn(exe, args, ptyOptions)

    const proc: ClaudeProcess = {
      id,
      pty: shell,
      cwd,
      sessionId,
      backend
    }

    this.processes.set(id, proc)

    shell.onData((data) => {
      const callback = this.dataCallbacks.get(id)
      if (callback) {
        callback(data)
      }
    })

    shell.onExit(({ exitCode }) => {
      const callback = this.exitCallbacks.get(id)
      if (callback) {
        callback(exitCode)
      }
      this.processes.delete(id)
      this.dataCallbacks.delete(id)
      this.exitCallbacks.delete(id)
    })

    return id
  }

  write(id: string, data: string): void {
    const proc = this.processes.get(id)
    if (proc) {
      proc.pty.write(data)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const proc = this.processes.get(id)
    if (proc) {
      try {
        proc.pty.resize(cols, rows)
      } catch (e) {
        // PTY may have already exited, ignore resize errors
        console.log('PTY resize ignored (may have exited):', id)
      }
    }
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
      this.processes.delete(id)
      this.dataCallbacks.delete(id)
      this.exitCallbacks.delete(id)
    }
  }

  killAll(): void {
    console.log(`Killing ${this.processes.size} PTY processes`)
    for (const [id] of this.processes) {
      this.kill(id)
    }
    this.processes.clear()
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
}
