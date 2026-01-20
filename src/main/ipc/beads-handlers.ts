import { ipcMain, BrowserWindow } from 'electron'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync, watch as fsWatch, FSWatcher } from 'fs'
import { join } from 'path'
import { getEnhancedPathWithPortable, setPortableBinDirs } from '../platform'
import { getPortableBinDirs, installBeadsBinary, getBeadsBinaryPath } from '../portable-deps'

const execAsync = promisify(exec)

// File system watchers for .beads directories
const beadsWatchers = new Map<string, FSWatcher>()

// Debounce timers for file change events
const debounceTimers = new Map<string, NodeJS.Timeout>()

// Debounce delay in ms
const DEBOUNCE_DELAY = 500

// Validate taskId to prevent shell command injection
// Task IDs should only contain alphanumeric characters, hyphens, and underscores
const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
function validateTaskId(taskId: string): void {
  if (!taskId || !TASK_ID_PATTERN.test(taskId)) {
    throw new Error(`Invalid task ID: ${taskId}`)
  }
}

// Execute bd command with arguments using spawn (safer than exec with template literals)
function spawnBdCommand(args: string[], options: { cwd?: string }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const execOptions = getBeadsExecOptions()
    const proc = spawn('bd', args, {
      cwd: options.cwd,
      env: execOptions.env,
      shell: false // Explicitly disable shell to prevent injection
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        const error = new Error(stderr || `Command failed with code ${code}`)
        reject(error)
      }
    })

    proc.on('error', reject)
  })
}

let beadsAvailable: boolean | null = null

function getBeadsExecOptions() {
  const beadsBinPath = getBeadsBinaryPath()
  let PATH = getEnhancedPathWithPortable()
  if (beadsBinPath) {
    PATH = `${beadsBinPath}:${PATH}`
  }
  return {
    shell: process.platform === 'win32' ? true as const : '/bin/bash',
    env: { ...process.env, PATH }
  }
}

async function checkBeadsInstalled(): Promise<boolean> {
  if (beadsAvailable !== null) return beadsAvailable
  beadsAvailable = await execAsync('bd --version', getBeadsExecOptions())
    .then(() => true)
    .catch(() => false)
  return beadsAvailable
}

export function registerBeadsHandlers(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle('beads:check', async (_, cwd: string) => {
    const installed = await checkBeadsInstalled()
    if (!installed) return { installed: false, initialized: false }
    const beadsDir = join(cwd, '.beads')
    return { installed: true, initialized: existsSync(beadsDir) }
  })

  ipcMain.handle('beads:init', async (_, cwd: string) => {
    try {
      await execAsync('bd init', { ...getBeadsExecOptions(), cwd })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:ready', async (_, cwd: string) => {
    try {
      const { stdout } = await execAsync('bd ready --json', { ...getBeadsExecOptions(), cwd })
      return { success: true, tasks: JSON.parse(stdout) }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:list', async (_, cwd: string) => {
    try {
      const { stdout } = await execAsync('bd list --json', { ...getBeadsExecOptions(), cwd })
      return { success: true, tasks: JSON.parse(stdout) }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:show', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
    try {
      validateTaskId(taskId)
      const { stdout } = await spawnBdCommand(['show', taskId, '--json'], { cwd })
      return { success: true, task: JSON.parse(stdout) }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:create', async (_, { cwd, title, description, priority, type, labels }: { cwd: string; title: string; description?: string; priority?: number; type?: string; labels?: string }) => {
    try {
      // Validate inputs
      if (!title || typeof title !== 'string') {
        return { success: false, error: 'Title is required' }
      }
      if (type && !TASK_ID_PATTERN.test(type)) {
        return { success: false, error: 'Invalid type format' }
      }
      const args = ['create', title]
      if (description) args.push('-d', description)
      if (priority !== undefined) args.push('-p', String(priority))
      if (type) args.push('-t', type)
      if (labels) args.push('-l', labels)
      args.push('--json')
      const { stdout } = await spawnBdCommand(args, { cwd })
      return { success: true, task: JSON.parse(stdout) }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:complete', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
    try {
      validateTaskId(taskId)
      const { stdout } = await spawnBdCommand(['close', taskId, '--json'], { cwd })
      return { success: true, result: JSON.parse(stdout) }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:delete', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
    try {
      validateTaskId(taskId)
      await spawnBdCommand(['delete', taskId, '--force'], { cwd })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:start', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
    try {
      validateTaskId(taskId)
      await spawnBdCommand(['update', taskId, '--status', 'in_progress'], { cwd })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:update', async (_, { cwd, taskId, status, title, description, priority }: { cwd: string; taskId: string; status?: string; title?: string; description?: string; priority?: number }) => {
    try {
      validateTaskId(taskId)
      const args = ['update', taskId]
      if (status) args.push('--status', status)
      if (title) args.push('--title', title)
      if (description !== undefined) args.push('--description', description)
      if (priority !== undefined) args.push('--priority', String(priority))
      await spawnBdCommand(args, { cwd })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:install', async () => {
    try {
      beadsAvailable = null
      const result = await installBeadsBinary((status, percent) => {
        getMainWindow()?.webContents.send('install:progress', { type: 'beads', status, percent })
      })
      if (result.success) {
        const portableDirs = getPortableBinDirs()
        setPortableBinDirs(portableDirs)
        const installed = await checkBeadsInstalled()
        return { success: installed, method: 'binary', error: installed ? undefined : 'Installation completed but bd command not found' }
      }
      return result
    } catch (e: any) {
      beadsAvailable = null
      return { success: false, error: e.message }
    }
  })

  // Start watching a project's .beads directory for changes
  ipcMain.handle('beads:watch', async (_, cwd: string) => {
    // Already watching this project
    if (beadsWatchers.has(cwd)) {
      return { success: true }
    }

    const beadsDir = join(cwd, '.beads')
    if (!existsSync(beadsDir)) {
      return { success: false, error: '.beads directory does not exist' }
    }

    try {
      const watcher = fsWatch(beadsDir, { recursive: true }, (eventType, filename) => {
        // Ignore certain files that shouldn't trigger updates (like lock files, socket files)
        if (filename && (filename.endsWith('.lock') || filename.endsWith('.sock') || filename.includes('.startlock'))) {
          return
        }

        // Debounce: clear existing timer and set a new one
        const existingTimer = debounceTimers.get(cwd)
        if (existingTimer) {
          clearTimeout(existingTimer)
        }

        const timer = setTimeout(() => {
          debounceTimers.delete(cwd)
          // Emit the tasks-changed event to the renderer
          getMainWindow()?.webContents.send('beads:tasks-changed', { cwd })
        }, DEBOUNCE_DELAY)

        debounceTimers.set(cwd, timer)
      })

      watcher.on('error', (err) => {
        console.error(`Beads watcher error for ${cwd}:`, err)
        // Clean up on error
        beadsWatchers.delete(cwd)
      })

      beadsWatchers.set(cwd, watcher)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Stop watching a project's .beads directory
  ipcMain.handle('beads:unwatch', async (_, cwd: string) => {
    const watcher = beadsWatchers.get(cwd)
    if (watcher) {
      watcher.close()
      beadsWatchers.delete(cwd)

      // Clear any pending debounce timer
      const timer = debounceTimers.get(cwd)
      if (timer) {
        clearTimeout(timer)
        debounceTimers.delete(cwd)
      }
    }
    return { success: true }
  })
}

export { getBeadsExecOptions, checkBeadsInstalled, spawnBdCommand, validateTaskId, TASK_ID_PATTERN }
