/**
 * API Abstraction Layer Types
 *
 * This module defines the contract for the API interface that can be implemented
 * by both Electron IPC (desktop) and HTTP/WebSocket (web/mobile) backends.
 */

import type { CanvasAssetBytes, CanvasAssetMetadata, CanvasAssetResult } from '../../common/canvas-assets.js'
import type { AgentSessionSignalEvent } from '../../common/agent-session-signal.js'
import type { ServerProtocolDescriptor } from '../../common/server-protocol.js'
import type { CommandEnvelope, EventEnvelope } from '../../common/server-protocol.js'
import type { EnvironmentCommandResult, EnvironmentEvent, EnvironmentEventsResult, EnvironmentSnapshot } from '../../common/environment-protocol.js'
import type { EnvironmentCommand } from '../../main/environment-command-router.js'
import type { ArtifactManifest } from '../../common/artifacts.js'
import type { CoordinationReceipt, CoordinationSnapshot } from '../../common/coordination-protocol.js'
export type {
  AgentSessionSignalEvent,
  AgentSessionSignalMessage,
  AgentSessionSignalType
} from '../../common/agent-session-signal.js'

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

export type HarnessId = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok' | 'claude-codex'
export type HarnessSelection = 'default' | HarnessId

/** @deprecated Use HarnessId. */
export type BackendId = HarnessId
/** @deprecated Use HarnessSelection. */
export type BackendSelection = HarnessSelection

// ============================================================================
// Data Types
// ============================================================================

/**
 * Terminal ANSI colors customization
 */
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

/**
 * Theme customization settings
 */
export interface ThemeCustomization {
  accentColor: string | null
  backgroundColor: string | null
  textColor: string | null
  terminalColors: TerminalColorsCustomization | null
}

/**
 * Application settings
 */
export interface Settings {
  defaultProjectDir: string
  theme: string
  themeCustomization?: ThemeCustomization | null
  voiceOutputEnabled?: boolean
  voiceVolume?: number
  voiceSpeed?: number
  voiceSkipOnNew?: boolean
  voiceSilenceThreshold?: number
  voicePushToTalk?: boolean
  notificationSoundsEnabled?: boolean
  notificationVolume?: number
  autoAcceptTools?: string[]
  permissionMode?: string
  defaultHarnessId?: HarnessSelection
  /** @deprecated Schema v1 compatibility only. */
  backend?: HarnessSelection
  globalInstructionInjection?: string
  // Headroom context-compression proxy
  headroomEnabled?: boolean
  headroomPort?: number
  headroomProxyPath?: string
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
  icon?: string
  color?: string
  ttsVoice?: string
  ttsEngine?: 'piper' | 'xtts'
  harnessId?: HarnessSelection
  /** @deprecated Schema v1 compatibility only. */
  backend?: HarnessSelection
  categoryId?: string
  order?: number
}

/**
 * Open tab representing an active terminal session
 */
export interface OpenTab {
  /** Renderer federation owner; omitted from legacy single-server snapshots. */
  serverId?: string
  id: string
  projectPath: string
  agentSessionId?: string
  sessionId?: string
  title: string
  ptyId: string
  harnessId?: HarnessSelection
  /** @deprecated Schema v1 compatibility only. */
  backend?: HarnessSelection
}

export interface PtySession {
  id: string
  cwd: string
  harnessId: HarnessId
  /** @deprecated Protocol v1 compatibility only. */
  backend?: HarnessId
  sessionId?: string
  spawnedAt: number
}

/**
 * Tile layout configuration for tiled view mode
 */
export interface TileLayout {
  id: string
  tabIds: string[]
  activeTabId: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * A saved workspace session (isolated tiled environment with its own PTYs)
 */
export interface SavedWorkspaceSession {
  id: string
  name: string
  openTabs: OpenTab[]
  activeTabId: string | null
  tileTree?: any
  canvasScene?: unknown
  activeView?: 'tiles' | 'canvas'
}

/**
 * Workspace state containing all projects, sessions, and layout
 */
export interface Workspace {
  projects: Project[]
  categories: ProjectCategory[]
  // Multi-session format
  sessions?: SavedWorkspaceSession[]
  activeSessionId?: string | null
  // Legacy single-session fields (kept for migration)
  openTabs?: OpenTab[]
  activeTabId?: string | null
  viewMode?: 'tabs' | 'tiled'
  tileLayout?: TileLayout[]
  tileTree?: any
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
}

// ============================================================================
// API Interface
// ============================================================================

export type Unsubscribe = () => void

export type PtyDataCallback = (data: string) => void
export type PtyExitCallback = (code: number) => void
export type PtyRecreatedCallback = (data: { oldId: string; newId: string; harnessId: HarnessId; sessionId?: string; backend?: HarnessId }) => void
export type AgentSessionSignalCallback = (event: AgentSessionSignalEvent) => void


export interface ApiOpenSessionEvent {
  projectPath: string
  autoClose?: boolean
  model?: string
}

export type ApiOpenSessionCallback = (event: ApiOpenSessionEvent) => void

export interface OrchestratorSessionCreatedEvent {
  ptyId: string
  projectPath: string
  harnessId: HarnessId
  /** @deprecated Protocol v1 compatibility only. */
  backend?: string
  workspaceId?: string
  tileId?: string
  placement?: 'new-tile' | 'sub-tab' | 'split-left' | 'split-right' | 'split-top' | 'split-bottom'
}
export type OrchestratorSessionCreatedCallback = (event: OrchestratorSessionCreatedEvent) => void

/**
 * Core API interface for the renderer
 */
export interface Api {
  /** Protocol/capability descriptor for the connected server, when applicable. */
  getServerProtocol?: () => ServerProtocolDescriptor | null

  // Optional: Desktop-only voice catalog and XTTS management
  voiceGetInstalled?: () => Promise<Array<{ key: string; displayName: string; source: 'builtin' | 'downloaded' | 'custom'; quality?: string; language?: string }>>
  xttsGetVoices?: () => Promise<Array<{ id: string; name: string; language: string; createdAt: number }>>
  voiceGetSettings?: () => Promise<{ ttsVoice?: string; ttsEngine?: string; ttsSpeed?: number; xttsTemperature?: number; xttsTopK?: number; xttsTopP?: number; xttsRepetitionPenalty?: number }>
  voiceCheckWhisper?: () => Promise<{ installed: boolean; models: string[]; currentModel: string | null }>
  voiceCheckTTS?: () => Promise<{ installed: boolean; engine: string | null; voices: string[]; currentVoice: string | null }>
  voiceInstallWhisper?: (model: string) => Promise<{ success: boolean; error?: string }>
  voiceApplySettings?: (settings: { ttsVoice?: string; ttsEngine?: string; ttsSpeed?: number; xttsTemperature?: number; xttsTopK?: number; xttsTopP?: number; xttsRepetitionPenalty?: number }) => Promise<{ success: boolean }>
  voiceSetVoice?: (voice: string | { voice: string; engine: 'piper' | 'xtts' }) => Promise<{ success: boolean }>
  ttsRemoveInstructions?: (projectPath: string, aiBackend?: string) => Promise<{ success: boolean }>
  extensionsGetInstalled?: () => Promise<Array<{ id: string; name: string; type: string }>>

  // Optional: API server control (desktop only)
  apiStart?: (projectPath: string, port: number) => Promise<{ success: boolean; error?: string }>
  apiStop?: (projectPath: string) => Promise<{ success: boolean }>

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
  getEnvironmentSnapshot?: () => Promise<EnvironmentSnapshot<Workspace>>
  getEnvironmentEvents?: (afterRevision: number) => Promise<EnvironmentEventsResult<Workspace>>
  executeEnvironmentCommand?: (command: CommandEnvelope<EnvironmentCommand>) => Promise<EnvironmentCommandResult>
  onEnvironmentEvent?: (callback: (event: EventEnvelope<EnvironmentEvent<Workspace>>) => void) => Unsubscribe

  // Desktop-only managed Canvas assets. HTTP/mobile backends leave these absent.
  pickCanvasAsset?: () => Promise<CanvasAssetResult<CanvasAssetMetadata | null>>
  importCanvasAssetBytes?: (bytes: Uint8Array) => Promise<CanvasAssetResult<CanvasAssetMetadata>>
  importCanvasClipboardAsset?: () => Promise<CanvasAssetResult<CanvasAssetMetadata | null>>
  readCanvasAsset?: (id: string) => Promise<CanvasAssetResult<CanvasAssetBytes>>
  copyCanvasAssetPath?: (id: string) => Promise<CanvasAssetResult<true>>

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
  // Session Discovery
  // ==========================================================================

  /**
   * Discover recent sessions for a project
   * @param projectPath Path to the project
   * @param backend Optional backend type ('claude', 'gemini', 'codex', 'opencode', or 'aider')
   */
  discoverSessions: (projectPath: string, backend?: BackendId) => Promise<Session[]>

  // ==========================================================================
  // Artifacts (content-addressed store)
  // ==========================================================================

  /** List artifacts on the connected server (optional: absent on non-server backends). */
  listArtifacts?: (filter?: { producerServerId?: string; kind?: string }) => Promise<ArtifactManifest[]>
  /** Download an artifact's bytes; resolves to a local file path when the backend materializes it. */
  downloadArtifact?: (artifactId: string) => Promise<{ filePath: string; sha256: string } | null>
  /** Expire/delete an artifact. */
  expireArtifact?: (artifactId: string) => Promise<{ removed: boolean }>
  getCoordinationSnapshot?: () => Promise<CoordinationSnapshot>
  sendCoordinationMessage?: (message: Record<string, unknown>) => Promise<CoordinationReceipt>

  // ==========================================================================
  // PTY Management
  // ==========================================================================

  /**
   * List live PTY processes
   */
  listPtys: () => Promise<PtySession[]>

  /**
   * Spawn a new PTY session
   * @param cwd Working directory
   * @param sessionId Optional session ID to resume
   * @param model Optional model override
   * @param backend Optional backend override ('claude', 'gemini', etc.)
   */
  spawnPty: (cwd: string, sessionId?: string, model?: string, backend?: BackendId, agentSessionId?: string) => Promise<string>

  /**
   * Write data to a PTY
   */
  writePty: (id: string, data: string) => void

  /**
   * Resize a PTY
   */
  resizePty: (id: string, cols: number, rows: number) => void

  /**
   * Kill a PTY
   */
  killPty: (id: string) => void

  /**
   * Subscribe to PTY output
   */
  onPtyData: (id: string, callback: (data: string) => void) => Unsubscribe

  /**
   * Subscribe to PTY exit
   */
  onPtyExit: (id: string, callback: (code: number) => void) => Unsubscribe

  /**
   * Switch a PTY backend (desktop only)
   */
  setPtyBackend?: (id: string, backend: BackendId) => Promise<void>

  /**
   * Subscribe to PTY recreated events (backend switching)
   */
  onPtyRecreated: (callback: PtyRecreatedCallback) => Unsubscribe

  /**
   * Subscribe to explicit agent completion and input-needed signals.
   */
  onAgentSessionSignal: (callback: AgentSessionSignalCallback) => Unsubscribe

  // ==========================================================================
  // TTS (Text-to-Speech)
  // ==========================================================================

  /**
   * Install TTS instructions in the backend's instruction file
   * @param projectPath Path to the project
   * @param aiBackend Optional backend override (claude, gemini, codex, etc.)
   * @returns Promise resolving to success status
   */
  ttsInstallInstructions: (projectPath: string, aiBackend?: string) => Promise<{ success: boolean }>

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

  /**
   * Subscribe to orchestrator session created events (triggered by MCP create_session tool)
   * @param callback Function called when a session is created by the orchestrator
   * @returns Unsubscribe function
   */
  onOrchestratorSessionCreated: (callback: OrchestratorSessionCreatedCallback) => Unsubscribe

  /**
   * Get connection info for external components (HTTP backend only)
   * @returns Connection info or undefined if not applicable
   */
  getConnectionInfo?: () => { host: string; port: number; token: string }
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
