import { ipcRenderer, IpcRendererEvent } from 'electron'

export const cliHandlers = {
  // Claude Code & Node.js & Python & Git
  claudeCheck: () => ipcRenderer.invoke('claude:check'),
  claudeInstall: () => ipcRenderer.invoke('claude:install'),
  nodeInstall: () => ipcRenderer.invoke('node:install'),
  gitInstall: () => ipcRenderer.invoke('git:install'),
  pythonInstall: () => ipcRenderer.invoke('python:install'),
  onInstallProgress: (callback: (data: { type: string; status: string; percent?: number }) => void): (() => void) => {
    const handler = (_: IpcRendererEvent, data: { type: string; status: string; percent?: number }) => callback(data)
    ipcRenderer.on('install:progress', handler)
    return () => ipcRenderer.removeListener('install:progress', handler)
  },

  // Gemini CLI
  geminiCheck: () => ipcRenderer.invoke('gemini:check'),
  geminiInstall: () => ipcRenderer.invoke('gemini:install'),

  // Codex CLI
  codexCheck: () => ipcRenderer.invoke('codex:check'),
  codexInstall: () => ipcRenderer.invoke('codex:install'),

  // OpenCode CLI
  opencodeCheck: () => ipcRenderer.invoke('opencode:check'),
  opencodeInstall: () => ipcRenderer.invoke('opencode:install'),

  // Aider CLI
  aiderCheck: () => ipcRenderer.invoke('aider:check'),
  aiderInstall: () => ipcRenderer.invoke('aider:install'),

  // Get Shit Done (GSD) - Claude Code workflow addon
  gsdCheck: () => ipcRenderer.invoke('gsd:check'),
  gsdInstall: () => ipcRenderer.invoke('gsd:install'),
  gsdProjectCheck: (cwd: string) => ipcRenderer.invoke('gsd:projectCheck', cwd),
  gsdGetProgress: (cwd: string) => ipcRenderer.invoke('gsd:getProgress', cwd)
}
