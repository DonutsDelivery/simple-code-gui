import { BrowserWindow, ipcMain } from 'electron'
import { PtyManager } from '../../pty-manager.js'
import { SessionStore } from '../../session-store.js'
import { ApiServerManager } from '../../api-server.js'
import { pendingApiPrompts, autoCloseSessions } from '../api-prompt-handler.js'
import { appendFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { installTaskInstructions } from '../../ipc/kspec-handlers.js'
import type { AIBackend } from '../../ipc/instruction-files.js'

const DEBUG_LOG = '/tmp/auto-accept-debug.log'
const SCROLL_DEBUG_LOG = join(homedir(), 'scroll-debug.log')
function debugLog(msg: string): void {
  try { appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`) } catch {}
}

// Auto-accept permission prompts state
const autoAcceptEnabled = new Set<string>() // PTY IDs with auto-accept on
const autoAcceptBuffers = new Map<string, string>() // recent stripped output per PTY
const autoAcceptCooldown = new Map<string, number>() // prevent rapid-fire responses

// ANSI escape code stripper
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[>=][0-9]*[a-zA-Z]?/g, '')
}

// Permission prompt patterns — matches Claude Code's specific tool approval prompts
// ANSI stripping can collapse spaces between words, so use \s* to match with or without spaces
const PERMISSION_PATTERNS = [
  /Do\s*you\s*want\s*to\s*proceed\s*\?/,
  /Do\s*you\s*want\s*to\s*allow/,
  /Do\s*you\s*want\s*to\s*make\s*this\s*edit/,
]

function detectPermissionPrompt(buffer: string): boolean {
  // Check last ~500 chars of buffer for permission patterns
  const tail = buffer.slice(-500)
  return PERMISSION_PATTERNS.some(pattern => pattern.test(tail))
}

function maybeAutoAccept(
  ptyManager: PtyManager,
  id: string,
  data: string
): void {
  if (!autoAcceptEnabled.has(id)) return

  const stripped = stripAnsi(data)
  const existing = autoAcceptBuffers.get(id) || ''
  const buf = (existing + stripped).slice(-1000)
  autoAcceptBuffers.set(id, buf)

  // Cooldown: don't respond more than once per second
  const now = Date.now()
  const lastResponse = autoAcceptCooldown.get(id) || 0
  if (now - lastResponse < 1000) return

  const tail = buf.slice(-500)
  // Only log when tail contains "want" or "proceed" or "allow" (near-miss debugging)
  if (/want|proceed|allow/i.test(tail)) {
    debugLog(`TAIL id=${id.slice(0, 8)}: "${tail.replace(/\n/g, '\\n').slice(-400)}"`)
  }

  const matched = PERMISSION_PATTERNS.find(pattern => pattern.test(tail))
  if (matched) {
    debugLog(`MATCHED id=${id.slice(0, 8)} pattern=${matched}`)
    autoAcceptCooldown.set(id, now)
    autoAcceptBuffers.set(id, '')
    setTimeout(() => {
      if (ptyManager.getProcess(id)) {
        debugLog(`WRITING '1' to id=${id.slice(0, 8)}`)
        ptyManager.write(id, '1')
      }
    }, 150)
  }
}

function maybeRespondToCursorPositionRequest(
  ptyManager: PtyManager,
  ptyToBackend: Map<string, string>,
  ptyId: string,
  data: string
): void {
  const backend = ptyToBackend.get(ptyId)
  if (!backend || backend === 'claude') return
  if (data.includes('\x1b[6n') || data.includes('\x1b[?6n')) {
    ptyManager.write(ptyId, '\x1b[1;1R')
  }
}

export function registerPtyHandlers(
  ptyManager: PtyManager,
  sessionStore: SessionStore,
  apiServerManager: ApiServerManager,
  ptyToProject: Map<string, string>,
  ptyToBackend: Map<string, string>,
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle('pty:list', () => ptyManager.listSessions())

  // Serialized screen snapshot for restoring scrollback on terminal remount.
  // Uses the headless-xterm-interpreted state (clean, like tmux attach) rather
  // than raw replay bytes, which corrupt formatting when sizes changed.
  ipcMain.handle('pty:get-replay', (_, id: string) => ptyManager.getSerializedBuffer(id))

  ipcMain.handle('pty:spawn', (_, { cwd, sessionId, model, backend }: { cwd: string; sessionId?: string; model?: string; backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok' }) => {
    try {
      const workspace = sessionStore.getWorkspace()
      const project = workspace.projects.find(p => p.path === cwd)
      const globalSettings = sessionStore.getSettings()

      const normalizedGlobalBackend = globalSettings.backend === 'default'
        ? undefined
        : globalSettings.backend

      const normalizedBackend = backend === 'default' ? undefined : backend
      const effectiveBackend = normalizedBackend
        || (project?.backend && project.backend !== 'default'
          ? project.backend
          : normalizedGlobalBackend || 'claude')

      const pending = pendingApiPrompts.get(cwd)
      const effectiveModel = model || pending?.model
      const autoAcceptTools = project?.autoAcceptTools ?? globalSettings.autoAcceptTools
      const permissionMode = project?.permissionMode ?? globalSettings.permissionMode

      const id = ptyManager.spawn(cwd, sessionId, autoAcceptTools, permissionMode, effectiveModel, effectiveBackend)
      ptyToProject.set(id, cwd)
      ptyToBackend.set(id, effectiveBackend)

      if (project?.apiPort && project.apiAutoStart && !apiServerManager.isRunning(cwd)) {
        apiServerManager.start(cwd, project.apiPort)
      }

      const mainWindow = getMainWindow()

      ptyManager.onData(id, (data) => {
        maybeRespondToCursorPositionRequest(ptyManager, ptyToBackend, id, data)
        maybeAutoAccept(ptyManager, id, data)
        try {
          mainWindow?.webContents.send(`pty:data:${id}`, data)
        } catch (e) {
          console.error('IPC send failed', e)
        }
      })

      ptyManager.onExit(id, (code) => {
        try {
          mainWindow?.webContents.send(`pty:exit:${id}`, code)
        } catch (e) {
          console.error('IPC send failed', e)
        }
        ptyToProject.delete(id)
        ptyToBackend.delete(id)
        autoCloseSessions.delete(id)
        autoAcceptEnabled.delete(id)
        autoAcceptBuffers.delete(id)
        autoAcceptCooldown.delete(id)
      })

      if (pending) {
        pendingApiPrompts.delete(cwd)
        if (pending.autoClose) autoCloseSessions.add(id)
        setTimeout(() => {
          // Verify PTY still exists before writing (race condition guard)
          if (ptyManager.getProcess(id)) {
            ptyManager.write(id, pending.prompt + '\n')
            pending.resolve({ success: true, message: 'Prompt sent to new terminal', sessionCreated: true })
          } else {
            pending.resolve({ success: false, error: 'Terminal exited before prompt could be sent' })
          }
        }, 4000)
      }

      return id
    } catch (error: any) {
      // Resolve pending prompt immediately on spawn failure instead of waiting for 30s timeout
      const pending = pendingApiPrompts.get(cwd)
      if (pending) {
        pendingApiPrompts.delete(cwd)
        pending.resolve({ success: false, error: `Failed to start terminal: ${error.message}` })
      }
      console.error('Failed to spawn PTY:', error)
      throw new Error(`Failed to start Claude: ${error.message}`)
    }
  })

  ipcMain.on('pty:write', (_, { id, data }: { id: string; data: string }) => ptyManager.write(id, data))
  ipcMain.on('pty:resize', (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => ptyManager.resize(id, cols, rows))
  ipcMain.on('pty:kill', (_, id: string) => {
    ptyToProject.delete(id)
    ptyToBackend.delete(id)
    ptyManager.kill(id)
  })

  ipcMain.handle('pty:set-backend', async (_, { id: oldId, backend: newBackend }: { id: string; backend: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok' }) => {
    const process = ptyManager.getProcess(oldId)
    if (!process) return

    const { cwd, sessionId, backend: oldBackend } = process
    const effectiveSessionId = oldBackend !== newBackend ? undefined : sessionId

    ptyManager.kill(oldId)
    const newId = ptyManager.spawn(cwd, effectiveSessionId, undefined, undefined, undefined, newBackend)

    const projectPath = ptyToProject.get(oldId)
    if (projectPath) {
      ptyToProject.set(newId, projectPath)
      ptyToProject.delete(oldId)
    }
    ptyToBackend.set(newId, newBackend)
    ptyToBackend.delete(oldId)

    const mainWindow = getMainWindow()

    // Carry over auto-accept state to new PTY
    if (autoAcceptEnabled.has(oldId)) {
      autoAcceptEnabled.delete(oldId)
      autoAcceptEnabled.add(newId)
    }
    autoAcceptBuffers.delete(oldId)
    autoAcceptCooldown.delete(oldId)

    ptyManager.onData(newId, (data) => {
      maybeRespondToCursorPositionRequest(ptyManager, ptyToBackend, newId, data)
      maybeAutoAccept(ptyManager, newId, data)
      mainWindow?.webContents.send(`pty:data:${newId}`, data)
    })

    ptyManager.onExit(newId, (code) => {
      mainWindow?.webContents.send(`pty:exit:${newId}`, code)
      ptyToProject.delete(newId)
      ptyToBackend.delete(newId)
      autoAcceptEnabled.delete(newId)
      autoAcceptBuffers.delete(newId)
      autoAcceptCooldown.delete(newId)
    })

    // Refresh instruction file for the new backend so it gets kspec/beads context
    if (projectPath) {
      try {
        const hasKspec = existsSync(join(projectPath, '.kspec'))
        const hasBeads = existsSync(join(projectPath, '.beads'))
        if (hasKspec || hasBeads) {
          const taskBackend = hasKspec ? 'kspec' : 'beads'
          installTaskInstructions(projectPath, taskBackend, newBackend as AIBackend)
        }
      } catch { /* non-fatal */ }
    }

    mainWindow?.webContents.send('pty:recreated', { oldId, newId, backend: newBackend, sessionId: effectiveSessionId })
  })

  // Auto-accept toggle
  ipcMain.on('pty:auto-accept', (_, { id, enabled }: { id: string; enabled: boolean }) => {
    debugLog(`TOGGLE id=${id.slice(0, 8)} enabled=${enabled}`)
    if (enabled) {
      autoAcceptEnabled.add(id)
    } else {
      autoAcceptEnabled.delete(id)
      autoAcceptBuffers.delete(id)
      autoAcceptCooldown.delete(id)
    }
    debugLog(`activeIds: [${[...autoAcceptEnabled].map(s => s.slice(0, 8)).join(', ')}]`)
  })

  ipcMain.handle('pty:auto-accept-status', (_, id: string) => {
    return autoAcceptEnabled.has(id)
  })

  // Scroll debug logger — appends to ~/scroll-debug.log
  ipcMain.on('scroll-debug-log', (_, chunk: string) => {
    try { appendFileSync(SCROLL_DEBUG_LOG, chunk) } catch { /* ignore */ }
  })
}
