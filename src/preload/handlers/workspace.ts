import { ipcRenderer } from 'electron'
import type { Workspace } from '../types/workspace.js'
import type { EnvironmentEvent, EnvironmentEventsResult, EnvironmentSnapshot, EnvironmentCommandResult } from '../../common/environment-protocol.js'
import type { CommandEnvelope, EventEnvelope } from '../../common/server-protocol.js'
import type { EnvironmentCommand } from '../../main/environment-command-router.js'

export const workspaceHandlers = {
  getWorkspace: (): Promise<Workspace> => ipcRenderer.invoke('workspace:get'),
  saveWorkspace: (workspace: Workspace): Promise<void> => ipcRenderer.invoke('workspace:save', workspace),
  getEnvironmentSnapshot: (): Promise<EnvironmentSnapshot<Workspace>> => ipcRenderer.invoke('environment:getSnapshot'),
  getEnvironmentEvents: (afterRevision: number): Promise<EnvironmentEventsResult<Workspace>> => ipcRenderer.invoke('environment:getEvents', afterRevision),
  executeEnvironmentCommand: (command: CommandEnvelope<EnvironmentCommand>): Promise<EnvironmentCommandResult> => ipcRenderer.invoke('environment:executeCommand', command),
  onEnvironmentEvent: (callback: (event: EventEnvelope<EnvironmentEvent<Workspace>>) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: EventEnvelope<EnvironmentEvent<Workspace>>) => callback(value)
    ipcRenderer.on('environment:event', listener)
    return () => ipcRenderer.removeListener('environment:event', listener)
  },
  addProject: (): Promise<string | null> => ipcRenderer.invoke('workspace:addProject'),
  addProjectsFromParent: (): Promise<Array<{ path: string; name: string }> | null> => ipcRenderer.invoke('workspace:addProjectsFromParent'),
  getMetaProjectsPath: (): Promise<string> => ipcRenderer.invoke('workspace:getMetaProjectsPath'),
  getCategoryMetaPath: (categoryName: string): Promise<string> => ipcRenderer.invoke('workspace:getCategoryMetaPath', categoryName),

  discoverSessions: (projectPath: string, backend?: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok') =>
    ipcRenderer.invoke('sessions:discover', projectPath, backend)
}
