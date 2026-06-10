import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, isAbsolute, basename } from 'path'
import { existsSync, mkdirSync, appendFileSync, statSync, unlinkSync } from 'fs'
import { spawn } from 'child_process'
import { SessionStore } from '../../session-store.js'
import { IS_DEBUG_MODE } from '../app-setup.js'

// Schemes we will hand to the OS via shell.openExternal. Anything else
// (file:, smb:, vscode:, custom app schemes, …) can launch programs or reach
// local resources, so it's rejected — the renderer renders untrusted terminal/
// model output and must not be able to trigger arbitrary URI handlers.
const SAFE_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

// Basenames we refuse to launch via executable:run. Spawning a shell or script
// interpreter (even with no args) is never the legitimate "run my project's
// executable" use case and is the only attacker-useful primitive here.
const SHELL_INTERPRETERS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh',
  'python', 'python2', 'python3', 'node', 'nodejs', 'deno', 'bun',
  'ruby', 'perl', 'php', 'lua', 'osascript',
  'pwsh', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe',
  'wscript', 'wscript.exe', 'cscript', 'cscript.exe',
  'sh.exe', 'bash.exe', 'python.exe', 'node.exe'
])

// Debug logging - only enabled in debug mode with 10MB size limit
const debugLogPath = '/tmp/tts-debug.log'
const DEBUG_LOG_MAX_SIZE = 10 * 1024 * 1024 // 10MB

export function registerSettingsHandlers(
  sessionStore: SessionStore,
  getMainWindow: () => BrowserWindow | null,
  onSettingsSaved?: (settings: ReturnType<SessionStore['getSettings']>) => void
): void {
  ipcMain.handle('settings:get', () => sessionStore.getSettings())
  ipcMain.handle('settings:save', (_, settings) => {
    sessionStore.saveSettings(settings)
    onSettingsSaved?.(settings)
  })
  ipcMain.handle('app:isDebugMode', () => IS_DEBUG_MODE)
  ipcMain.handle('app:refresh', () => getMainWindow()?.webContents.reload())
  ipcMain.handle('app:openExternal', (_, url: string) => {
    let scheme: string | null = null
    try {
      scheme = new URL(url).protocol
    } catch {
      scheme = null
    }
    if (scheme && SAFE_EXTERNAL_SCHEMES.has(scheme)) {
      return shell.openExternal(url)
    }
    console.warn(`[security] Blocked openExternal for disallowed URL scheme: ${scheme ?? 'invalid'}`)
    return Promise.resolve()
  })

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
      // Defense-in-depth: the renderer can be driven by untrusted terminal/model
      // output, so validate the target instead of spawning whatever path it sends.
      // The legitimate caller passes a user-picked project executable (absolute,
      // from the file dialog) and the project directory as cwd.
      if (typeof executable !== 'string' || !isAbsolute(executable)) {
        return { success: false, error: 'Invalid executable path' }
      }
      const exeStat = existsSync(executable) ? statSync(executable) : null
      if (!exeStat || !exeStat.isFile() || (exeStat.mode & 0o111) === 0) {
        return { success: false, error: 'Executable not found or not runnable' }
      }
      if (SHELL_INTERPRETERS.has(basename(executable).toLowerCase())) {
        return { success: false, error: 'Refusing to launch a shell or script interpreter' }
      }
      if (typeof cwd !== 'string' || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
        return { success: false, error: 'Invalid working directory' }
      }
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
