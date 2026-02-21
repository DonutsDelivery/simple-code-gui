import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync, copyFileSync, statSync } from 'fs'

import { PtyManager } from './pty-manager.js'
import { SessionStore } from './session-store.js'
import { ApiServerManager } from './api-server.js'
import { MobileServer } from './mobile-server.js'
import { voiceManager } from './voice-manager.js'
import { setPortableBinDirs } from './platform.js'
import { getPortableBinDirs } from './portable-deps.js'
import { initUpdater } from './updater.js'
import {
  registerCliHandlers,
  registerBeadsHandlers,
  registerVoiceHandlers,
  registerExtensionHandlers,
  registerWindowHandlers,
  registerGsdHandlers,
} from './ipc/index.js'

import { setupAppConfig, setupSecurityHeaders } from './app/app-setup.js'
import { createApplicationMenu } from './app/menu.js'
import { createWindow } from './app/window.js'
import { setupApiPromptHandler } from './app/api-prompt-handler.js'
import { registerWorkspaceHandlers } from './app/ipc-handlers/workspace.js'
import { registerPtyHandlers } from './app/ipc-handlers/pty.js'
import { registerServerHandlers } from './app/ipc-handlers/servers.js'
import { registerSettingsHandlers } from './app/ipc-handlers/settings.js'

// Apply app config (must be done before app.whenReady)
setupAppConfig()

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

const getMainWindow = (): BrowserWindow | null => mainWindow
const setMainWindow = (win: BrowserWindow | null): void => { mainWindow = win }

// Register IPC handlers
registerCliHandlers(getMainWindow)
registerBeadsHandlers(getMainWindow)
registerVoiceHandlers(getMainWindow)
registerExtensionHandlers()
registerWindowHandlers(getMainWindow)
registerGsdHandlers()
registerWorkspaceHandlers(sessionStore, getMainWindow)
registerPtyHandlers(ptyManager, sessionStore, apiServerManager, ptyToProject, ptyToBackend, getMainWindow)
registerServerHandlers(apiServerManager, mobileServer)
registerSettingsHandlers(sessionStore, getMainWindow)

// Setup API prompt handler
setupApiPromptHandler(apiServerManager, sessionStore, ptyManager, ptyToProject, getMainWindow)

app.whenReady().then(() => {
  // Migrate data from old app name
  const oldConfigDir = join(app.getPath('appData'), 'simple-claude-gui', 'config')
  const newConfigDir = join(app.getPath('userData'), 'config')
  const oldWorkspace = join(oldConfigDir, 'workspace.json')
  const newWorkspace = join(newConfigDir, 'workspace.json')

  if (existsSync(oldWorkspace)) {
    try {
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

  // Setup security headers
  setupSecurityHeaders()

  createApplicationMenu(mainWindow)
  mainWindow = createWindow(sessionStore, ptyManager, setMainWindow)
  createApplicationMenu(mainWindow)
  if (mainWindow) initUpdater(mainWindow)

  // Start mobile server for phone app connectivity
  mobileServer.setPtyManager(ptyManager)
  mobileServer.setSessionStore(sessionStore)
  mobileServer.setVoiceManager(voiceManager)
  mobileServer.start().then(() => {
    const info = mobileServer.getConnectionInfo()
    console.log(`[Mobile] Server ready at ${info.ips[0]}:${info.port}`)
  }).catch(err => {
    console.error('[Mobile] Failed to start server:', err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(sessionStore, ptyManager, setMainWindow)
      createApplicationMenu(mainWindow)
    }
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
