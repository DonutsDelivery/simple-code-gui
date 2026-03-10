import { BrowserWindow, ipcMain } from 'electron'
import { PtyManager } from '../../pty-manager.js'
import { SessionStore } from '../../session-store.js'
import { ApiServerManager } from '../../api-server.js'
import { pendingApiPrompts, autoCloseSessions } from '../api-prompt-handler.js'

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
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('pty:spawn', (_, { cwd, sessionId, model, backend }: { cwd: string; sessionId?: string; model?: string; backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' }) => {
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
      })

      if (pending) {
        pendingApiPrompts.delete(cwd)
        if (pending.autoClose) autoCloseSessions.add(id)
        setTimeout(() => {
          ptyManager.write(id, pending.prompt + '\n')
          pending.resolve({ success: true, message: 'Prompt sent to new terminal', sessionCreated: true })
        }, 4000)
      }

      return id
    } catch (error: any) {
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

  ipcMain.handle('pty:set-backend', async (_, { id: oldId, backend: newBackend }: { id: string; backend: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' }) => {
    const proc = ptyManager.getProcess(oldId)
    if (!proc) return

    const { cwd, sessionId, backend: oldBackend } = proc
    const effectiveSessionId = oldBackend !== newBackend ? undefined : sessionId

    // Look up project settings so the new PTY inherits permissions and model
    const workspace = sessionStore.getWorkspace()
    const project = workspace.projects.find(p => p.path === cwd)
    const globalSettings = sessionStore.getSettings()
    const autoAcceptTools = project?.autoAcceptTools ?? globalSettings.autoAcceptTools
    const permissionMode = project?.permissionMode ?? globalSettings.permissionMode

    // Kill old PTY first, then spawn new one with error recovery
    ptyManager.kill(oldId)

    let newId: string
    try {
      newId = ptyManager.spawn(cwd, effectiveSessionId, autoAcceptTools, permissionMode, undefined, newBackend)
    } catch (error: any) {
      console.error('Failed to spawn new PTY during backend switch:', error)
      // Clean up stale map entries from the killed PTY
      ptyToProject.delete(oldId)
      ptyToBackend.delete(oldId)
      autoCloseSessions.delete(oldId)
      throw new Error(`Failed to switch backend to ${newBackend}: ${error.message}`)
    }

    const projectPath = ptyToProject.get(oldId)
    if (projectPath) {
      ptyToProject.set(newId, projectPath)
      ptyToProject.delete(oldId)
    }
    ptyToBackend.set(newId, newBackend)
    ptyToBackend.delete(oldId)

    // Transfer autoClose flag if the old session had it
    if (autoCloseSessions.delete(oldId)) {
      autoCloseSessions.add(newId)
    }

    const mainWindow = getMainWindow()

    ptyManager.onData(newId, (data) => {
      maybeRespondToCursorPositionRequest(ptyManager, ptyToBackend, newId, data)
      try {
        mainWindow?.webContents.send(`pty:data:${newId}`, data)
      } catch (e) {
        console.error('IPC send failed', e)
      }
    })

    ptyManager.onExit(newId, (code) => {
      try {
        mainWindow?.webContents.send(`pty:exit:${newId}`, code)
      } catch (e) {
        console.error('IPC send failed', e)
      }
      ptyToProject.delete(newId)
      ptyToBackend.delete(newId)
      autoCloseSessions.delete(newId)
    })

    mainWindow?.webContents.send('pty:recreated', { oldId, newId, backend: newBackend })
  })
}
