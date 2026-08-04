import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { syncMetaProjects } from './meta-project-sync'
import { getRuntimeDataDir } from './runtime-paths.js'
import type { EnvironmentCommandReceipt, EnvironmentEvent, EnvironmentSnapshot } from '../common/environment-protocol.js'
import type { EventEnvelope } from '../common/server-protocol.js'

export type HarnessId = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok' | 'claude-codex'
export type HarnessSelection = 'default' | HarnessId

const CURRENT_SCHEMA_VERSION = 3

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
  icon?: string               // Custom project emoji icon
  color?: string              // Project color for visual identification
  ttsVoice?: string           // Per-project TTS voice (overrides global)
  ttsEngine?: 'piper' | 'xtts'  // Per-project TTS engine
  harnessId?: HarnessSelection // Per-project harness (overrides global)
  /** @deprecated Read-only compatibility with schema v1. */
  backend?: HarnessSelection
  categoryId?: string         // Category this project belongs to
  order?: number              // Order within category or uncategorized list
}

export interface OpenTab {
  id: string
  projectPath: string
  agentSessionId?: string
  sessionId?: string
  title: string
  ptyId?: string
  harnessId?: HarnessSelection
  /** @deprecated Read-only compatibility with schema v1. */
  backend?: HarnessSelection
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

export interface SavedWorkspaceSession {
  id: string
  name: string
  openTabs: OpenTab[]
  activeTabId: string | null
  tileTree?: any
  canvasScene?: unknown
  activeView?: 'tiles' | 'canvas'
}

export interface Workspace {
  projects: Project[]
  categories?: ProjectCategory[]
  // Multi-session format
  sessions?: SavedWorkspaceSession[]
  activeSessionId?: string | null
  // Legacy single-session fields (for migration)
  openTabs?: OpenTab[]
  activeTabId?: string | null
  viewMode?: 'tabs' | 'tiled'
  tileLayout?: TileLayout[]
  tileTree?: any
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
  voiceSilenceThreshold?: number
  notificationSoundsEnabled?: boolean
  notificationVolume?: number
  autoAcceptTools?: string[]
  permissionMode?: string
  defaultHarnessId?: HarnessSelection
  /** @deprecated Read-only compatibility with schema v1. */
  backend?: HarnessSelection
  globalInstructionInjection?: string
  // Mobile/LAN access. Off by default — the embedded HTTP+WS server (which can
  // drive PTYs) only listens once the user explicitly opts in (H1).
  mobileAccessEnabled?: boolean
  // Headroom context-compression proxy
  headroomEnabled?: boolean
  headroomPort?: number
  headroomProxyPath?: string
}


export interface StoredEnvironmentAuthority {
  snapshot: EnvironmentSnapshot<Workspace>
  events: Array<EventEnvelope<EnvironmentEvent<Workspace>>>
  receipts: EnvironmentCommandReceipt[]
}

interface StoredData {
  schemaVersion: number
  workspace: Workspace
  environment?: StoredEnvironmentAuthority
  windowBounds?: WindowBounds
  settings?: Settings
}

export class SessionStore {
  private configPath: string
  private backupPath: string
  private data: StoredData
  private migratedOnLoad = false

  constructor(dataDir = getRuntimeDataDir()) {
    const configDir = join(dataDir, 'config')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    this.configPath = join(configDir, 'workspace.json')
    this.backupPath = join(configDir, 'workspace.json.backup')
    this.data = this.load()
    if (this.migratedOnLoad) this.save()
  }

  private migrateHarnessFields(data: any): StoredData {
    const migrateRecord = (record: any, target: 'harnessId' | 'defaultHarnessId'): void => {
      if (!record || typeof record !== 'object') return
      if (record[target] === undefined && record.backend !== undefined) record[target] = record.backend
      delete record.backend
    }

    migrateRecord(data.settings, 'defaultHarnessId')
    const migrateWorkspace = (workspace: any): void => {
      if (!workspace) return
      for (const project of workspace.projects ?? []) migrateRecord(project, 'harnessId')
      for (const tab of workspace.openTabs ?? []) migrateRecord(tab, 'harnessId')
      for (const session of workspace.sessions ?? []) {
        for (const tab of session.openTabs ?? []) migrateRecord(tab, 'harnessId')
      }
    }
    migrateWorkspace(data.workspace)
    migrateWorkspace(data.environment?.snapshot?.workspace)
    if (data.environment?.snapshot?.workspace) data.workspace = data.environment.snapshot.workspace
    data.schemaVersion = CURRENT_SCHEMA_VERSION
    return data as StoredData
  }

  private withHarnessCompatibility<T>(value: T): T {
    const copy = JSON.parse(JSON.stringify(value))
    const aliasRecord = (record: any, source: 'harnessId' | 'defaultHarnessId'): void => {
      if (record?.[source] !== undefined) record.backend = record[source]
    }
    if (copy?.projects) {
      for (const project of copy.projects) aliasRecord(project, 'harnessId')
      for (const tab of copy.openTabs ?? []) aliasRecord(tab, 'harnessId')
      for (const session of copy.sessions ?? []) {
        for (const tab of session.openTabs ?? []) aliasRecord(tab, 'harnessId')
      }
    } else {
      aliasRecord(copy, 'defaultHarnessId')
    }
    return copy as T
  }

  private loadFile(path: string): StoredData | null {
    try {
      if (!existsSync(path)) return null
      const stat = statSync(path)
      if (stat.size === 0) return null
      const content = readFileSync(path, 'utf-8')
      const data = JSON.parse(content)
      if (!data?.workspace) return null
      if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) this.migratedOnLoad = true
      return this.migrateHarnessFields(data)
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
      // Restore backup as main file atomically (temp + rename)
      try {
        const tmpPath = this.configPath + '.tmp'
        writeFileSync(tmpPath, JSON.stringify(backup, null, 2))
        renameSync(tmpPath, this.configPath)
      } catch (e) {
        console.error('[SessionStore] Failed to restore backup to main:', e)
      }
      return backup
    }

    // If main loaded but had 0 projects (valid empty state), use it
    if (main) return main

    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      workspace: {
        projects: [],
        openTabs: [],
        activeTabId: null
      }
    }
  }

  private save(throwOnError = false): void {
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
              // Atomic backup: write to temp file, then rename
              const tmpBackup = this.backupPath + '.tmp'
              writeFileSync(tmpBackup, readFileSync(this.configPath))
              renameSync(tmpBackup, this.backupPath)
            }
          }
        } catch (e) {
          console.error('[SessionStore] Failed to update backup:', e)
        }
      }

      // Atomic write: write to temp file, then rename
      const tmpPath = this.configPath + '.tmp'
      writeFileSync(tmpPath, json)

      try {
        // Verify the temp file was written completely
        const written = readFileSync(tmpPath, 'utf-8')
        JSON.parse(written) // throws if truncated/corrupt
        renameSync(tmpPath, this.configPath)
      } catch (verifyErr) {
        // Clean up temp file on verification or rename failure
        try { unlinkSync(tmpPath) } catch { /* ignore cleanup errors */ }
        throw verifyErr
      }
    } catch (e) {
      console.error('[SessionStore] Failed to save workspace:', e)
      if (throwOnError) throw e
    }
  }

  getWorkspace(): Workspace {
    return this.withHarnessCompatibility(this.data.workspace)
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
    this.data = this.migrateHarnessFields({ ...this.data, workspace })
    this.save()
    syncMetaProjects(workspace)
  }

  getEnvironmentAuthority(serverId: string): StoredEnvironmentAuthority | undefined {
    const authority = this.data.environment
    if (!authority || authority.snapshot.serverId !== serverId) return undefined
    return JSON.parse(JSON.stringify(authority))
  }

  saveEnvironmentAuthority(authority: StoredEnvironmentAuthority): void {
    const previous = this.data
    this.data = this.migrateHarnessFields({
      ...this.data,
      workspace: authority.snapshot.workspace,
      environment: authority,
    })
    try {
      this.save(true)
      syncMetaProjects(authority.snapshot.workspace)
    } catch (error) {
      this.data = previous
      throw error
    }
  }

  getWindowBounds(): WindowBounds | undefined {
    return this.data.windowBounds
  }

  saveWindowBounds(bounds: WindowBounds): void {
    this.data.windowBounds = bounds
    this.save()
  }

  getSettings(): Settings {
    return this.withHarnessCompatibility({
      defaultProjectDir: '',
      theme: 'default',
      defaultHarnessId: 'default',
      globalInstructionInjection: '',
      notificationSoundsEnabled: true,
      notificationVolume: 0.65,
      ...this.data.settings,
    })
  }

  saveSettings(settings: Settings): void {
    const normalizedSettings = {
      ...settings,
      notificationSoundsEnabled: settings.notificationSoundsEnabled !== false,
      notificationVolume: Math.max(0, Math.min(1, settings.notificationVolume ?? 0.65)),
    }
    this.data = this.migrateHarnessFields({ ...this.data, settings: normalizedSettings })
    this.save()
  }
}
