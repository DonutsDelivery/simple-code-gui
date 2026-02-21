import { BrowserWindow } from 'electron'
import { ApiServerManager, PromptResult } from '../api-server.js'
import { SessionStore } from '../session-store.js'
import { PtyManager } from '../pty-manager.js'
import { API_DUPLICATE_WINDOW_MS, API_SESSION_TIMEOUT_MS } from '../../constants.js'

export interface PendingApiPrompt {
  prompt: string
  resolve: (result: PromptResult) => void
  autoClose: boolean
  model?: string
}

export const pendingApiPrompts = new Map<string, PendingApiPrompt>()
export const autoCloseSessions = new Set<string>()

const recentApiPrompts = new Map<string, { prompt: string; timestamp: number }>()

function cleanupStaleApiPrompts(now: number): void {
  for (const [key, value] of recentApiPrompts) {
    if (now - value.timestamp >= API_DUPLICATE_WINDOW_MS) {
      recentApiPrompts.delete(key)
    }
  }
}

export function setupApiPromptHandler(
  apiServerManager: ApiServerManager,
  sessionStore: SessionStore,
  ptyManager: PtyManager,
  ptyToProject: Map<string, string>,
  getMainWindow: () => BrowserWindow | null
): void {
  apiServerManager.setSessionModeGetter((projectPath) => {
    const workspace = sessionStore.getWorkspace()
    const project = workspace.projects.find(p => p.path === projectPath)
    return project?.apiSessionMode || 'existing'
  })

  apiServerManager.setPromptHandler(async (projectPath, prompt, sessionMode): Promise<PromptResult> => {
    const now = Date.now()

    // Clean up stale entries to prevent memory growth
    cleanupStaleApiPrompts(now)

    const recent = recentApiPrompts.get(projectPath)
    if (recent && recent.prompt === prompt && now - recent.timestamp < API_DUPLICATE_WINDOW_MS) {
      console.log('API: Ignoring duplicate prompt for', projectPath)
      return { success: true, message: 'Duplicate prompt ignored' }
    }
    recentApiPrompts.set(projectPath, { prompt, timestamp: now })

    if (sessionMode === 'existing') {
      for (const [ptyId, path] of ptyToProject) {
        if (path === projectPath) {
          ptyManager.write(ptyId, prompt)
          setTimeout(() => ptyManager.write(ptyId, '\r'), 300)
          return { success: true, message: 'Prompt sent to existing terminal' }
        }
      }
      return { success: false, error: 'No active terminal for this project' }
    }

    const workspace = sessionStore.getWorkspace()
    const project = workspace.projects.find(p => p.path === projectPath)
    const model = project?.apiModel
    const mainWindow = getMainWindow()

    return new Promise((resolve) => {
      pendingApiPrompts.set(projectPath, { prompt, resolve, autoClose: sessionMode === 'new-close', model })
      mainWindow?.webContents.send('api:open-session', { projectPath, autoClose: sessionMode === 'new-close', model })
      setTimeout(() => {
        const pending = pendingApiPrompts.get(projectPath)
        if (pending && pending.resolve === resolve) {
          pendingApiPrompts.delete(projectPath)
          resolve({ success: false, error: 'Timeout waiting for session to be created' })
        }
      }, API_SESSION_TIMEOUT_MS)
    })
  })
}
