/**
 * Terminal Routes
 *
 * HTTP endpoints for terminal/PTY management.
 * WebSocket is used for real-time data streaming (see ws-handler.ts).
 */

import { Router, Request, Response } from 'express'
import {
  ApiResponse,
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalSession,
  Backend
} from '../types'
import { getServices } from '../app'

const router = Router()

// =============================================================================
// In-Memory Terminal Session Tracking
// =============================================================================

// Track active terminal sessions created via this API
const activeSessions: Map<string, TerminalSession> = new Map()

// =============================================================================
// Helper Functions
// =============================================================================

function sendResponse<T>(res: Response, statusCode: number, data: ApiResponse<T>): void {
  res.status(statusCode).json(data)
}

function sendError(res: Response, statusCode: number, error: string): void {
  sendResponse(res, statusCode, {
    success: false,
    error,
    timestamp: Date.now()
  })
}

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /api/terminal/create
 * Create a new terminal session
 *
 * Body: { projectPath: string, sessionId?: string, model?: string, backend?: Backend }
 * Returns: { ptyId: string, projectPath: string, backend?: string }
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.spawnPty) {
      return sendError(res, 503, 'Terminal service not available')
    }

    const body: TerminalCreateRequest = req.body

    if (!body.projectPath) {
      return sendError(res, 400, 'projectPath is required')
    }

    // Validate backend if provided
    const validBackends: Backend[] = ['claude', 'gemini', 'codex', 'opencode', 'aider']
    if (body.backend && !validBackends.includes(body.backend)) {
      return sendError(res, 400, `Invalid backend. Must be one of: ${validBackends.join(', ')}`)
    }

    // Spawn PTY process
    const ptyId = await services.spawnPty(
      body.projectPath,
      body.sessionId,
      body.model,
      body.backend
    )

    // Track the session
    const session: TerminalSession = {
      ptyId,
      projectPath: body.projectPath,
      sessionId: body.sessionId,
      backend: body.backend,
      createdAt: Date.now()
    }
    activeSessions.set(ptyId, session)

    const response: ApiResponse<TerminalCreateResponse> = {
      success: true,
      data: {
        ptyId,
        projectPath: body.projectPath,
        backend: body.backend
      },
      timestamp: Date.now()
    }

    sendResponse(res, 201, response)
  } catch (error: any) {
    console.error('[Terminal Route] Create error:', error)
    sendError(res, 500, error.message || 'Failed to create terminal')
  }
})

/**
 * GET /api/terminal/sessions
 * List all active terminal sessions
 *
 * Returns: TerminalSession[]
 */
router.get('/sessions', (_req: Request, res: Response) => {
  try {
    const sessions = Array.from(activeSessions.values())

    sendResponse(res, 200, {
      success: true,
      data: sessions,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to list sessions')
  }
})

/**
 * GET /api/terminal/:ptyId
 * Get information about a specific terminal session
 *
 * Returns: TerminalSession
 */
router.get('/:ptyId', (req: Request, res: Response) => {
  try {
    const { ptyId } = req.params
    const session = activeSessions.get(ptyId)

    if (!session) {
      return sendError(res, 404, 'Terminal session not found')
    }

    sendResponse(res, 200, {
      success: true,
      data: session,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to get session')
  }
})

/**
 * POST /api/terminal/:ptyId/write
 * Write data to a terminal (for REST-based input, prefer WebSocket)
 *
 * Body: { data: string }
 */
router.post('/:ptyId/write', (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.writePty) {
      return sendError(res, 503, 'Terminal service not available')
    }

    const { ptyId } = req.params
    const { data } = req.body

    if (!activeSessions.has(ptyId)) {
      return sendError(res, 404, 'Terminal session not found')
    }

    if (typeof data !== 'string') {
      return sendError(res, 400, 'data must be a string')
    }

    services.writePty(ptyId, data)

    sendResponse(res, 200, {
      success: true,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to write to terminal')
  }
})

/**
 * POST /api/terminal/:ptyId/resize
 * Resize a terminal
 *
 * Body: { cols: number, rows: number }
 */
router.post('/:ptyId/resize', (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.resizePty) {
      return sendError(res, 503, 'Terminal service not available')
    }

    const { ptyId } = req.params
    const { cols, rows } = req.body

    if (!activeSessions.has(ptyId)) {
      return sendError(res, 404, 'Terminal session not found')
    }

    if (typeof cols !== 'number' || typeof rows !== 'number') {
      return sendError(res, 400, 'cols and rows must be numbers')
    }

    if (cols < 1 || cols > 500 || rows < 1 || rows > 500) {
      return sendError(res, 400, 'cols and rows must be between 1 and 500')
    }

    services.resizePty(ptyId, cols, rows)

    sendResponse(res, 200, {
      success: true,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to resize terminal')
  }
})

/**
 * DELETE /api/terminal/:ptyId
 * Kill a terminal session
 */
router.delete('/:ptyId', (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.killPty) {
      return sendError(res, 503, 'Terminal service not available')
    }

    const { ptyId } = req.params

    if (!activeSessions.has(ptyId)) {
      return sendError(res, 404, 'Terminal session not found')
    }

    services.killPty(ptyId)
    activeSessions.delete(ptyId)

    sendResponse(res, 200, {
      success: true,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to kill terminal')
  }
})

/**
 * GET /api/terminal/discover/:projectPath
 * Discover existing sessions for a project
 *
 * Query: backend (optional)
 */
router.get('/discover/:projectPath(*)', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.discoverSessions) {
      return sendError(res, 503, 'Session discovery not available')
    }

    const { projectPath } = req.params
    const backend = req.query.backend as string | undefined

    const sessions = await services.discoverSessions(projectPath, backend)

    sendResponse(res, 200, {
      success: true,
      data: sessions,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to discover sessions')
  }
})

// =============================================================================
// Session Cleanup Helper
// =============================================================================

/**
 * Remove a session from tracking (called when PTY exits)
 */
export function removeSession(ptyId: string): void {
  activeSessions.delete(ptyId)
}

/**
 * Get active session count
 */
export function getActiveSessionCount(): number {
  return activeSessions.size
}

export default router
