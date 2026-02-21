/**
 * HTTP API Client Types
 *
 * All interfaces and type definitions used by the HTTP API client.
 */

// =============================================================================
// Backend Types
// =============================================================================

export type BackendId = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'

// =============================================================================
// Theme Types
// =============================================================================

export interface TerminalColorsCustomization {
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
}

export interface ThemeCustomization {
  accentColor: string | null
  backgroundColor: string | null
  textColor: string | null
  terminalColors: TerminalColorsCustomization | null
}

// =============================================================================
// Settings Types
// =============================================================================

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
  backend?: 'default' | BackendId
}

export interface VoiceSettings {
  whisperModel?: string
  ttsEngine?: 'piper' | 'xtts' | 'openvoice'
  ttsVoice?: string
  ttsSpeed?: number
  microphoneId?: string | null
  readBehavior?: 'immediate' | 'pause' | 'manual'
  skipOnNew?: boolean
  xttsTemperature?: number
  xttsTopK?: number
  xttsTopP?: number
  xttsRepetitionPenalty?: number
}

// =============================================================================
// Project Types
// =============================================================================

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
  apiPort?: number
  apiAutoStart?: boolean
  apiSessionMode?: 'existing' | 'new-keep' | 'new-close'
  apiModel?: 'default' | 'opus' | 'sonnet' | 'haiku'
  autoAcceptTools?: string[]
  permissionMode?: string
  color?: string
  ttsVoice?: string
  ttsEngine?: 'piper' | 'xtts'
  backend?: 'default' | BackendId
  categoryId?: string
  order?: number
}

// =============================================================================
// Tab/Layout Types
// =============================================================================

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  ptyId: string
  backend?: BackendId
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

// =============================================================================
// Workspace Types
// =============================================================================

export interface Workspace {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
  viewMode?: 'tabs' | 'tiled'
  tileLayout?: TileLayout[]
  categories: ProjectCategory[]
}

export interface Session {
  sessionId: string
  slug: string
}

// =============================================================================
// Beads Types
// =============================================================================

export interface BeadsTask {
  id: string
  title: string
  status: string
  priority?: number
  created?: string
  blockers?: string[]
  description?: string
  issue_type?: string
  created_at?: string
  updated_at?: string
  dependency_count?: number
  dependent_count?: number
}

export interface BeadsCloseResult {
  taskId: string
  status: string
}

// =============================================================================
// GSD Types
// =============================================================================

export interface GSDProgress {
  initialized: boolean
  currentPhase: string | null
  currentPhaseNumber: number | null
  totalPhases: number
  completedPhases: number
  phases: Array<{
    number: number
    title: string
    completed: boolean
  }>
}

// =============================================================================
// API Response Types
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  timestamp: number
}

// =============================================================================
// WebSocket Types
// =============================================================================

export type WsMessageType =
  | 'terminal:data'
  | 'terminal:exit'
  | 'terminal:write'
  | 'terminal:resize'
  | 'ping'
  | 'pong'
  | 'error'
  | 'auth'
  | 'auth:success'
  | 'auth:failure'

export interface WsMessage<T = unknown> {
  type: WsMessageType
  ptyId?: string
  action?: string
  payload?: T
  timestamp: number
}

export type TerminalDataCallback = (ptyId: string, data: string) => void
export type TerminalExitCallback = (ptyId: string, code: number) => void

// =============================================================================
// Unified API Client Interface
// =============================================================================

/**
 * Unified API Client interface
 * This is a subset of the full electronAPI that's available via HTTP
 */
export interface ApiClient {
  // Terminal
  spawnPty(cwd: string, sessionId?: string, model?: string, backend?: BackendId): Promise<string>
  writePty(id: string, data: string): void
  resizePty(id: string, cols: number, rows: number): void
  killPty(id: string): void
  onPtyData(id: string, callback: (data: string) => void): () => void
  onPtyExit(id: string, callback: (code: number) => void): () => void

  // Projects
  getWorkspace(): Promise<Workspace>
  saveWorkspace(workspace: Workspace): Promise<void>

  // Settings
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>

  // Sessions
  discoverSessions(projectPath: string, backend?: BackendId): Promise<Session[]>

  // Backend switching (not available via HTTP)
  setPtyBackend?(id: string, backend: BackendId): Promise<void>

  // Beads
  beadsCheck(cwd: string): Promise<{ installed: boolean; initialized: boolean }>
  beadsList(cwd: string): Promise<{ success: boolean; tasks?: BeadsTask[]; error?: string }>
  beadsCreate(cwd: string, title: string, description?: string, priority?: number, type?: string, labels?: string): Promise<{ success: boolean; task?: BeadsTask; error?: string }>
  beadsComplete(cwd: string, taskId: string): Promise<{ success: boolean; result?: BeadsCloseResult; error?: string }>
  beadsDelete(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }>
  beadsStart(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }>
  beadsUpdate(cwd: string, taskId: string, status?: string, title?: string, description?: string, priority?: number): Promise<{ success: boolean; error?: string }>

  // GSD
  gsdProjectCheck(cwd: string): Promise<{ initialized: boolean }>
  gsdGetProgress(cwd: string): Promise<{ success: boolean; data?: GSDProgress; error?: string }>

  // CLI Status
  claudeCheck(): Promise<{ installed: boolean; npmInstalled: boolean; gitBashInstalled: boolean }>
  geminiCheck(): Promise<{ installed: boolean; npmInstalled: boolean }>
  codexCheck(): Promise<{ installed: boolean; npmInstalled: boolean }>
  opencodeCheck(): Promise<{ installed: boolean; npmInstalled: boolean }>
  aiderCheck(): Promise<{ installed: boolean; pipInstalled: boolean }>

  // Voice
  voiceSpeak(text: string): Promise<{ success: boolean; audioData?: string; error?: string }>
  voiceStopSpeaking(): Promise<{ success: boolean }>

  // Connection (HTTP only)
  connect?(): Promise<void>
  disconnect?(): void
  isConnected?(): boolean
}
