import { ipcRenderer, webUtils, IpcRendererEvent } from 'electron'
import type { Settings } from '../types/settings.js'
import type { Extension } from '../types/extension.js'

export const miscHandlers = {
  // Settings
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Settings): Promise<void> => ipcRenderer.invoke('settings:save', settings),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('settings:selectDirectory'),

  // Project creation
  createProject: (name: string, parentDir: string) => ipcRenderer.invoke('project:create', { name, parentDir }),

  // Executable
  selectExecutable: (): Promise<string | null> => ipcRenderer.invoke('executable:select'),
  runExecutable: (executable: string, cwd: string) => ipcRenderer.invoke('executable:run', { executable, cwd }),

  // API Server
  apiStart: (projectPath: string, port: number) => ipcRenderer.invoke('api:start', { projectPath, port }),
  apiStop: (projectPath: string) => ipcRenderer.invoke('api:stop', projectPath),
  apiStatus: (projectPath: string) => ipcRenderer.invoke('api:status', projectPath),
  onApiOpenSession: (callback: (data: { projectPath: string; autoClose: boolean; model?: string }) => void): (() => void) => {
    const handler = (_: IpcRendererEvent, data: { projectPath: string; autoClose: boolean; model?: string }) => callback(data)
    ipcRenderer.on('api:open-session', handler)
    return () => ipcRenderer.removeListener('api:open-session', handler)
  },

  // Mobile Server
  mobileGetConnectionInfo: () => ipcRenderer.invoke('mobile:getConnectionInfo'),
  mobileRegenerateToken: () => ipcRenderer.invoke('mobile:regenerateToken'),
  mobileIsRunning: () => ipcRenderer.invoke('mobile:isRunning'),
  mobileSendFile: (filePath: string, message?: string) => ipcRenderer.invoke('mobile:sendFile', filePath, message),
  mobileGetConnectedClients: () => ipcRenderer.invoke('mobile:getConnectedClients'),
  mobileGetPendingFiles: () => ipcRenderer.invoke('mobile:getPendingFiles'),

  // Updater
  getVersion: () => ipcRenderer.invoke('updater:getVersion'),
  checkForUpdate: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (callback: (data: { status: string; version?: string; progress?: number; error?: string }) => void): (() => void) => {
    const handler = (_: IpcRendererEvent, data: { status: string; version?: string; progress?: number; error?: string }) => callback(data)
    ipcRenderer.on('updater:status', handler)
    return () => ipcRenderer.removeListener('updater:status', handler)
  },

  // Clipboard
  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),

  // File utilities
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Debug logging
  debugLog: (message: string) => ipcRenderer.send('debug:log', message),

  // App utilities
  isDebugMode: () => ipcRenderer.invoke('app:isDebugMode'),
  refresh: () => ipcRenderer.invoke('app:refresh'),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),

  // Custom commands
  commandsSave: (name: string, content: string, projectPath: string | null) =>
    ipcRenderer.invoke('commands:save', { name, content, projectPath }),

  // CLAUDE.md editor
  claudeMdRead: (projectPath: string) => ipcRenderer.invoke('claudemd:read', projectPath),
  claudeMdSave: (projectPath: string, content: string) => ipcRenderer.invoke('claudemd:save', { projectPath, content }),

  // Auto Work mode marker
  autoworkSetActive: (projectPath: string) => ipcRenderer.invoke('autowork:setActive', projectPath),
  autoworkClearActive: (projectPath: string) => ipcRenderer.invoke('autowork:clearActive', projectPath),

  // Extensions
  extensionsFetchRegistry: (forceRefresh?: boolean) => ipcRenderer.invoke('extensions:fetchRegistry', forceRefresh),
  extensionsFetchFromUrl: (url: string) => ipcRenderer.invoke('extensions:fetchFromUrl', url),
  extensionsInstallSkill: (extension: Extension, scope?: 'global' | 'project', projectPath?: string) =>
    ipcRenderer.invoke('extensions:installSkill', { extension, scope, projectPath }),
  extensionsInstallMcp: (extension: Extension, config?: Record<string, unknown>) =>
    ipcRenderer.invoke('extensions:installMcp', { extension, config }),
  extensionsRemove: (extensionId: string) => ipcRenderer.invoke('extensions:remove', extensionId),
  extensionsUpdate: (extensionId: string) => ipcRenderer.invoke('extensions:update', extensionId),
  extensionsGetInstalled: () => ipcRenderer.invoke('extensions:getInstalled'),
  extensionsGetForProject: (projectPath: string) => ipcRenderer.invoke('extensions:getForProject', projectPath),
  extensionsGetCommands: (projectPath: string) => ipcRenderer.invoke('extensions:getCommands', projectPath),
  extensionsGetConfig: (extensionId: string) => ipcRenderer.invoke('extensions:getConfig', extensionId),
  extensionsSetConfig: (extensionId: string, config: Record<string, unknown>) =>
    ipcRenderer.invoke('extensions:setConfig', { extensionId, config }),
  extensionsEnableForProject: (extensionId: string, projectPath: string) =>
    ipcRenderer.invoke('extensions:enableForProject', { extensionId, projectPath }),
  extensionsDisableForProject: (extensionId: string, projectPath: string) =>
    ipcRenderer.invoke('extensions:disableForProject', { extensionId, projectPath }),
  extensionsAddCustomUrl: (url: string) => ipcRenderer.invoke('extensions:addCustomUrl', url),
  extensionsRemoveCustomUrl: (url: string) => ipcRenderer.invoke('extensions:removeCustomUrl', url),
  extensionsGetCustomUrls: () => ipcRenderer.invoke('extensions:getCustomUrls')
}
