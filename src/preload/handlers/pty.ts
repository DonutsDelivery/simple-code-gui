import { ipcRenderer, IpcRendererEvent } from 'electron'

type Backend = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'

export const ptyHandlers = {
  spawnPty: (cwd: string, sessionId?: string, model?: string, backend?: Backend): Promise<string> =>
    ipcRenderer.invoke('pty:spawn', { cwd, sessionId, model, backend }),

  writePty: (id: string, data: string): void => ipcRenderer.send('pty:write', { id, data }),

  resizePty: (id: string, cols: number, rows: number): void => ipcRenderer.send('pty:resize', { id, cols, rows }),

  killPty: (id: string): void => ipcRenderer.send('pty:kill', id),

  setPtyBackend: (id: string, backend: Backend): Promise<void> =>
    ipcRenderer.invoke('pty:set-backend', { id, backend }),

  onPtyData: (id: string, callback: (data: string) => void): (() => void) => {
    const handler = (_: IpcRendererEvent, data: string) => callback(data)
    ipcRenderer.on(`pty:data:${id}`, handler)
    return () => ipcRenderer.removeListener(`pty:data:${id}`, handler)
  },

  onPtyExit: (id: string, callback: (code: number) => void): (() => void) => {
    const handler = (_: IpcRendererEvent, code: number) => callback(code)
    ipcRenderer.on(`pty:exit:${id}`, handler)
    return () => ipcRenderer.removeListener(`pty:exit:${id}`, handler)
  },

  onPtyRecreated: (callback: (data: { oldId: string; newId: string; backend: Backend }) => void): (() => void) => {
    const handler = (_: IpcRendererEvent, data: { oldId: string; newId: string; backend: Backend }) => callback(data)
    ipcRenderer.on('pty:recreated', handler)
    return () => ipcRenderer.removeListener('pty:recreated', handler)
  }
}
