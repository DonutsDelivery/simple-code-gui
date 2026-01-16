import { ipcMain, BrowserWindow } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'
import { getEnhancedPathWithPortable, setPortableBinDirs } from '../platform'
import { getPortableBinDirs, installBeadsBinary, getBeadsBinaryPath } from '../portable-deps'

const execAsync = promisify(exec)

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
      const { stdout } = await execAsync(`bd show ${taskId} --json`, { ...getBeadsExecOptions(), cwd })
      return { success: true, task: JSON.parse(stdout) }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:create', async (_, { cwd, title, description, priority, type, labels }: { cwd: string; title: string; description?: string; priority?: number; type?: string; labels?: string }) => {
    try {
      let cmd = `bd create "${title.replace(/"/g, '\\"')}"`
      if (description) cmd += ` -d "${description.replace(/"/g, '\\"')}"`
      if (priority !== undefined) cmd += ` -p ${priority}`
      if (type) cmd += ` -t ${type}`
      if (labels) cmd += ` -l "${labels.replace(/"/g, '\\"')}"`
      cmd += ' --json'
      const { stdout } = await execAsync(cmd, { ...getBeadsExecOptions(), cwd })
      return { success: true, task: JSON.parse(stdout) }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:complete', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
    try {
      const { stdout } = await execAsync(`bd close ${taskId} --json`, { ...getBeadsExecOptions(), cwd })
      return { success: true, result: JSON.parse(stdout) }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:delete', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
    try {
      await execAsync(`bd delete ${taskId} --force`, { ...getBeadsExecOptions(), cwd })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:start', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
    try {
      await execAsync(`bd update ${taskId} --status in_progress`, { ...getBeadsExecOptions(), cwd })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('beads:update', async (_, { cwd, taskId, status, title, description, priority }: { cwd: string; taskId: string; status?: string; title?: string; description?: string; priority?: number }) => {
    try {
      const args = [taskId]
      if (status) args.push('--status', status)
      if (title) args.push('--title', `"${title.replace(/"/g, '\\"')}"`)
      if (description !== undefined) args.push('--description', `"${description.replace(/"/g, '\\"')}"`)
      if (priority !== undefined) args.push('--priority', String(priority))
      await execAsync(`bd update ${args.join(' ')}`, { ...getBeadsExecOptions(), cwd })
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
}

export { getBeadsExecOptions }
