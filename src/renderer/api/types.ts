/**
 * API Abstraction Layer Types
 *
 * This module defines the contract for the API interface that can be implemented
 * by both Electron IPC (desktop) and HTTP/WebSocket (web/mobile) backends.
 */

// ============================================================================
// Connection State Types
// ============================================================================

/**
 * Connection state for HTTP backend
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Type of API backend being used
 */
export type ApiBackendType = 'electron' | 'http'

// ============================================================================
// Data Types
// ============================================================================

/**
 * Application settings
 */
export interface Settings {
  defaultProjectDir: string
  theme: string
  voiceOutputEnabled?: boolean
  voiceVolume?: number
  voiceSpeed?: number
  voiceSkipOnNew?: boolean
  autoAcceptTools?: string[]
  permissionMode?: string
  backend?: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
}

/**
 * Project category for organizing projects in the sidebar
 */
export interface ProjectCategory {
  id: string
  name: string
  collapsed: boolean
  order: number
}

/**
 * Project configuration
 */
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
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode'
  categoryId?: string
  order?: number
}

/**
 * Open tab representing an active terminal session
 */
export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  ptyId: string
  backend?: string
}

/**
 * Tile layout configuration for tiled view mode
 */
export interface TileLayout {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Workspace state containing all projects, tabs, and layout
 */
export interface Workspace {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
  viewMode?: 'tabs' | 'tiled'
  tileLayout?: TileLayout[]
  categories: ProjectCategory[]
}

/**
 * Session discovery result
 */
export interface Session {
  sessionId: string
  slug: string
}

/**
 * Voice settings configuration
 */
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

// ============================================================================
// Event Callback Types
// ============================================================================

/**
 * Callback for PTY data events
 */
export type PtyDataCallback = (data: string) => void

/**
 * Callback for PTY exit events
 */
export type PtyExitCallback = (code: number) => void

/**
 * Callback for PTY recreated events (backend switching)
 */
export type PtyRecreatedCallback = (data: { oldId: string; newId: string; backend: string }) => void

/**
 * Callback for API open session events
 */
export type ApiOpenSessionCallback = (data: { projectPath: string; autoClose: boolean; model?: string }) => void

/**
 * Unsubscribe function returned by event subscriptions
 */
export type Unsubscribe = () => void

// ============================================================================
// API Interface
// ============================================================================

/**
 * Main API interface that abstracts communication between the renderer
 * and the backend (either Electron main process or HTTP server).
 *
 * Both the Electron IPC implementation and HTTP implementation must
 * conform to this interface.
 */
export interface Api {
  // ==========================================================================
  // PTY Management
  // ==========================================================================

  /**
   * Spawn a new PTY instance for a project
   * @param cwd Working directory (project path)
   * @param sessionId Optional session ID to resume
   * @param model Optional model override
   * @param backend Optional backend override ('claude', 'gemini', etc.)
   * @returns Promise resolving to the PTY ID
   */
  spawnPty: (cwd: string, sessionId?: string, model?: string, backend?: string) => Promise<string>

  /**
   * Kill a PTY instance
   * @param id PTY ID to kill
   */
  killPty: (id: string) => void

  /**
   * Write data to a PTY
   * @param id PTY ID
   * @param data Data to write
   */
  writePty: (id: string, data: string) => void

  /**
   * Resize a PTY
   * @param id PTY ID
   * @param cols Number of columns
   * @param rows Number of rows
   */
  resizePty: (id: string, cols: number, rows: number) => void

  /**
   * Subscribe to PTY data events
   * @param id PTY ID
   * @param callback Function called when data is received
   * @returns Unsubscribe function
   */
  onPtyData: (id: string, callback: PtyDataCallback) => Unsubscribe

  /**
   * Subscribe to PTY exit events
   * @param id PTY ID
   * @param callback Function called when PTY exits
   * @returns Unsubscribe function
   */
  onPtyExit: (id: string, callback: PtyExitCallback) => Unsubscribe

  /**
   * Subscribe to PTY recreated events (backend switching)
   * @param callback Function called when a PTY is recreated
   * @returns Unsubscribe function
   */
  onPtyRecreated: (callback: PtyRecreatedCallback) => Unsubscribe

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Discover existing sessions for a project
   * @param projectPath Path to the project
   * @param backend Optional backend type ('claude' or 'opencode')
   * @returns Promise resolving to array of sessions
   */
  discoverSessions: (projectPath: string, backend?: 'claude' | 'opencode') => Promise<Session[]>

  // ==========================================================================
  // Workspace Management
  // ==========================================================================

  /**
   * Get the current workspace state
   * @returns Promise resolving to workspace data
   */
  getWorkspace: () => Promise<Workspace>

  /**
   * Save the workspace state
   * @param workspace Workspace data to save
   */
  saveWorkspace: (workspace: Workspace) => Promise<void>

  // ==========================================================================
  // Settings Management
  // ==========================================================================

  /**
   * Get application settings
   * @returns Promise resolving to settings
   */
  getSettings: () => Promise<Settings>

  /**
   * Save application settings
   * @param settings Settings to save
   */
  saveSettings: (settings: Settings) => Promise<void>

  // ==========================================================================
  // Project Management
  // ==========================================================================

  /**
   * Open a directory picker to add a project
   * @returns Promise resolving to selected path or null
   */
  addProject: () => Promise<string | null>

  /**
   * Open a directory picker to select a parent folder and add all subdirectories as projects
   * @returns Promise resolving to array of projects or null
   */
  addProjectsFromParent: () => Promise<Array<{ path: string; name: string }> | null>

  // ==========================================================================
  // TTS (Text-to-Speech)
  // ==========================================================================

  /**
   * Install TTS instructions (CLAUDE.md markers) for a project
   * @param projectPath Path to the project
   * @returns Promise resolving to success status
   */
  ttsInstallInstructions: (projectPath: string) => Promise<{ success: boolean }>

  /**
   * Speak text using TTS
   * @param text Text to speak
   * @returns Promise resolving to audio data or error
   */
  ttsSpeak: (text: string) => Promise<{ success: boolean; audioData?: string; error?: string }>

  /**
   * Stop current TTS playback
   * @returns Promise resolving to success status
   */
  ttsStop: () => Promise<{ success: boolean }>

  // ==========================================================================
  // Events
  // ==========================================================================

  /**
   * Subscribe to API open session events (triggered by external API calls)
   * @param callback Function called when session should be opened
   * @returns Unsubscribe function
   */
  onApiOpenSession: (callback: ApiOpenSessionCallback) => Unsubscribe
}

// ============================================================================
// Extended API Interface (Desktop-only features)
// ============================================================================

/**
 * Extended API interface with desktop-specific features.
 * These methods are only available in the Electron implementation
 * and may throw or return null/undefined in the HTTP implementation.
 */
export interface ExtendedApi extends Api {
  // Directory and file selection dialogs
  selectDirectory: () => Promise<string | null>
  selectExecutable: () => Promise<string | null>

  // Window controls (Electron-only)
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
  windowIsMaximized: () => Promise<boolean>

  // File utilities
  getPathForFile: (file: File) => string

  // Clipboard operations
  readClipboardImage: () => Promise<{ success: boolean; hasImage?: boolean; path?: string; error?: string }>

  // App utilities
  getVersion: () => Promise<string>
  isDebugMode: () => Promise<boolean>
  refresh: () => Promise<void>
  openExternal: (url: string) => Promise<void>

  // Debug
  debugLog: (message: string) => void
}

// ============================================================================
// API Context Type
// ============================================================================

/**
 * API context providing the current API instance and connection state
 */
export interface ApiContext {
  /** The API implementation (Electron or HTTP) */
  api: Api

  /** The type of backend being used */
  backendType: ApiBackendType

  /** Connection state (only relevant for HTTP backend) */
  connectionState: ConnectionState

  /** Error message if connection failed */
  connectionError?: string

  /** Reconnect function for HTTP backend */
  reconnect?: () => void
}
