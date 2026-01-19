/**
 * Mobile API Server Types
 *
 * Shared types for the HTTP/WebSocket API that exposes desktop functionality to mobile clients.
 * These mirror the IPC types from the Electron app but are designed for REST/WebSocket transport.
 */

// =============================================================================
// Authentication
// =============================================================================

export interface AuthToken {
  token: string
  createdAt: number
  expiresAt: number | null // null = never expires
}

export interface AuthenticatedRequest {
  token: string
  userId?: string
}

// =============================================================================
// API Response Wrappers
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  timestamp: number
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number
  offset: number
  limit: number
}

// =============================================================================
// Terminal/PTY Types
// =============================================================================

export type Backend = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'

export interface TerminalCreateRequest {
  projectPath: string
  sessionId?: string
  model?: string
  backend?: Backend
}

export interface TerminalCreateResponse {
  ptyId: string
  projectPath: string
  backend?: Backend
}

export interface TerminalWriteRequest {
  data: string
}

export interface TerminalResizeRequest {
  cols: number
  rows: number
}

export interface TerminalSession {
  ptyId: string
  projectPath: string
  sessionId?: string
  backend?: Backend
  createdAt: number
}

// =============================================================================
// WebSocket Message Types
// =============================================================================

export type WsMessageType =
  | 'terminal:data'      // Terminal output data
  | 'terminal:exit'      // Terminal process exited
  | 'terminal:write'     // Write to terminal (client -> server)
  | 'terminal:resize'    // Resize terminal (client -> server)
  | 'ping'               // Keepalive ping
  | 'pong'               // Keepalive pong
  | 'error'              // Error message
  | 'auth'               // Authentication message
  | 'auth:success'       // Auth successful
  | 'auth:failure'       // Auth failed

export interface WsMessage<T = unknown> {
  type: WsMessageType
  ptyId?: string
  payload?: T
  timestamp: number
}

export interface WsTerminalDataPayload {
  data: string
}

export interface WsTerminalExitPayload {
  code: number
}

export interface WsAuthPayload {
  token: string
}

// =============================================================================
// Project Types (mirrors preload types)
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
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode'
  categoryId?: string
  order?: number
}

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  ptyId: string
  backend?: string
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
  categories: ProjectCategory[]
}

// =============================================================================
// Settings Types
// =============================================================================

export interface Settings {
  defaultProjectDir: string
  theme: string
  voiceOutputEnabled?: boolean
  voiceVolume?: number
  voiceSpeed?: number
  voiceSkipOnNew?: boolean
  autoAcceptTools?: string[]
  permissionMode?: string
  backend?: Backend
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
// Session Types
// =============================================================================

export interface Session {
  sessionId: string
  slug: string
}

// =============================================================================
// Beads Task Types
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

export interface BeadsCreateRequest {
  title: string
  description?: string
  priority?: number
  type?: string
  labels?: string
}

export interface BeadsUpdateRequest {
  status?: string
  title?: string
  description?: string
  priority?: number
}

// =============================================================================
// GSD (Get Shit Done) Types
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
// Server Configuration
// =============================================================================

export interface MobileApiServerConfig {
  port: number
  host: string
  enableCors: boolean
  corsOrigins?: string[]
  tokenExpiry?: number // milliseconds, null = never
  enableWebSocket: boolean
  maxConnections?: number
}

export const DEFAULT_SERVER_CONFIG: MobileApiServerConfig = {
  port: 38470,
  host: '0.0.0.0', // Listen on all interfaces for LAN access
  enableCors: true,
  corsOrigins: ['*'], // Allow all origins (token auth provides security)
  tokenExpiry: null, // Never expire
  enableWebSocket: true,
  maxConnections: 10
}
