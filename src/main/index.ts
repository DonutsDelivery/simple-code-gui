import { app, BrowserWindow, ipcMain, dialog, session, shell, Menu, crashReporter } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync, appendFileSync, statSync, unlinkSync } from 'fs'
import { spawn } from 'child_process'

// Set app name and WM_CLASS for proper Linux taskbar integration
app.setName('simple-code-gui')
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'simple-code-gui')
  app.commandLine.appendSwitch('name', 'simple-code-gui')
}

// Enable GPU acceleration
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

// Configure crash reporter for packaged builds
if (app.isPackaged) {
  crashReporter.start({
    productName: 'Simple Code GUI',
    submitURL: '', // Set to crash collection server URL when available
    uploadToServer: false // Enable when submitURL is configured
  })
}

import { PtyManager } from './pty-manager'
import { SessionStore } from './session-store'
import { discoverSessions } from './session-discovery'
import { getMetaProjectsPath } from './meta-project-sync'
import { ApiServerManager, PromptResult } from './api-server'
import { MobileServer } from './mobile-server'
import { getEnhancedPathWithPortable, setPortableBinDirs } from './platform'
import { getPortableBinDirs } from './portable-deps'
import { initUpdater } from './updater'
import {
  registerCliHandlers,
  registerBeadsHandlers,
  registerVoiceHandlers,
  registerExtensionHandlers,
  registerWindowHandlers,
  registerGsdHandlers,
} from './ipc'
import { API_DUPLICATE_WINDOW_MS, API_SESSION_TIMEOUT_MS } from '../constants'

const IS_DEBUG_MODE = process.argv.includes('--debug') || process.env.DEBUG_MODE === '1'

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

let mainWindow: BrowserWindow | null = null
const ptyManager = new PtyManager()
const sessionStore = new SessionStore()
const apiServerManager = new ApiServerManager()
const mobileServer = new MobileServer()

// PTY tracking
const ptyToProject = new Map<string, string>()
const ptyToBackend = new Map<string, string>()

// API prompt tracking
interface PendingApiPrompt {
  prompt: string
  resolve: (result: PromptResult) => void
  autoClose: boolean
  model?: string
}
const pendingApiPrompts = new Map<string, PendingApiPrompt>()
const autoCloseSessions = new Set<string>()

function maybeRespondToCursorPositionRequest(ptyId: string, data: string): void {
  const backend = ptyToBackend.get(ptyId)
  if (!backend || backend === 'claude') return
  if (data.includes('\x1b[6n') || data.includes('\x1b[?6n')) {
    ptyManager.write(ptyId, '\x1b[1;1R')
  }
}

// API server configuration
apiServerManager.setSessionModeGetter((projectPath) => {
  const workspace = sessionStore.getWorkspace()
  const project = workspace.projects.find(p => p.path === projectPath)
  return project?.apiSessionMode || 'existing'
})

const recentApiPrompts = new Map<string, { prompt: string; timestamp: number }>()

function cleanupStaleApiPrompts(now: number): void {
  for (const [key, value] of recentApiPrompts) {
    if (now - value.timestamp >= API_DUPLICATE_WINDOW_MS) {
      recentApiPrompts.delete(key)
    }
  }
}

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

function createApplicationMenu() {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project...',
          accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              properties: ['openDirectory'],
              title: 'Select Project Folder'
            })
            if (!result.canceled && result.filePaths[0]) {
              mainWindow?.webContents.send('menu:open-project', result.filePaths[0])
            }
          }
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { role: 'selectAll' as const }
        ] : [
          { role: 'delete' as const },
          { type: 'separator' as const },
          { role: 'selectAll' as const }
        ])
      ]
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        ...(IS_DEBUG_MODE ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
          { type: 'separator' as const },
          { role: 'window' as const }
        ] : [
          { role: 'close' as const }
        ])
      ]
    },
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/anthropics/claude-code')
        },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/anthropics/claude-code/issues')
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow() {
  const bounds = sessionStore.getWindowBounds()
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1200,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#1e1e1e'
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && IS_DEBUG_MODE) mainWindow?.webContents.toggleDevTools()
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  mainWindow.on('close', () => {
    if (mainWindow) sessionStore.saveWindowBounds(mainWindow.getBounds())
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    ptyManager.killAll()
  })
}

app.whenReady().then(() => {
  // Migrate data from old app name
  const oldConfigDir = join(app.getPath('appData'), 'simple-claude-gui', 'config')
  const newConfigDir = join(app.getPath('userData'), 'config')
  const oldWorkspace = join(oldConfigDir, 'workspace.json')
  const newWorkspace = join(newConfigDir, 'workspace.json')

  if (existsSync(oldWorkspace)) {
    try {
      const { statSync, copyFileSync } = require('fs')
      const oldSize = statSync(oldWorkspace).size
      let shouldMigrate = false

      if (!existsSync(newWorkspace)) {
        shouldMigrate = true
      } else {
        const newSize = statSync(newWorkspace).size
        if (oldSize > 500 && newSize < 500) shouldMigrate = true
      }

      if (shouldMigrate) {
        console.log('Migrating workspace from simple-claude-gui to simple-code-gui...')
        mkdirSync(newConfigDir, { recursive: true })
        copyFileSync(oldWorkspace, newWorkspace)

        const oldVoice = join(app.getPath('appData'), 'simple-claude-gui', 'voice-settings.json')
        const newVoice = join(app.getPath('userData'), 'voice-settings.json')
        if (existsSync(oldVoice) && !existsSync(newVoice)) {
          copyFileSync(oldVoice, newVoice)
        }
        console.log('Migration complete')
      }
    } catch (err) {
      console.error('Workspace migration failed, continuing with empty workspace:', err)
    }
  }

  // Initialize portable deps PATH
  const portableDirs = getPortableBinDirs()
  setPortableBinDirs(portableDirs)

  // Enable Cross-Origin Isolation for SharedArrayBuffer and configure CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'wasm-unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; " +
          "img-src 'self' data: blob:; " +
          "media-src 'self' blob:"
        ]
      }
    })
  })

  createApplicationMenu()
  createWindow()
  if (mainWindow) initUpdater(mainWindow)

  // Start mobile server for phone app connectivity
  mobileServer.setPtyManager(ptyManager)
  mobileServer.setSessionStore(sessionStore)
  mobileServer.start().then(() => {
    const info = mobileServer.getConnectionInfo()
    console.log(`[Mobile] Server ready at ${info.ips[0]}:${info.port}`)
  }).catch(err => {
    console.error('[Mobile] Failed to start server:', err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  mobileServer.stop()
  apiServerManager.stopAll()
  ptyManager.killAll()
})

// Register IPC handlers
const getMainWindow = () => mainWindow
registerCliHandlers(getMainWindow)
registerBeadsHandlers(getMainWindow)
registerVoiceHandlers(getMainWindow)
registerExtensionHandlers()
registerWindowHandlers(getMainWindow)
registerGsdHandlers()

// Workspace management
ipcMain.handle('workspace:get', () => sessionStore.getWorkspace())
ipcMain.handle('workspace:save', (_, workspace) => sessionStore.saveWorkspace(workspace))
ipcMain.handle('workspace:getMetaProjectsPath', () => getMetaProjectsPath())
ipcMain.handle('workspace:getCategoryMetaPath', (_, categoryName: string) => {
  const basePath = getMetaProjectsPath()
  // Sanitize category name for filesystem
  const safeName = categoryName.replace(/[/\\:*?"<>|]/g, '_')
  return join(basePath, safeName)
})
ipcMain.handle('workspace:addProject', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Project Folder'
  })
  return result.canceled ? null : result.filePaths[0] || null
})

// Session discovery
ipcMain.handle('sessions:discover', (_, projectPath: string, backend?: 'claude' | 'opencode') => discoverSessions(projectPath, backend))

// PTY management
ipcMain.handle('pty:spawn', (_, { cwd, sessionId, model, backend }: { cwd: string; sessionId?: string; model?: string; backend?: string }) => {
  try {
    const workspace = sessionStore.getWorkspace()
    const project = workspace.projects.find(p => p.path === cwd)
    const globalSettings = sessionStore.getSettings()

    const effectiveBackend = (backend && backend !== 'default')
      ? backend
      : (project?.backend && project.backend !== 'default')
        ? project.backend
        : (globalSettings.backend || 'claude')

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

    ptyManager.onData(id, (data) => {
      maybeRespondToCursorPositionRequest(id, data)
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

ipcMain.handle('pty:set-backend', async (_, { id: oldId, backend: newBackend }: { id: string; backend: string }) => {
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

  ptyManager.onData(newId, (data) => {
    maybeRespondToCursorPositionRequest(newId, data)
    mainWindow?.webContents.send(`pty:data:${newId}`, data)
  })

  ptyManager.onExit(newId, (code) => {
    mainWindow?.webContents.send(`pty:exit:${newId}`, code)
    ptyToProject.delete(newId)
    ptyToBackend.delete(newId)
  })

  mainWindow?.webContents.send('pty:recreated', { oldId, newId, backend: newBackend })
})

// Debug logging - only enabled in debug mode with 10MB size limit
const debugLogPath = '/tmp/tts-debug.log'
const DEBUG_LOG_MAX_SIZE = 10 * 1024 * 1024 // 10MB
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

// API Server management
ipcMain.handle('api:start', (_, { projectPath, port }: { projectPath: string; port: number }) => apiServerManager.start(projectPath, port))
ipcMain.handle('api:stop', (_, projectPath: string) => { apiServerManager.stop(projectPath); return { success: true } })
ipcMain.handle('api:status', (_, projectPath: string) => ({
  running: apiServerManager.isRunning(projectPath),
  port: apiServerManager.getPort(projectPath)
}))

// Mobile server management (for phone app connectivity)
ipcMain.handle('mobile:getConnectionInfo', () => mobileServer.getConnectionInfo())
ipcMain.handle('mobile:regenerateToken', () => ({
  token: mobileServer.regenerateToken(),
  ...mobileServer.getConnectionInfo()
}))
ipcMain.handle('mobile:isRunning', () => mobileServer.isRunning())

// Settings management
ipcMain.handle('settings:get', () => sessionStore.getSettings())
ipcMain.handle('settings:save', (_, settings) => sessionStore.saveSettings(settings))
ipcMain.handle('app:isDebugMode', () => IS_DEBUG_MODE)
ipcMain.handle('app:refresh', () => mainWindow?.webContents.reload())
ipcMain.handle('app:openExternal', (_, url: string) => shell.openExternal(url))

ipcMain.handle('settings:selectDirectory', async () => {
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
