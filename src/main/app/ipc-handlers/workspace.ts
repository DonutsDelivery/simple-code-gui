import { BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { readdirSync, statSync } from 'fs'
import { SessionStore } from '../../session-store.js'
import { getMetaProjectsPath } from '../../meta-project-sync.js'
import { discoverSessions } from '../../session-discovery.js'
import { randomUUID } from 'crypto'
import type { EnvironmentCommandRouter } from '../../environment-command-router.js'

export function registerWorkspaceHandlers(
  sessionStore: SessionStore,
  environmentRouter: EnvironmentCommandRouter,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('workspace:get', () => environmentRouter.getSnapshot().workspace)
  ipcMain.handle('workspace:save', (_, workspace) => {
    const snapshot = environmentRouter.getSnapshot()
    return environmentRouter.execute({
      clientId: 'legacy-electron-renderer',
      commandId: randomUUID(),
      serverId: snapshot.serverId,
      expectedRevision: snapshot.revision,
      command: { type: 'replace-workspace', workspace },
    })
  })
  ipcMain.handle('environment:getSnapshot', () => environmentRouter.getSnapshot())
  ipcMain.handle('environment:getEvents', (_, afterRevision: number) => environmentRouter.getEventsAfter(afterRevision))
  ipcMain.handle('environment:executeCommand', (_, command) => environmentRouter.execute(command))
  environmentRouter.onEvent(event => {
    try {
      getMainWindow()?.webContents.send('environment:event', event)
    } catch {
      // Window may be closing; authority remains alive in the main process.
    }
  })
  ipcMain.handle('workspace:getMetaProjectsPath', () => getMetaProjectsPath())
  ipcMain.handle('workspace:getCategoryMetaPath', (_, categoryName: string) => {
    const basePath = getMetaProjectsPath()
    // Sanitize category name for filesystem
    const safeName = categoryName.replace(/[/\\:*?"<>|]/g, '_')
    return join(basePath, safeName)
  })
  ipcMain.handle('workspace:addProject', async () => {
    const mainWindow = getMainWindow()
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Project Folder'
    })
    return result.canceled ? null : result.filePaths[0] || null
  })

  ipcMain.handle('workspace:addProjectsFromParent', async () => {
    const mainWindow = getMainWindow()
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Parent Folder (all subdirectories will be added as projects)'
    })
    if (result.canceled || !result.filePaths[0]) return null

    const parentDir = result.filePaths[0]

    try {
      const entries = readdirSync(parentDir, { withFileTypes: true })
      const subdirs = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => ({
          path: join(parentDir, entry.name),
          name: entry.name
        }))
      return subdirs
    } catch (e) {
      console.error('Failed to scan parent directory:', e)
      return null
    }
  })

  // Session discovery
  ipcMain.handle('sessions:discover', (_, projectPath: string, backend?: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok') => discoverSessions(projectPath, backend))
}
