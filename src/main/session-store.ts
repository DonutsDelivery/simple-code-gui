import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface ProjectCategory {
  id: string
  name: string
  collapsed: boolean
  order: number
}

export interface Project {
  path: string
  name: string
  executable?: string
  apiPort?: number  // Port for HTTP API to send prompts to terminal
  apiAutoStart?: boolean  // Whether to auto-start API when session opens (default: false)
  apiSessionMode?: 'existing' | 'new-keep' | 'new-close'  // How API requests handle sessions
  apiModel?: 'default' | 'opus' | 'sonnet' | 'haiku'  // Model for API-triggered sessions
  autoAcceptTools?: string[]  // Per-project tool patterns to auto-accept
  permissionMode?: string     // Per-project permission mode
  color?: string              // Project color for visual identification
  ttsVoice?: string           // Per-project TTS voice (overrides global)
  ttsEngine?: 'piper' | 'xtts'  // Per-project TTS engine
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' // Per-project backend (overrides global)
  categoryId?: string         // Category this project belongs to
  order?: number              // Order within category or uncategorized list
}

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  backend?: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
}

export interface TileLayout {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface Workspace {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
  viewMode?: 'tabs' | 'tiled'
  tileLayout?: TileLayout[]
  categories?: ProjectCategory[]
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Settings {
  defaultProjectDir: string
  theme: string
  autoAcceptTools?: string[]  // List of tool patterns to auto-accept (e.g., "Bash(git:*)", "Read", "Write")
  permissionMode?: string     // Permission mode: default, acceptEdits, dontAsk, bypassPermissions
  backend?: 'claude' | 'gemini' | 'codex' | 'opencode'
  voiceOutputEnabled?: boolean
  voiceVolume?: number
  voiceSpeed?: number
  voiceSkipOnNew?: boolean
}

interface StoredData {
  workspace: Workspace
  windowBounds?: WindowBounds
  settings?: Settings
}

export class SessionStore {
  private configPath: string
  private data: StoredData

  constructor() {
    const configDir = join(app.getPath('userData'), 'config')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    this.configPath = join(configDir, 'workspace.json')
    this.data = this.load()
  }

  private load(): StoredData {
    try {
      if (existsSync(this.configPath)) {
        const content = readFileSync(this.configPath, 'utf-8')
        return JSON.parse(content)
      }
    } catch (e) {
      console.error('Failed to load workspace:', e)
    }
    return {
      workspace: {
        projects: [],
        openTabs: [],
        activeTabId: null
      }
    }
  }

  private save(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.data, null, 2))
    } catch (e) {
      console.error('Failed to save workspace:', e)
    }
  }

  getWorkspace(): Workspace {
    return this.data.workspace
  }

  saveWorkspace(workspace: Workspace): void {
    this.data.workspace = workspace
    this.save()
  }

  getWindowBounds(): WindowBounds | undefined {
    return this.data.windowBounds
  }

  saveWindowBounds(bounds: WindowBounds): void {
    this.data.windowBounds = bounds
    this.save()
  }

  getSettings(): Settings {
    return this.data.settings ?? { defaultProjectDir: '', theme: 'default' }
  }

  saveSettings(settings: Settings): void {
    this.data.settings = settings
    this.save()
  }
}
