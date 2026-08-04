import { app, BrowserWindow, globalShortcut, ipcMain, Notification } from 'electron'
import { join } from 'path'

import { HeadroomProxyManager, HEADROOM_DEFAULT_PORT } from './headroom-proxy.js'
import { ApiServerManager } from './api-server.js'
import { OrchestratorApi } from './orchestrator-api.js'
import { registerOrchestratorMcp } from './orchestrator-mcp-registration.js'
import { installSelfCompactionInstructions } from './ipc/self-compaction-instructions.js'
import { removeLegacyTaskPanelInstructions } from './ipc/legacy-task-instructions.js'
import { voiceManager } from './voice-manager.js'
import { setPortableBinDirs } from './platform.js'
import { getPortableBinDirs } from './portable-deps.js'
import { initUpdater } from './updater.js'
import {
  registerCliHandlers,
  registerVoiceHandlers,
  registerExtensionHandlers,
  registerWindowHandlers,
  cleanupClipboardTempFiles,
  registerGlobalInstructionHandlers,
} from './ipc/index.js'

import { setupAppConfig, setupSecurityHeaders } from './app/app-setup.js'
import { createApplicationMenu } from './app/menu.js'
import { createWindow } from './app/window.js'
import { setupApiPromptHandler } from './app/api-prompt-handler.js'
import { registerWorkspaceHandlers } from './app/ipc-handlers/workspace.js'
import { registerCanvasAssetHandlers } from './app/ipc-handlers/canvas-assets.js'
import { registerPtyHandlers } from './app/ipc-handlers/pty.js'
import { registerServerHandlers } from './app/ipc-handlers/servers.js'
import { registerSettingsHandlers } from './app/ipc-handlers/settings.js'
import { registerSecureCredentialHandlers } from './app/ipc-handlers/secure-credentials.js'
import { HermesBackupManager, type HermesBackupReason } from './hermes-backup-manager.js'
import { migrateLegacyBrandData } from './brand-migration.js'
import { configureRuntimePaths } from './runtime-paths.js'
import { EnvironmentRuntime } from './environment-runtime.js'

// Apply app config (must be done before app.whenReady)
setupAppConfig()
configureRuntimePaths({ dataDir: app.getPath('userData'), appPath: app.getAppPath() })

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  // A live DonutCode process owns the server and will receive second-instance.
  // Exit synchronously so this contender cannot continue into whenReady() and
  // accidentally create a second EnvironmentRuntime.
  app.exit(0)
} else {
  migrateLegacyBrandData(app.getPath('appData'), app.getPath('userData'))
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else if (app.isReady()) {
      mainWindow = createWindow(sessionStore, setMainWindow, handleRendererFailure)
      createApplicationMenu(mainWindow)
      orchestratorApi.debugApi.attachToWindow(mainWindow)
    }
  })
}

let mainWindow: BrowserWindow | null = null
const environmentRuntime = new EnvironmentRuntime({
  dataDir: app.getPath('userData'),
  appPath: app.getAppPath(),
  version: app.getVersion(),
  voiceManager,
})
const {
  ptyManager,
  sessionStore,
  serverId,
  environmentRouter,
  runtimeRegistry: sessionRuntimeRegistry,
  server: mobileServer,
} = environmentRuntime
const apiServerManager = new ApiServerManager()
const hermesBackupManager = new HermesBackupManager(join(app.getPath('userData'), 'backups', 'hermes'))
hermesBackupManager.setRecoveryContext(
  join(app.getPath('userData'), 'config', 'workspace.json'),
  () => ptyManager.listSessions().filter(session => session.backend === 'hermes').map(session => session.cwd),
)

// PTY tracking
const ptyToProject = new Map<string, string>()
const ptyToBackend = new Map<string, string>()
const getMainWindow = (): BrowserWindow | null => mainWindow

const orchestratorApi = new OrchestratorApi(
  ptyManager,
  ptyToProject,
  ptyToBackend,
  sessionStore,
  getMainWindow,
  sessionRuntimeRegistry,
)
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
registerVoiceHandlers(getMainWindow)
registerExtensionHandlers()
registerWindowHandlers(getMainWindow)
registerGlobalInstructionHandlers()
registerWorkspaceHandlers(sessionStore, environmentRouter, getMainWindow)
registerCanvasAssetHandlers(join(app.getPath('userData'), 'canvas-assets'), getMainWindow)
registerPtyHandlers(ptyManager, sessionRuntimeRegistry, sessionStore, apiServerManager, ptyToProject, ptyToBackend, getMainWindow, hermesBackupManager)
registerServerHandlers(apiServerManager, mobileServer, sessionStore, environmentRuntime)
registerSettingsHandlers(sessionStore, getMainWindow, (settings) => syncHeadroom(settings))
registerSecureCredentialHandlers()

// Setup API prompt handler
setupApiPromptHandler(
  apiServerManager,
  sessionStore,
  sessionRuntimeRegistry,
  ptyToProject,
  getMainWindow,
)

app.whenReady().then(async () => {
  // Initialize portable deps PATH
  const portableDirs = getPortableBinDirs()
  setPortableBinDirs(portableDirs)

  // The local server is the desktop's domain boundary too. It is always
  // available on loopback; mobile access only changes whether it is LAN-bound.
  await environmentRuntime.start()

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

  // Remove instruction blocks previously managed by the retired task panel.
  try {
    for (const project of sessionStore.getWorkspace().projects || []) {
      if (project?.path) removeLegacyTaskPanelInstructions(project.path)
    }
  } catch (e) {
    console.error('[Startup] Failed to remove legacy task-panel instructions:', e)
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
  // Server is fully owned and wired by EnvironmentRuntime; Electron only controls
  // whether its local HTTP endpoint is enabled for this launch.
  if (sessionStore.getSettings().mobileAccessEnabled === true) {
    environmentRuntime.start().then(() => {
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
  // Closing the frontend only detaches it. The authoritative server and PTYs
  // remain available to other desktop, browser, and mobile clients. Explicit
  // application quit still runs the graceful server shutdown below.
  if (environmentRuntime.server.isRunning()) return
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
      await environmentRuntime.stop()
      apiServerManager.stopAll()
      if (hasActiveHermes()) await backupHermes('shutdown')
      hermesBackupManager.stop()
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
