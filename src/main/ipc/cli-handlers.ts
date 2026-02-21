import { ipcMain, BrowserWindow } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { isWindows, getEnhancedPathWithPortable, setPortableBinDirs } from '../platform'
import {
  getPortableBinDirs,
  getPortableNpmPath,
  getPortablePipPath,
  installPortableNode,
  installPortablePython,
  installClaudeWithPortableNpm,
} from '../portable-deps'

const execAsync = promisify(exec)

function getExecOptions(): { shell: string | true; env: NodeJS.ProcessEnv } {
  return {
    shell: isWindows ? true : '/bin/bash',
    env: { ...process.env, PATH: getEnhancedPathWithPortable() }
  }
}

interface NpmCliConfig {
  name: string
  command: string
  npmPackage: string
}

const cliCache = new Map<string, boolean | null>()

async function checkCliInstalled(command: string): Promise<boolean> {
  const cached = cliCache.get(command)
  if (cached !== null && cached !== undefined) return cached

  const installed = await execAsync(`${command} --version`, getExecOptions())
    .then(() => true)
    .catch(() => false)

  cliCache.set(command, installed)
  return installed
}

function resetCliCache(command: string): void {
  cliCache.set(command, null)
}

async function installNpmCli(
  config: NpmCliConfig,
  mainWindow: BrowserWindow | null
): Promise<{ success: boolean; error?: string; needsNode?: boolean }> {
  const { name, command, npmPackage } = config
  try {
    resetCliCache(command)
    const portableNpm = getPortableNpmPath()

    if (portableNpm) {
      mainWindow?.webContents.send('install:progress', { type: name, status: `Installing ${name} CLI...`, percent: 10 })
      await execAsync(`"${portableNpm}" install -g ${npmPackage}`, { ...getExecOptions(), timeout: 300000 })
      const portableDirs = getPortableBinDirs()
      setPortableBinDirs(portableDirs)
    } else {
      const hasNpm = await checkNpmInstalled()
      if (!hasNpm) {
        return { success: false, error: 'npm is not installed. Please install Node.js first.', needsNode: true }
      }
      mainWindow?.webContents.send('install:progress', { type: name, status: `Installing ${name} CLI...`, percent: 10 })
      await execAsync(`npm install -g ${npmPackage}`, { ...getExecOptions(), timeout: 300000 })
    }

    mainWindow?.webContents.send('install:progress', { type: name, status: 'Verifying installation...', percent: 90 })
    const installed = await checkCliInstalled(command)
    mainWindow?.webContents.send('install:progress', { type: name, status: installed ? 'Installed!' : 'Failed', percent: 100 })
    return { success: installed, error: installed ? undefined : `Installation completed but ${command} command not found` }
  } catch (e: any) {
    resetCliCache(command)
    return { success: false, error: e.message }
  }
}

let claudeAvailable: boolean | null = null

async function checkClaudeInstalled(): Promise<boolean> {
  if (claudeAvailable !== null) return claudeAvailable
  claudeAvailable = await execAsync('claude --version', getExecOptions())
    .then(() => true)
    .catch(() => false)
  return claudeAvailable
}

async function checkNpmInstalled(): Promise<boolean> {
  return execAsync('npm --version', getExecOptions())
    .then(() => true)
    .catch(() => false)
}

function checkGitBashInstalled(): boolean {
  if (!isWindows) return true
  const gitBashPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
    join(process.env.PROGRAMFILES || '', 'Git', 'bin', 'bash.exe'),
  ]
  for (const bashPath of gitBashPaths) {
    if (existsSync(bashPath)) return true
  }
  return false
}

async function checkWingetInstalled(): Promise<boolean> {
  if (!isWindows) return false
  return execAsync('winget --version', getExecOptions())
    .then(() => true)
    .catch(() => false)
}

async function checkPipInstalled(): Promise<boolean> {
  const pip3Available = await execAsync('pip3 --version', getExecOptions())
    .then(() => true)
    .catch(() => false)
  if (pip3Available) return true

  return execAsync('pip --version', getExecOptions())
    .then(() => true)
    .catch(() => false)
}

function checkGSDInstalled(): boolean {
  const gsdCommandsDir = join(homedir(), '.claude', 'commands')
  const gsdMarkerFile = join(gsdCommandsDir, 'gsd:new-project.md')
  return existsSync(gsdMarkerFile)
}

export function registerCliHandlers(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle('claude:check', async () => {
    const installed = await checkClaudeInstalled()
    const npmInstalled = await checkNpmInstalled()
    const gitBashInstalled = checkGitBashInstalled()
    return { installed, npmInstalled, gitBashInstalled }
  })

  ipcMain.handle('node:install', async () => {
    try {
      const result = await installPortableNode((status, percent) => {
        getMainWindow()?.webContents.send('install:progress', { type: 'node', status, percent })
      })
      if (result.success) {
        const portableDirs = getPortableBinDirs()
        setPortableBinDirs(portableDirs)
        return { success: true, method: 'portable' }
      }
      return result
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('git:install', async () => {
    if (!isWindows) {
      return { success: false, error: 'Git installation is only needed on Windows. Install via your package manager.' }
    }
    const { shell } = await import('electron')
    try {
      getMainWindow()?.webContents.send('install:progress', { type: 'git', status: 'Checking winget...', percent: 0 })
      const hasWinget = await checkWingetInstalled()
      if (hasWinget) {
        getMainWindow()?.webContents.send('install:progress', { type: 'git', status: 'Installing Git via winget...', percent: 20 })
        try {
          await execAsync('winget install --id Git.Git --source winget --accept-package-agreements --accept-source-agreements', {
            ...getExecOptions(),
            timeout: 300000
          })
          getMainWindow()?.webContents.send('install:progress', { type: 'git', status: 'Git installed!', percent: 100 })
          return { success: true, method: 'winget', message: 'Git installed! Please restart Simple Code GUI.' }
        } catch (e: any) {
          console.log('Winget install failed, falling back to download:', e.message)
        }
      }
      getMainWindow()?.webContents.send('install:progress', { type: 'git', status: 'Opening download page...', percent: 50 })
      shell.openExternal('https://git-scm.com/downloads/win')
      return {
        success: false,
        method: 'download',
        message: 'Please download and install Git for Windows, then restart Simple Code GUI.'
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('claude:install', async () => {
    try {
      claudeAvailable = null
      const portableNpm = getPortableNpmPath()
      if (portableNpm) {
        const result = await installClaudeWithPortableNpm()
        if (result.success) {
          const portableDirs = getPortableBinDirs()
          setPortableBinDirs(portableDirs)
          const installed = await checkClaudeInstalled()
          return { success: installed, error: installed ? undefined : 'Installation completed but claude command not found' }
        }
        return result
      }
      const hasNpm = await checkNpmInstalled()
      if (!hasNpm) {
        return { success: false, error: 'npm is not installed. Please install Node.js first.', needsNode: true }
      }
      await execAsync('npm install -g @anthropic-ai/claude-code', { ...getExecOptions(), timeout: 120000 })
      const installed = await checkClaudeInstalled()
      return { success: installed, error: installed ? undefined : 'Installation completed but claude command not found' }
    } catch (e: any) {
      claudeAvailable = null
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('gemini:check', async () => {
    const installed = await checkCliInstalled('gemini')
    const npmInstalled = await checkNpmInstalled()
    return { installed, npmInstalled }
  })

  ipcMain.handle('gemini:install', async () => {
    return installNpmCli({ name: 'Gemini', command: 'gemini', npmPackage: '@google/gemini-cli' }, getMainWindow())
  })

  ipcMain.handle('codex:check', async () => {
    const installed = await checkCliInstalled('codex')
    const npmInstalled = await checkNpmInstalled()
    return { installed, npmInstalled }
  })

  ipcMain.handle('codex:install', async () => {
    return installNpmCli({ name: 'Codex', command: 'codex', npmPackage: '@openai/codex' }, getMainWindow())
  })

  ipcMain.handle('opencode:check', async () => {
    const installed = await checkCliInstalled('opencode')
    const npmInstalled = await checkNpmInstalled()
    return { installed, npmInstalled }
  })

  ipcMain.handle('opencode:install', async () => {
    return installNpmCli({ name: 'OpenCode', command: 'opencode', npmPackage: 'opencode-ai' }, getMainWindow())
  })

  ipcMain.handle('aider:check', async () => {
    const installed = await checkCliInstalled('aider')
    const pipInstalled = await checkPipInstalled()
    return { installed, pipInstalled }
  })

  ipcMain.handle('aider:install', async () => {
    try {
      resetCliCache('aider')
      const portablePip = getPortablePipPath()
      if (portablePip) {
        getMainWindow()?.webContents.send('install:progress', { type: 'aider', status: 'Installing Aider...', percent: 10 })
        await execAsync(`"${portablePip}" install aider-chat`, { ...getExecOptions(), timeout: 600000 })
        const portableDirs = getPortableBinDirs()
        setPortableBinDirs(portableDirs)
      } else {
        const hasPip = await checkPipInstalled()
        if (!hasPip) {
          return { success: false, error: 'pip is not installed. Please install Python first.', needsPython: true }
        }
        getMainWindow()?.webContents.send('install:progress', { type: 'aider', status: 'Installing Aider...', percent: 10 })
        try {
          await execAsync('pip3 install aider-chat', { ...getExecOptions(), timeout: 600000 })
        } catch {
          await execAsync('pip install aider-chat', { ...getExecOptions(), timeout: 600000 })
        }
      }
      getMainWindow()?.webContents.send('install:progress', { type: 'aider', status: 'Verifying installation...', percent: 90 })
      const installed = await checkCliInstalled('aider')
      getMainWindow()?.webContents.send('install:progress', { type: 'aider', status: installed ? 'Installed!' : 'Failed', percent: 100 })
      return { success: installed, error: installed ? undefined : 'Installation completed but aider command not found' }
    } catch (e: any) {
      resetCliCache('aider')
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('gsd:check', async () => {
    const installed = checkGSDInstalled()
    const npmInstalled = await checkNpmInstalled()
    return { installed, npmInstalled }
  })

  ipcMain.handle('gsd:install', async () => {
    try {
      getMainWindow()?.webContents.send('install:progress', { type: 'gsd', status: 'Installing Get Shit Done...', percent: 10 })
      getMainWindow()?.webContents.send('install:progress', { type: 'gsd', status: 'Running GSD installer...', percent: 30 })
      await execAsync(`npx --yes get-shit-done-cc --global`, { ...getExecOptions(), timeout: 300000 })
      getMainWindow()?.webContents.send('install:progress', { type: 'gsd', status: 'Verifying installation...', percent: 90 })
      const installed = checkGSDInstalled()
      getMainWindow()?.webContents.send('install:progress', { type: 'gsd', status: installed ? 'Installed!' : 'Failed', percent: 100 })
      return {
        success: installed,
        error: installed ? undefined : 'Installation completed but GSD commands not found. Try running: npx get-shit-done-cc'
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('python:install', async () => {
    try {
      const result = await installPortablePython((status, percent) => {
        getMainWindow()?.webContents.send('install:progress', { type: 'python', status, percent })
      })
      if (result.success) {
        const portableDirs = getPortableBinDirs()
        setPortableBinDirs(portableDirs)
        return { success: true, method: 'portable' }
      }
      return result
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })
}

export { getExecOptions, checkCliInstalled, resetCliCache }
