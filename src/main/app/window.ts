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
      contextIsolation: true
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
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  mainWindow.on('close', () => {
    sessionStore.saveWindowBounds(mainWindow.getBounds())
  })

  mainWindow.on('closed', () => {
    setMainWindow(null)
    ptyManager.killAll()
  })

  setMainWindow(mainWindow)
  return mainWindow
}
