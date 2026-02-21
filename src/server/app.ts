/**
 * Mobile API Server - Express Application
 *
 * Main server setup that exposes desktop IPC functionality as HTTP/WebSocket endpoints.
 * Enables mobile app communication with the Claude Terminal desktop application.
 */

import express, { Express, Request, Response, NextFunction } from 'express'
import * as http from 'http'
import cors from 'cors'
import {
  MobileApiServerConfig,
  DEFAULT_SERVER_CONFIG,
  ApiResponse
} from './types'
import {
  authMiddleware,
  generatePrimaryToken,
  getPrimaryToken,
  getConnectionInfo,
  cleanupExpiredTokens
} from './auth'
import { createApiRouter } from './routes'
import { WebSocketHandler } from './ws-handler'

// =============================================================================
// Server State
// =============================================================================

let serverInstance: http.Server | null = null
let wsHandler: WebSocketHandler | null = null
let cleanupInterval: NodeJS.Timeout | null = null

// =============================================================================
// Service Registrations (IPC Handler Adapters)
// =============================================================================

/**
 * Service interfaces that bridge IPC handlers to HTTP endpoints
 * These are set by the main process to provide access to existing functionality
 */
export interface ServerServices {
  // Workspace/Project management
  getWorkspace: () => Promise<any>
  saveWorkspace: (workspace: any) => Promise<void>

  // Settings
  getSettings: () => Promise<any>
  saveSettings: (settings: any) => Promise<void>

  // Sessions
  discoverSessions: (projectPath: string, backend?: string) => Promise<any[]>

  // PTY management
  spawnPty: (cwd: string, sessionId?: string, model?: string, backend?: string) => Promise<string>
  writePty: (id: string, data: string) => void
  resizePty: (id: string, cols: number, rows: number) => void
  killPty: (id: string) => void
  onPtyData: (id: string, callback: (data: string) => void) => () => void
  onPtyExit: (id: string, callback: (code: number) => void) => () => void

  // Beads task management
  beadsCheck: (cwd: string) => Promise<any>
  beadsInit: (cwd: string) => Promise<any>
  beadsList: (cwd: string) => Promise<any>
  beadsShow: (cwd: string, taskId: string) => Promise<any>
  beadsCreate: (cwd: string, title: string, description?: string, priority?: number, type?: string, labels?: string) => Promise<any>
  beadsComplete: (cwd: string, taskId: string) => Promise<any>
  beadsDelete: (cwd: string, taskId: string) => Promise<any>
  beadsStart: (cwd: string, taskId: string) => Promise<any>
  beadsUpdate: (cwd: string, taskId: string, status?: string, title?: string, description?: string, priority?: number) => Promise<any>

  // GSD progress
  gsdProjectCheck: (cwd: string) => Promise<any>
  gsdGetProgress: (cwd: string) => Promise<any>

  // Voice (TTS)
  voiceSpeak: (text: string) => Promise<any>
  voiceStopSpeaking: () => Promise<any>
  voiceGetSettings: () => Promise<any>

  // CLI checks
  claudeCheck: () => Promise<any>
  geminiCheck: () => Promise<any>
  codexCheck: () => Promise<any>
  opencodeCheck: () => Promise<any>
  aiderCheck: () => Promise<any>
}

let services: Partial<ServerServices> = {}

/**
 * Register services that provide IPC handler functionality
 */
export function registerServices(newServices: Partial<ServerServices>): void {
  services = { ...services, ...newServices }
}

/**
 * Get registered services
 */
export function getServices(): Partial<ServerServices> {
  return services
}

// =============================================================================
// Express App Factory
// =============================================================================

/**
 * Create and configure the Express application
 */
export function createApp(config: MobileApiServerConfig = DEFAULT_SERVER_CONFIG): Express {
  const app = express()

  // ==========================================================================
  // Middleware Stack
  // ==========================================================================

  // JSON body parsing with size limit
  app.use(express.json({ limit: '100kb' }))

  // CORS configuration
  if (config.enableCors) {
    app.use(cors({
      origin: config.corsOrigins || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true
    }))
  }

  // Request logging (development)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[Mobile API] ${req.method} ${req.path}`)
    next()
  })

  // ==========================================================================
  // Health Check (unauthenticated)
  // ==========================================================================

  app.get('/health', (_req: Request, res: Response) => {
    const response: ApiResponse<{ status: string; uptime: number }> = {
      success: true,
      data: {
        status: 'healthy',
        uptime: process.uptime()
      },
      timestamp: Date.now()
    }
    res.json(response)
  })

  // ==========================================================================
  // Connection Info (unauthenticated - for initial pairing)
  // ==========================================================================

  app.get('/connect', (_req: Request, res: Response) => {
    const token = getPrimaryToken()
    if (!token) {
      res.status(503).json({
        success: false,
        error: 'Server not fully initialized',
        timestamp: Date.now()
      })
      return
    }

    // Return connection info for QR code
    const info = getConnectionInfo(config.host, config.port)
    res.json({
      success: true,
      data: {
        version: 1,
        wsEndpoint: `/ws`,
        apiEndpoint: `/api`,
        tokenHint: info.token.slice(0, 8) + '...' // Partial token for verification
      },
      timestamp: Date.now()
    })
  })

  // ==========================================================================
  // API Routes (authenticated)
  // ==========================================================================

  // Apply auth middleware to all /api routes
  app.use('/api', authMiddleware as any)

  // Mount the API router
  app.use('/api', createApiRouter())

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint not found',
      timestamp: Date.now()
    })
  })

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Mobile API] Error:', err)
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
      timestamp: Date.now()
    })
  })

  return app
}

// =============================================================================
// Server Lifecycle
// =============================================================================

/**
 * Start the mobile API server
 */
export function startServer(
  config: Partial<MobileApiServerConfig> = {}
): Promise<{ server: http.Server; wsHandler: WebSocketHandler; token: string }> {
  return new Promise((resolve, reject) => {
    const fullConfig: MobileApiServerConfig = { ...DEFAULT_SERVER_CONFIG, ...config }

    // Stop existing server if running
    if (serverInstance) {
      stopServer()
    }

    // Generate primary auth token
    const token = generatePrimaryToken()
    console.log('[Mobile API] Generated auth token:', token.token.slice(0, 8) + '...')

    // Create Express app
    const app = createApp(fullConfig)

    // Create HTTP server
    serverInstance = http.createServer(app)

    // Set up WebSocket handler if enabled
    if (fullConfig.enableWebSocket) {
      wsHandler = new WebSocketHandler(serverInstance, fullConfig.maxConnections)
    }

    // Start periodic cleanup of expired tokens
    cleanupInterval = setInterval(() => {
      const cleaned = cleanupExpiredTokens()
      if (cleaned > 0) {
        console.log(`[Mobile API] Cleaned up ${cleaned} expired tokens`)
      }
    }, 60000) // Every minute

    // Start listening
    serverInstance.listen(fullConfig.port, fullConfig.host, () => {
      console.log(`[Mobile API] Server started on ${fullConfig.host}:${fullConfig.port}`)
      console.log(`[Mobile API] WebSocket endpoint: ws://${fullConfig.host}:${fullConfig.port}/ws`)

      resolve({
        server: serverInstance!,
        wsHandler: wsHandler!,
        token: token.token
      })
    })

    serverInstance.on('error', (error: NodeJS.ErrnoException) => {
      console.error('[Mobile API] Server error:', error)
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${fullConfig.port} is already in use`))
      } else {
        reject(error)
      }
    })
  })
}

/**
 * Stop the mobile API server
 */
export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    // Stop cleanup interval
    if (cleanupInterval) {
      clearInterval(cleanupInterval)
      cleanupInterval = null
    }

    // Close WebSocket handler
    if (wsHandler) {
      wsHandler.closeAll()
      wsHandler = null
    }

    // Close HTTP server
    if (serverInstance) {
      serverInstance.close(() => {
        console.log('[Mobile API] Server stopped')
        serverInstance = null
        resolve()
      })
    } else {
      resolve()
    }
  })
}

/**
 * Check if server is running
 */
export function isServerRunning(): boolean {
  return serverInstance !== null && serverInstance.listening
}

/**
 * Get the WebSocket handler instance
 */
export function getWsHandler(): WebSocketHandler | null {
  return wsHandler
}

/**
 * Get server information
 */
export function getServerInfo(): {
  running: boolean
  port?: number
  host?: string
  token?: string
  connections?: number
} {
  if (!serverInstance || !serverInstance.listening) {
    return { running: false }
  }

  const address = serverInstance.address()
  const token = getPrimaryToken()

  return {
    running: true,
    port: typeof address === 'object' && address ? address.port : undefined,
    host: typeof address === 'object' && address ? address.address : undefined,
    token: token?.token,
    connections: wsHandler?.getConnectionCount() ?? 0
  }
}
