import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, appendFileSync, statSync, unlinkSync } from 'fs'
import { spawn } from 'child_process'
import { SessionStore } from '../../session-store.js'
import { IS_DEBUG_MODE } from '../app-setup.js'

// Debug logging - only enabled in debug mode with 10MB size limit
const debugLogPath = '/tmp/tts-debug.log'
const DEBUG_LOG_MAX_SIZE = 10 * 1024 * 1024 // 10MB

export function registerSettingsHandlers(
  sessionStore: SessionStore,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('settings:get', () => sessionStore.getSettings())
  ipcMain.handle('settings:save', (_, settings) => sessionStore.saveSettings(settings))
  ipcMain.handle('app:isDebugMode', () => IS_DEBUG_MODE)
  ipcMain.handle('app:refresh', () => getMainWindow()?.webContents.reload())
  ipcMain.handle('app:openExternal', (_, url: string) => shell.openExternal(url))

  ipcMain.handle('settings:selectDirectory', async () => {
    const mainWindow = getMainWindow()
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Default Project Directory'
    })
    return result.canceled ? null : result.filePaths[0] || null
  })

  // Project creation
  ipcMain.handle('project:create', (_, { name, parentDir }: { name: string; parentDir: string }) => {
    const projectPath = join(parentDir, name)
    if (existsSync(projectPath)) return { success: false, error: 'Directory already exists' }
    try {
      mkdirSync(projectPath, { recursive: true })
      return { success: true, path: projectPath }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Executable management
  ipcMain.handle('executable:select', async () => {
    const mainWindow = getMainWindow()
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      title: 'Select Executable',
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    return result.canceled ? null : result.filePaths[0] || null
  })

  ipcMain.handle('executable:run', (_, { executable, cwd }: { executable: string; cwd: string }) => {
    try {
      const child = spawn(executable, [], { cwd, detached: true, stdio: 'ignore' })
      child.on('error', (e) => console.error('Exec failed', e))
      child.unref()
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Debug logging
  ipcMain.on('debug:log', (_, message: string) => {
    if (!IS_DEBUG_MODE) return
    try {
      // Check file size and truncate if too large
      if (existsSync(debugLogPath)) {
        const stats = statSync(debugLogPath)
        if (stats.size > DEBUG_LOG_MAX_SIZE) {
          unlinkSync(debugLogPath)
        }
      }
      appendFileSync(debugLogPath, `${new Date().toISOString()} ${message}\n`)
    } catch { /* ignore logging errors */ }
  })
}
