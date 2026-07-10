import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { SessionStore } from '../session-store.js'
import { PtyManager } from '../pty-manager.js'
import { IS_DEBUG_MODE } from './app-setup.js'

export function createWindow(
  sessionStore: SessionStore,
  ptyManager: PtyManager,
  setMainWindow: (win: BrowserWindow | null) => void
): BrowserWindow {
  const bounds = sessionStore.getWindowBounds()
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')

  const mainWindow = new BrowserWindow({
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
      contextIsolation: true,
      // OS-level renderer sandbox: contains a renderer compromise so it can't
      // pivot to the main process. Safe here because the preload uses only
      // contextBridge/ipcRenderer/webUtils (no Node built-ins).
      sandbox: true
    },
    backgroundColor: '#1e1e1e'
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && IS_DEBUG_MODE) mainWindow.webContents.toggleDevTools()
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // M6: prefix matching (startsWith 'http://localhost') is bypassable by hosts
    // like http://localhost.attacker.com. Parse and compare the hostname exactly.
    let allowed = false
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'file:') {
        allowed = true
      } else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        allowed = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
      }
    } catch {
      allowed = false
    }
    if (!allowed) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[window] Renderer process exited (${details.reason}); stopping active PTYs`)
    void ptyManager.gracefulShutdown(1500)
  })

  mainWindow.on('close', () => {
    sessionStore.saveWindowBounds(mainWindow.getBounds())
  })

  mainWindow.on('closed', () => {
    setMainWindow(null)
    // PTYs are not killed here. On Linux/Windows the app quits and
    // `before-quit` runs a graceful shutdown so backends can flush their
    // session files. On macOS the app stays alive and the renderer kills
    // any leftover PTYs on next window open.
  })

  setMainWindow(mainWindow)
  return mainWindow
}
