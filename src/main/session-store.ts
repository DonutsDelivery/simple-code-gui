import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { syncMetaProjects } from './meta-project-sync'

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
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' // Per-project backend (overrides global)
  categoryId?: string         // Category this project belongs to
  order?: number              // Order within category or uncategorized list
}

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  ptyId?: string
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
}

export interface TileLayout {
  id: string
  tabIds: string[]
  activeTabId: string
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

export interface ThemeCustomization {
  accentColor: string | null
  backgroundColor: string | null
  textColor: string | null
  terminalColors: {
    black?: string
    red?: string
    green?: string
    yellow?: string
    blue?: string
    magenta?: string
    cyan?: string
    white?: string
  } | null
}

export interface Settings {
  defaultProjectDir: string
  theme: string
  themeCustomization?: ThemeCustomization | null
  voiceOutputEnabled?: boolean
  voiceVolume?: number
  voiceSpeed?: number
  voiceSkipOnNew?: boolean
  autoAcceptTools?: string[]
  permissionMode?: string
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
}


interface StoredData {
  workspace: Workspace
  windowBounds?: WindowBounds
  settings?: Settings
}

export class SessionStore {
  private configPath: string
  private backupPath: string
  private data: StoredData

  constructor() {
    const configDir = join(app.getPath('userData'), 'config')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    this.configPath = join(configDir, 'workspace.json')
    this.backupPath = join(configDir, 'workspace.json.backup')
    this.data = this.load()
  }

  private loadFile(path: string): StoredData | null {
    try {
      if (!existsSync(path)) return null
      const stat = statSync(path)
      if (stat.size === 0) return null
      const content = readFileSync(path, 'utf-8')
      const data = JSON.parse(content)
      if (!data?.workspace) return null
      return data
    } catch (e) {
      console.error(`[SessionStore] Failed to load ${path}:`, e)
      return null
    }
  }

  private load(): StoredData {
    // Try main file first
    const main = this.loadFile(this.configPath)
    if (main && (main.workspace.projects?.length || 0) > 0) {
      return main
    }

    // Main file is empty/corrupt/missing — try backup
    const backup = this.loadFile(this.backupPath)
    if (backup && (backup.workspace.projects?.length || 0) > 0) {
      console.log('[SessionStore] Main config empty/corrupt, restored from backup (' +
        backup.workspace.projects.length + ' projects)')
      // Restore backup as main file immediately
      try {
        writeFileSync(this.configPath, JSON.stringify(backup, null, 2))
      } catch (e) {
        console.error('[SessionStore] Failed to restore backup to main:', e)
      }
      return backup
    }

    // If main loaded but had 0 projects (valid empty state), use it
    if (main) return main

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
      const json = JSON.stringify(this.data, null, 2)

      // Validate we can parse what we're about to write
      JSON.parse(json)

      // Back up existing file before overwriting (if it has content)
      if (existsSync(this.configPath)) {
        try {
          const stat = statSync(this.configPath)
          if (stat.size > 0) {
            // Only update backup if existing file is valid and has projects
            const existing = this.loadFile(this.configPath)
            if (existing && (existing.workspace.projects?.length || 0) > 0) {
              writeFileSync(this.backupPath, readFileSync(this.configPath))
            }
          }
        } catch (e) {
          console.error('[SessionStore] Failed to update backup:', e)
        }
      }

      // Atomic write: write to temp file, then rename
      const tmpPath = this.configPath + '.tmp'
      writeFileSync(tmpPath, json)

      // Verify the temp file was written completely
      const written = readFileSync(tmpPath, 'utf-8')
      JSON.parse(written) // throws if truncated/corrupt

      renameSync(tmpPath, this.configPath)
    } catch (e) {
      console.error('[SessionStore] Failed to save workspace:', e)
    }
  }

  getWorkspace(): Workspace {
    return this.data.workspace
  }

  // Reload workspace from disk (useful when file was modified externally)
  reloadFromDisk(): void {
    console.log('[SessionStore] Reloading workspace from disk')
    this.data = this.load()
    console.log('[SessionStore] Reloaded, projects:', this.data.workspace?.projects?.length || 0)
  }

  saveWorkspace(workspace: Workspace): void {
    // Protect against overwriting populated workspace with empty one
    const incomingProjects = workspace?.projects?.length || 0
    const currentProjects = this.data.workspace?.projects?.length || 0
    if (incomingProjects === 0 && currentProjects > 0) {
      console.log('[SessionStore] Rejected empty workspace save - current has', currentProjects, 'projects')
      return
    }
    this.data.workspace = workspace
    this.save()
    syncMetaProjects(workspace)
  }

  getWindowBounds(): WindowBounds | undefined {
    return this.data.windowBounds
  }

  saveWindowBounds(bounds: WindowBounds): void {
    this.data.windowBounds = bounds
    this.save()
  }

  getSettings(): Settings {
    return this.data.settings ?? { defaultProjectDir: '', theme: 'default', backend: 'default' }
  }

  saveSettings(settings: Settings): void {
    this.data.settings = settings
    this.save()
  }
}
