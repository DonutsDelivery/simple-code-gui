import { ipcRenderer, IpcRendererEvent } from 'electron'

export const beadsHandlers = {
  beadsCheck: (cwd: string) => ipcRenderer.invoke('beads:check', cwd),
  beadsInit: (cwd: string) => ipcRenderer.invoke('beads:init', cwd),
  beadsInstall: () => ipcRenderer.invoke('beads:install'),
  beadsReady: (cwd: string) => ipcRenderer.invoke('beads:ready', cwd),
  beadsList: (cwd: string) => ipcRenderer.invoke('beads:list', cwd),
  beadsShow: (cwd: string, taskId: string) => ipcRenderer.invoke('beads:show', { cwd, taskId }),
  beadsCreate: (cwd: string, title: string, description?: string, priority?: number, type?: string, labels?: string) =>
    ipcRenderer.invoke('beads:create', { cwd, title, description, priority, type, labels }),
  beadsComplete: (cwd: string, taskId: string) => ipcRenderer.invoke('beads:complete', { cwd, taskId }),
  beadsDelete: (cwd: string, taskId: string) => ipcRenderer.invoke('beads:delete', { cwd, taskId }),
  beadsStart: (cwd: string, taskId: string) => ipcRenderer.invoke('beads:start', { cwd, taskId }),
  beadsUpdate: (cwd: string, taskId: string, status?: string, title?: string, description?: string, priority?: number) =>
    ipcRenderer.invoke('beads:update', { cwd, taskId, status, title, description, priority }),
  beadsWatch: (cwd: string) => ipcRenderer.invoke('beads:watch', cwd),
  beadsUnwatch: (cwd: string) => ipcRenderer.invoke('beads:unwatch', cwd),
  onBeadsTasksChanged: (callback: (data: { cwd: string }) => void): (() => void) => {
    const handler = (_: IpcRendererEvent, data: { cwd: string }) => callback(data)
    ipcRenderer.on('beads:tasks-changed', handler)
    return () => ipcRenderer.removeListener('beads:tasks-changed', handler)
  }
}
