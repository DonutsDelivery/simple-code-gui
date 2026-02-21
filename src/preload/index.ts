import { contextBridge } from 'electron'

import { workspaceHandlers } from './handlers/workspace.js'
import { ptyHandlers } from './handlers/pty.js'
import { voiceHandlers } from './handlers/voice.js'
import { cliHandlers } from './handlers/cli.js'
import { beadsHandlers } from './handlers/beads.js'
import { miscHandlers } from './handlers/misc.js'
import type { ElectronAPI } from './types/api.js'

// Re-export types for external consumers
export type { ThemeCustomization, Settings } from './types/settings.js'
export type { ProjectCategory, Project, OpenTab, Workspace, TileLayout, Session } from './types/workspace.js'
export type { BeadsTask, BeadsCloseResult } from './types/beads.js'
export type { VoiceSettings } from './types/voice.js'
export type { Extension } from './types/extension.js'
export type { ElectronAPI } from './types/api.js'

const api: ElectronAPI = {
  ...workspaceHandlers,
  ...ptyHandlers,
  ...voiceHandlers,
  ...cliHandlers,
  ...beadsHandlers,
  ...miscHandlers
}

contextBridge.exposeInMainWorld('electronAPI', api)
