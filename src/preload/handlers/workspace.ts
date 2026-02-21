import { ipcRenderer } from 'electron'
import type { Workspace } from '../types/workspace.js'

export const workspaceHandlers = {
  getWorkspace: (): Promise<Workspace> => ipcRenderer.invoke('workspace:get'),
  saveWorkspace: (workspace: Workspace): Promise<void> => ipcRenderer.invoke('workspace:save', workspace),
  addProject: (): Promise<string | null> => ipcRenderer.invoke('workspace:addProject'),
  addProjectsFromParent: (): Promise<Array<{ path: string; name: string }> | null> => ipcRenderer.invoke('workspace:addProjectsFromParent'),
  getMetaProjectsPath: (): Promise<string> => ipcRenderer.invoke('workspace:getMetaProjectsPath'),
  getCategoryMetaPath: (categoryName: string): Promise<string> => ipcRenderer.invoke('workspace:getCategoryMetaPath', categoryName),

  discoverSessions: (projectPath: string, backend?: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider') =>
    ipcRenderer.invoke('sessions:discover', projectPath, backend)
}
