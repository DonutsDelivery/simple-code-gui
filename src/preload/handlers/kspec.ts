import { ipcRenderer } from 'electron'

export const kspecHandlers = {
  kspecCheck: (cwd: string) => ipcRenderer.invoke('kspec:check', cwd),
  kspecInit: (cwd: string) => ipcRenderer.invoke('kspec:init', cwd),
  kspecEnsureDaemon: (cwd: string) => ipcRenderer.invoke('kspec:ensure-daemon', cwd),
  kspecCheckCli: () => ipcRenderer.invoke('kspec:check-cli'),
  kspecInstallCli: () => ipcRenderer.invoke('kspec:install-cli'),
  kspecMigrateFromBeads: (cwd: string) => ipcRenderer.invoke('kspec:migrate-from-beads', cwd),
  kspecDispatchStart: (cwd: string) => ipcRenderer.invoke('kspec:dispatch-start', cwd),
  kspecDispatchStop: (cwd: string) => ipcRenderer.invoke('kspec:dispatch-stop', cwd),
  kspecDispatchStatus: (cwd: string) => ipcRenderer.invoke('kspec:dispatch-status', cwd)
}
