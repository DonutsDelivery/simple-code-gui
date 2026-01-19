/**
 * Mobile API Server Module
 *
 * Main export file for the server module that enables mobile app
 * communication with the Claude Terminal desktop application.
 *
 * Usage:
 * ```typescript
 * import {
 *   startServer,
 *   stopServer,
 *   registerServices,
 *   getServerInfo
 * } from './server'
 *
 * // Register IPC handler adapters
 * registerServices({
 *   getWorkspace: () => workspaceManager.getWorkspace(),
 *   saveWorkspace: (ws) => workspaceManager.saveWorkspace(ws),
 *   spawnPty: (cwd, sessionId, model, backend) => ptyManager.spawn(cwd, sessionId, model, backend),
 *   // ... etc
 * })
 *
 * // Start server
 * const { server, wsHandler, token } = await startServer({ port: 38470 })
 * console.log('Auth token:', token)
 *
 * // Stop server
 * await stopServer()
 * ```
 */

// =============================================================================
// Server Exports
// =============================================================================

export {
  // Server lifecycle
  startServer,
  stopServer,
  isServerRunning,
  getServerInfo,

  // Service registration
  registerServices,
  getServices,

  // App factory (for advanced usage)
  createApp,

  // WebSocket handler access
  getWsHandler,

  // Types
  type ServerServices
} from './app'

// =============================================================================
// Authentication Exports
// =============================================================================

export {
  // Token management
  generatePrimaryToken,
  getPrimaryToken,
  regeneratePrimaryToken,
  createToken,
  validateToken,
  revokeToken,
  revokeAllTokens,
  cleanupExpiredTokens,

  // Middleware
  authMiddleware,
  optionalAuthMiddleware,

  // Utilities
  getConnectionInfo,
  maskToken
} from './auth'

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Auth types
  AuthToken,
  AuthenticatedRequest,

  // API types
  ApiResponse,
  PaginatedResponse,

  // Terminal types
  Backend,
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalSession,
  TerminalWriteRequest,
  TerminalResizeRequest,

  // WebSocket types
  WsMessageType,
  WsMessage,
  WsTerminalDataPayload,
  WsTerminalExitPayload,
  WsAuthPayload,

  // Project types
  Project,
  ProjectCategory,
  OpenTab,
  TileLayout,
  Workspace,

  // Settings types
  Settings,
  VoiceSettings,

  // Session types
  Session,

  // Beads types
  BeadsTask,
  BeadsCreateRequest,
  BeadsUpdateRequest,

  // GSD types
  GSDProgress,

  // Server config
  MobileApiServerConfig
} from './types'

export { DEFAULT_SERVER_CONFIG } from './types'

// =============================================================================
// WebSocket Handler Export
// =============================================================================

export { WebSocketHandler } from './ws-handler'

// =============================================================================
// Route Exports (for testing/advanced usage)
// =============================================================================

export {
  createApiRouter,
  terminalRoutes,
  projectRoutes,
  settingsRoutes
} from './routes'

export {
  removeSession,
  getActiveSessionCount
} from './routes/terminal'
