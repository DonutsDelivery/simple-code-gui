import { contextBridge, ipcRenderer } from 'electron'

export interface ElectronAPI {
  // Workspace
  getWorkspace: () => Promise<any>
  saveWorkspace: (workspace: any) => Promise<void>
  addProject: () => Promise<string | null>

  // Sessions
  discoverSessions: (projectPath: string) => Promise<any[]>

  // PTY
  spawnPty: (cwd: string, sessionId?: string) => Promise<string>
  writePty: (id: string, data: string) => void
  resizePty: (id: string, cols: number, rows: number) => void
  killPty: (id: string) => void
  onPtyData: (id: string, callback: (data: string) => void) => () => void
  onPtyExit: (id: string, callback: (code: number) => void) => () => void
}

const api: ElectronAPI = {
  // Workspace management
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  saveWorkspace: (workspace) => ipcRenderer.invoke('workspace:save', workspace),
  addProject: () => ipcRenderer.invoke('workspace:addProject'),

  // Session discovery
  discoverSessions: (projectPath) => ipcRenderer.invoke('sessions:discover', projectPath),

  // PTY management
  spawnPty: (cwd, sessionId) => ipcRenderer.invoke('pty:spawn', { cwd, sessionId }),
  writePty: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  resizePty: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  killPty: (id) => ipcRenderer.send('pty:kill', id),

  onPtyData: (id, callback) => {
    const handler = (_: any, data: string) => callback(data)
    ipcRenderer.on(`pty:data:${id}`, handler)
    return () => ipcRenderer.removeListener(`pty:data:${id}`, handler)
  },

  onPtyExit: (id, callback) => {
    const handler = (_: any, code: number) => callback(code)
    ipcRenderer.on(`pty:exit:${id}`, handler)
    return () => ipcRenderer.removeListener(`pty:exit:${id}`, handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
