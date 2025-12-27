import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { spawn, exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
import { PtyManager } from './pty-manager'
import { SessionStore } from './session-store'
import { discoverSessions } from './session-discovery'
import { isWindows, getDefaultShell, getEnhancedPath } from './platform'

let mainWindow: BrowserWindow | null = null
const ptyManager = new PtyManager()
const sessionStore = new SessionStore()

function createWindow() {
  const bounds = sessionStore.getWindowBounds()

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1200,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#1e1e1e'
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Toggle DevTools with F12
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  mainWindow.on('close', () => {
    if (mainWindow) {
      sessionStore.saveWindowBounds(mainWindow.getBounds())
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    ptyManager.killAll()
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  ptyManager.killAll()
})

// IPC Handlers

// Workspace management
ipcMain.handle('workspace:get', () => {
  return sessionStore.getWorkspace()
})

ipcMain.handle('workspace:save', (_, workspace) => {
  sessionStore.saveWorkspace(workspace)
})

ipcMain.handle('workspace:addProject', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Project Folder'
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// Session discovery
ipcMain.handle('sessions:discover', (_, projectPath: string) => {
  return discoverSessions(projectPath)
})

// PTY management
ipcMain.handle('pty:spawn', (_, { cwd, sessionId }: { cwd: string; sessionId?: string }) => {
  const id = ptyManager.spawn(cwd, sessionId)

  ptyManager.onData(id, (data) => {
    mainWindow?.webContents.send(`pty:data:${id}`, data)
  })

  ptyManager.onExit(id, (code) => {
    mainWindow?.webContents.send(`pty:exit:${id}`, code)
  })

  return id
})

ipcMain.on('pty:write', (_, { id, data }: { id: string; data: string }) => {
  ptyManager.write(id, data)
})

ipcMain.on('pty:resize', (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
  ptyManager.resize(id, cols, rows)
})

ipcMain.on('pty:kill', (_, id: string) => {
  ptyManager.kill(id)
})

// Settings management
ipcMain.handle('settings:get', () => {
  return sessionStore.getSettings()
})

ipcMain.handle('settings:save', (_, settings) => {
  sessionStore.saveSettings(settings)
})

ipcMain.handle('settings:selectDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Default Project Directory'
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// Project creation
ipcMain.handle('project:create', (_, { name, parentDir }: { name: string; parentDir: string }) => {
  const projectPath = join(parentDir, name)
  if (existsSync(projectPath)) {
    return { success: false, error: 'Directory already exists' }
  }
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
    filters: [
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('executable:run', (_, { executable, cwd }: { executable: string; cwd: string }) => {
  try {
    const child = spawn(executable, [], {
      cwd,
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})

// Use platform-aware shell and PATH
const execOptions = {
  shell: isWindows ? true : '/bin/bash',  // true uses default shell on Windows
  env: { ...process.env, PATH: getEnhancedPath() }
}

// Claude Code installation check and management
let claudeAvailable: boolean | null = null

async function checkClaudeInstalled(): Promise<boolean> {
  if (claudeAvailable !== null) return claudeAvailable
  try {
    await execAsync('claude --version', execOptions)
    claudeAvailable = true
  } catch {
    claudeAvailable = false
  }
  return claudeAvailable
}

// Check if npm is available
async function checkNpmInstalled(): Promise<boolean> {
  try {
    await execAsync('npm --version', execOptions)
    return true
  } catch {
    return false
  }
}

// Check if winget is available (Windows 10/11)
async function checkWingetInstalled(): Promise<boolean> {
  if (!isWindows) return false
  try {
    await execAsync('winget --version', execOptions)
    return true
  } catch {
    return false
  }
}

ipcMain.handle('claude:check', async () => {
  const installed = await checkClaudeInstalled()
  const npmInstalled = await checkNpmInstalled()
  return { installed, npmInstalled }
})

ipcMain.handle('node:install', async () => {
  const { shell } = await import('electron')

  try {
    if (isWindows) {
      // Try winget first (cleanest method, built into Windows 10/11)
      const hasWinget = await checkWingetInstalled()
      if (hasWinget) {
        await execAsync('winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements', {
          ...execOptions,
          timeout: 300000 // 5 minutes for download + install
        })
        return { success: true, method: 'winget' }
      }

      // Fallback: Download and run Node.js installer
      shell.openExternal('https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi')
      return { success: true, method: 'download', message: 'Node.js installer opened. Please complete the installation and restart Claude Terminal.' }
    }

    // macOS: Try brew first
    if (process.platform === 'darwin') {
      try {
        await execAsync('brew --version', execOptions)
        await execAsync('brew install node', { ...execOptions, timeout: 300000 })
        return { success: true, method: 'brew' }
      } catch {
        // No brew, open download page
        shell.openExternal('https://nodejs.org/dist/v20.18.1/node-v20.18.1.pkg')
        return { success: true, method: 'download', message: 'Node.js installer opened. Please complete the installation and restart Claude Terminal.' }
      }
    }

    // Linux: Try package managers
    if (process.platform === 'linux') {
      // Try apt (Debian/Ubuntu)
      try {
        await execAsync('apt --version', execOptions)
        // Use NodeSource for latest LTS
        shell.openExternal('https://nodejs.org/en/download/')
        return { success: true, method: 'download', message: 'Please install Node.js from the download page or your package manager, then restart Claude Terminal.' }
      } catch {}

      // Try dnf (Fedora)
      try {
        await execAsync('dnf --version', execOptions)
        shell.openExternal('https://nodejs.org/en/download/')
        return { success: true, method: 'download', message: 'Please install Node.js from the download page or run: sudo dnf install nodejs npm' }
      } catch {}

      // Try pacman (Arch)
      try {
        await execAsync('pacman --version', execOptions)
        shell.openExternal('https://nodejs.org/en/download/')
        return { success: true, method: 'download', message: 'Please install Node.js from the download page or run: sudo pacman -S nodejs npm' }
      } catch {}

      // Generic fallback
      shell.openExternal('https://nodejs.org/en/download/')
      return { success: true, method: 'download', message: 'Please install Node.js from the download page, then restart Claude Terminal.' }
    }

    // Unknown platform
    shell.openExternal('https://nodejs.org/en/download/')
    return { success: true, method: 'download', message: 'Please install Node.js from the download page, then restart Claude Terminal.' }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('claude:install', async () => {
  try {
    // Reset cache so we re-check after install
    claudeAvailable = null

    // Check if npm is available first
    const hasNpm = await checkNpmInstalled()
    if (!hasNpm) {
      return { success: false, error: 'npm is not installed. Please install Node.js first.', needsNode: true }
    }

    // Install Claude Code globally via npm
    await execAsync('npm install -g @anthropic-ai/claude-code', { ...execOptions, timeout: 120000 })

    // Verify installation
    const installed = await checkClaudeInstalled()
    return { success: installed, error: installed ? undefined : 'Installation completed but claude command not found' }
  } catch (e: any) {
    claudeAvailable = null
    return { success: false, error: e.message }
  }
})

// Beads integration
let beadsAvailable: boolean | null = null

// Backwards compat alias
const beadsExecOptions = execOptions

async function checkBeadsInstalled(): Promise<boolean> {
  if (beadsAvailable !== null) return beadsAvailable
  try {
    await execAsync('bd --version', beadsExecOptions)
    beadsAvailable = true
  } catch {
    beadsAvailable = false
  }
  return beadsAvailable
}

ipcMain.handle('beads:check', async (_, cwd: string) => {
  // First check if bd command is available
  const installed = await checkBeadsInstalled()
  if (!installed) return { installed: false, initialized: false }

  // Then check if beads is initialized in this project
  const beadsDir = join(cwd, '.beads')
  return { installed: true, initialized: existsSync(beadsDir) }
})

ipcMain.handle('beads:init', async (_, cwd: string) => {
  try {
    await execAsync('bd init', { ...beadsExecOptions, cwd })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:ready', async (_, cwd: string) => {
  try {
    const { stdout } = await execAsync('bd ready --json', { ...beadsExecOptions, cwd })
    return { success: true, tasks: JSON.parse(stdout) }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:list', async (_, cwd: string) => {
  try {
    const { stdout } = await execAsync('bd list --json', { ...beadsExecOptions, cwd })
    return { success: true, tasks: JSON.parse(stdout) }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:show', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
  try {
    const { stdout } = await execAsync(`bd show ${taskId} --json`, { ...beadsExecOptions, cwd })
    return { success: true, task: JSON.parse(stdout) }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:create', async (_, { cwd, title, description, priority }: { cwd: string; title: string; description?: string; priority?: number }) => {
  try {
    let cmd = `bd create "${title.replace(/"/g, '\\"')}"`
    if (description) cmd += ` -d "${description.replace(/"/g, '\\"')}"`
    if (priority !== undefined) cmd += ` -p ${priority}`
    cmd += ' --json'
    const { stdout } = await execAsync(cmd, { ...beadsExecOptions, cwd })
    return { success: true, task: JSON.parse(stdout) }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:complete', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
  try {
    const { stdout } = await execAsync(`bd close ${taskId} --json`, { ...beadsExecOptions, cwd })
    return { success: true, result: JSON.parse(stdout) }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:delete', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
  try {
    await execAsync(`bd delete ${taskId} --force`, { ...beadsExecOptions, cwd })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:start', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
  try {
    await execAsync(`bd update ${taskId} --status in_progress`, { ...beadsExecOptions, cwd })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// Check if pipx is available (preferred for CLI tools)
async function checkPipxInstalled(): Promise<boolean> {
  try {
    await execAsync('pipx --version', execOptions)
    return true
  } catch {
    return false
  }
}

// Check if pip/pip3 is available
async function checkPipInstalled(): Promise<boolean> {
  try {
    // Try pip3 first (common on Linux/macOS)
    await execAsync('pip3 --version', execOptions)
    return true
  } catch {
    try {
      // Fall back to pip
      await execAsync('pip --version', execOptions)
      return true
    } catch {
      return false
    }
  }
}

ipcMain.handle('beads:install', async () => {
  const { shell } = await import('electron')

  try {
    // Reset cache so we re-check after install
    beadsAvailable = null

    // Try pipx first (better for CLI tools - isolated environment)
    const hasPipx = await checkPipxInstalled()
    if (hasPipx) {
      await execAsync('pipx install beads-cli', { ...execOptions, timeout: 120000 })
      const installed = await checkBeadsInstalled()
      return { success: installed, method: 'pipx', error: installed ? undefined : 'Installation completed but bd command not found' }
    }

    // Try pip/pip3
    const hasPip = await checkPipInstalled()
    if (hasPip) {
      // Use --user flag for safety (no sudo required)
      try {
        await execAsync('pip3 install --user beads-cli', { ...execOptions, timeout: 120000 })
      } catch {
        await execAsync('pip install --user beads-cli', { ...execOptions, timeout: 120000 })
      }
      const installed = await checkBeadsInstalled()
      return { success: installed, method: 'pip', error: installed ? undefined : 'Installation completed but bd command not found. You may need to restart the app.' }
    }

    // No pip available - guide user to install Python
    if (isWindows) {
      shell.openExternal('https://www.python.org/downloads/windows/')
      return { success: false, needsPython: true, error: 'Python is required. Please install Python from the download page, then restart Claude Terminal.' }
    } else if (process.platform === 'darwin') {
      shell.openExternal('https://www.python.org/downloads/macos/')
      return { success: false, needsPython: true, error: 'Python is required. Please install Python from the download page, then restart Claude Terminal.' }
    } else {
      // Linux - suggest package manager
      return { success: false, needsPython: true, error: 'Python/pip is required. Install via: sudo apt install python3-pip (Debian/Ubuntu) or sudo pacman -S python-pip (Arch)' }
    }
  } catch (e: any) {
    beadsAvailable = null
    return { success: false, error: e.message }
  }
})
