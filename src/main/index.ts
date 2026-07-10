import { app, BrowserWindow, globalShortcut, ipcMain, Notification } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync, copyFileSync, statSync } from 'fs'

import { PtyManager } from './pty-manager.js'
import { HeadroomProxyManager, HEADROOM_DEFAULT_PORT } from './headroom-proxy.js'
import { SessionStore } from './session-store.js'
import { ApiServerManager } from './api-server.js'
import { OrchestratorApi } from './orchestrator-api.js'
import { registerOrchestratorMcp } from './orchestrator-mcp-registration.js'
import { installSelfCompactionInstructions } from './ipc/self-compaction-instructions.js'
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
  cleanupClipboardTempFiles,
  registerGsdHandlers,
  registerKspecHandlers,
  registerGlobalInstructionHandlers,
} from './ipc/index.js'

import { setupAppConfig, setupSecurityHeaders } from './app/app-setup.js'
import { createApplicationMenu } from './app/menu.js'
import { createWindow } from './app/window.js'
import { setupApiPromptHandler } from './app/api-prompt-handler.js'
import { registerWorkspaceHandlers } from './app/ipc-handlers/workspace.js'
import { registerPtyHandlers } from './app/ipc-handlers/pty.js'
import { registerServerHandlers } from './app/ipc-handlers/servers.js'
import { registerSettingsHandlers } from './app/ipc-handlers/settings.js'
import { HermesBackupManager, type HermesBackupReason } from './hermes-backup-manager.js'

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
const hermesBackupManager = new HermesBackupManager(join(app.getPath('userData'), 'backups', 'hermes'))

// PTY tracking
const ptyToProject = new Map<string, string>()
const ptyToBackend = new Map<string, string>()
const getMainWindow = (): BrowserWindow | null => mainWindow

const orchestratorApi = new OrchestratorApi(ptyManager, ptyToProject, ptyToBackend, sessionStore, getMainWindow)
const setMainWindow = (win: BrowserWindow | null): void => { mainWindow = win }

// Headroom context-compression proxy. Pushes status to the renderer and is kept
// in sync with the saved settings on startup and on every save.
const headroomProxy = new HeadroomProxyManager((status) => {
  try {
    mainWindow?.webContents.send('headroom:status', status)
  } catch { /* window gone */ }
})

function syncHeadroom(settings = sessionStore.getSettings()): void {
  const enabled = settings.headroomEnabled === true
  const port = settings.headroomPort ?? HEADROOM_DEFAULT_PORT
  ptyManager.setHeadroomRouting({ enabled, port })
  void headroomProxy.ensure({ enabled, port, binPath: settings.headroomProxyPath })
}

const hasActiveHermes = (): boolean => [...ptyToBackend.values()].includes('hermes')

async function backupHermes(reason: HermesBackupReason, notify = false): Promise<string | null> {
  try {
    const backupPath = await hermesBackupManager.snapshot(reason)
    if (notify && backupPath && Notification.isSupported()) {
      new Notification({
        title: 'Hermes session backup saved',
        body: 'The snapshot passed its integrity check. It is safe to close the app.',
      }).show()
    }
    return backupPath
  } catch (error) {
    console.error(`[hermes-backup] ${reason} failed:`, error)
    if (notify && Notification.isSupported()) {
      new Notification({
        title: 'Hermes backup failed',
        body: 'Do not force-close the app yet. Check the application log.',
      }).show()
    }
    return null
  }
}

async function handleRendererFailure(reason: 'gone' | 'unresponsive'): Promise<void> {
  const backupReason = reason === 'gone' ? 'renderer-gone' : 'renderer-unresponsive'
  await backupHermes(backupReason, true)
}

ipcMain.handle('headroom:status', () => headroomProxy.getStatus())

// Register IPC handlers
registerCliHandlers(getMainWindow)
registerBeadsHandlers(getMainWindow)
registerVoiceHandlers(getMainWindow)
registerExtensionHandlers()
registerWindowHandlers(getMainWindow)
registerGsdHandlers()
registerKspecHandlers()
registerGlobalInstructionHandlers()
registerWorkspaceHandlers(sessionStore, getMainWindow)
registerPtyHandlers(ptyManager, sessionStore, apiServerManager, ptyToProject, ptyToBackend, getMainWindow, hermesBackupManager)
registerServerHandlers(apiServerManager, mobileServer, sessionStore)
registerSettingsHandlers(sessionStore, getMainWindow, (settings) => syncHeadroom(settings))

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
  mainWindow = createWindow(sessionStore, setMainWindow, handleRendererFailure)
  createApplicationMenu(mainWindow)
  if (mainWindow) initUpdater(mainWindow)
  if (mainWindow) orchestratorApi.debugApi.attachToWindow(mainWindow)

  globalShortcut.register('CommandOrControl+Alt+Shift+B', () => {
    void backupHermes('emergency', true)
  })

  // Start the Headroom proxy if enabled in settings.
  syncHeadroom()

  // Refresh task instructions in each project's backend-specific instruction file on startup.
  // This ensures existing sessions pick up updated instructions after compaction.
  try {
    const projects = sessionStore.getWorkspace().projects || []
    const globalBackend = sessionStore.getSettings().backend
    import('./ipc/kspec-handlers.js').then(({ installTaskInstructions: installTaskInstr }) => {
      for (const project of projects) {
        if (!project?.path) continue
        try {
          const hasKspec = existsSync(join(project.path, '.kspec'))
          const hasBeads = existsSync(join(project.path, '.beads'))
          if (!hasKspec && !hasBeads) continue
          const aiBackend = (project.backend && project.backend !== 'default'
            ? project.backend
            : (globalBackend && globalBackend !== 'default'
              ? globalBackend
              : 'claude')) as 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok'
          if (hasKspec) installTaskInstr(project.path, 'kspec', aiBackend)
          else installTaskInstr(project.path, 'beads', aiBackend)
        } catch { /* skip individual project errors */ }
      }
    }).catch(() => { /* kspec handlers not available */ })
  } catch (e) {
    console.error('[Startup] Failed to refresh task instructions:', e)
  }

  // Inject self-compaction instructions into every project's instruction file so
  // sessions know to compact themselves via the orchestrator `compact_session`
  // tool when they finish a task with remaining work. Always-on (not gated on a
  // task backend), since the orchestrator MCP is registered for all sessions.
  try {
    const projects = sessionStore.getWorkspace().projects || []
    const globalBackend = sessionStore.getSettings().backend
    for (const project of projects) {
      if (!project?.path) continue
      try {
        const aiBackend = (project.backend && project.backend !== 'default'
          ? project.backend
          : (globalBackend && globalBackend !== 'default'
            ? globalBackend
            : 'claude')) as 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok'
        installSelfCompactionInstructions(project.path, aiBackend)
      } catch { /* skip individual project errors */ }
    }
  } catch (e) {
    console.error('[Startup] Failed to inject self-compaction instructions:', e)
  }

  // Start orchestrator API for MCP-based session control
  orchestratorApi.start()

  // Ensure the orchestrator MCP server is registered globally so project sessions
  // can coordinate with orchestrator/meta sessions without manual MCP setup.
  const orchestratorScript = join(app.getAppPath(), 'scripts', 'orchestrator-mcp.mjs')
  registerOrchestratorMcp(orchestratorScript)

  // Mobile server for phone app connectivity. Opt-in (default off): the server
  // binds 0.0.0.0 over plain HTTP and can drive PTYs, so we must not silently
  // expose it on the LAN at every launch (H1). Managers are wired up regardless
  // so the user can turn it on later (Connect Mobile Device) without a restart.
  mobileServer.setPtyManager(ptyManager)
  mobileServer.setSessionStore(sessionStore)
  mobileServer.setVoiceManager(voiceManager)
  if (sessionStore.getSettings().mobileAccessEnabled === true) {
    mobileServer.start().then(() => {
      const info = mobileServer.getConnectionInfo()
      console.log(`[Mobile] Server ready at ${info.ips[0]}:${info.port}`)
    }).catch(err => {
      console.error('[Mobile] Failed to start server:', err)
    })
  } else {
    console.log('[Mobile] Server disabled (enable via Connect Mobile Device).')
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(sessionStore, setMainWindow, handleRendererFailure)
      createApplicationMenu(mainWindow)
      if (mainWindow) orchestratorApi.debugApi.attachToWindow(mainWindow)
    }
  })
})

app.on('window-all-closed', () => {
  // Don't SIGKILL here — let `before-quit` run a graceful shutdown so backends
  // can flush their session files. On Linux/Windows `app.quit()` triggers
  // `before-quit` next; on macOS the app stays alive and PTYs are torn down
  // by the renderer on next window open.
  if (process.platform !== 'darwin') app.quit()
})

let gracefulShutdownInProgress = false
let gracefulShutdownComplete = false

app.on('before-quit', (event) => {
  if (gracefulShutdownComplete) return
  if (gracefulShutdownInProgress) {
    event.preventDefault()
    return
  }

  event.preventDefault()
  gracefulShutdownInProgress = true

  ;(async () => {
    try {
      orchestratorApi.stop()
      headroomProxy.stop()
      mobileServer.stop()
      apiServerManager.stopAll()
      if (hasActiveHermes()) await backupHermes('shutdown')
      hermesBackupManager.stop()
      await ptyManager.gracefulShutdown(1500)
      cleanupClipboardTempFiles()
    } catch (e) {
      console.error('[shutdown] error during graceful shutdown:', e)
    } finally {
      gracefulShutdownComplete = true
      app.quit()
    }
  })()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
