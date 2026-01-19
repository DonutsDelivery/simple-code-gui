/**
 * Route Aggregator
 *
 * Combines all API routes into a single router for mounting in the Express app.
 */

import { Router } from 'express'
import terminalRoutes from './terminal'
import projectRoutes from './projects'
import settingsRoutes from './settings'

/**
 * Create the main API router that aggregates all sub-routes
 */
export function createApiRouter(): Router {
  const router = Router()

  // ==========================================================================
  // Route Mounting
  // ==========================================================================

  /**
   * Terminal Routes
   *
   * POST   /api/terminal/create              - Create new terminal session
   * GET    /api/terminal/sessions            - List active sessions
   * GET    /api/terminal/:ptyId              - Get session info
   * POST   /api/terminal/:ptyId/write        - Write to terminal
   * POST   /api/terminal/:ptyId/resize       - Resize terminal
   * DELETE /api/terminal/:ptyId              - Kill terminal
   * GET    /api/terminal/discover/:path      - Discover sessions for project
   */
  router.use('/terminal', terminalRoutes)

  /**
   * Project Routes
   *
   * GET    /api/projects                     - Get full workspace
   * PUT    /api/projects                     - Save workspace
   * GET    /api/projects/list                - Get project list only
   *
   * Beads Task Management:
   * GET    /api/projects/beads/check         - Check Beads status
   * POST   /api/projects/beads/init          - Initialize Beads
   * GET    /api/projects/beads/tasks         - List tasks
   * GET    /api/projects/beads/tasks/:id     - Get task
   * POST   /api/projects/beads/tasks         - Create task
   * PATCH  /api/projects/beads/tasks/:id     - Update task
   * POST   /api/projects/beads/tasks/:id/start    - Start task
   * POST   /api/projects/beads/tasks/:id/complete - Complete task
   * DELETE /api/projects/beads/tasks/:id     - Delete task
   *
   * GSD Progress:
   * GET    /api/projects/gsd/check           - Check GSD initialization
   * GET    /api/projects/gsd/progress        - Get project progress
   */
  router.use('/projects', projectRoutes)

  /**
   * Settings Routes
   *
   * GET    /api/settings                     - Get app settings
   * PUT    /api/settings                     - Save app settings
   * PATCH  /api/settings                     - Partial update settings
   * GET    /api/settings/voice               - Get voice settings
   * POST   /api/settings/voice/speak         - Speak text (TTS)
   * POST   /api/settings/voice/stop          - Stop TTS
   * GET    /api/settings/cli/status          - Get all CLI statuses
   * GET    /api/settings/cli/:tool           - Get specific CLI status
   */
  router.use('/settings', settingsRoutes)

  // ==========================================================================
  // API Documentation Endpoint
  // ==========================================================================

  router.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        name: 'Claude Terminal Mobile API',
        version: '1.0.0',
        endpoints: {
          terminal: {
            'POST /terminal/create': 'Create new terminal session',
            'GET /terminal/sessions': 'List active sessions',
            'GET /terminal/:ptyId': 'Get session info',
            'POST /terminal/:ptyId/write': 'Write to terminal',
            'POST /terminal/:ptyId/resize': 'Resize terminal (cols, rows)',
            'DELETE /terminal/:ptyId': 'Kill terminal session',
            'GET /terminal/discover/:path': 'Discover existing sessions'
          },
          projects: {
            'GET /projects': 'Get full workspace',
            'PUT /projects': 'Save workspace',
            'GET /projects/list': 'Get project list',
            'GET /projects/beads/check?cwd=': 'Check Beads status',
            'POST /projects/beads/init': 'Initialize Beads',
            'GET /projects/beads/tasks?cwd=': 'List Beads tasks',
            'GET /projects/beads/tasks/:id?cwd=': 'Get Beads task',
            'POST /projects/beads/tasks': 'Create Beads task',
            'PATCH /projects/beads/tasks/:id': 'Update Beads task',
            'DELETE /projects/beads/tasks/:id?cwd=': 'Delete Beads task',
            'GET /projects/gsd/check?cwd=': 'Check GSD initialization',
            'GET /projects/gsd/progress?cwd=': 'Get GSD progress'
          },
          settings: {
            'GET /settings': 'Get application settings',
            'PUT /settings': 'Save application settings',
            'PATCH /settings': 'Partial update settings',
            'GET /settings/voice': 'Get voice settings',
            'POST /settings/voice/speak': 'Speak text with TTS',
            'POST /settings/voice/stop': 'Stop TTS playback',
            'GET /settings/cli/status': 'Get all CLI statuses',
            'GET /settings/cli/:tool': 'Get specific CLI status'
          },
          websocket: {
            'WS /ws': 'Real-time terminal streaming',
            'auth message': '{ type: "auth", payload: { token: "..." } }',
            'subscribe': '{ action: "subscribe", ptyId: "..." }',
            'terminal:write': '{ type: "terminal:write", ptyId: "...", payload: { data: "..." } }',
            'terminal:resize': '{ type: "terminal:resize", ptyId: "...", payload: { cols: N, rows: N } }'
          }
        },
        authentication: 'Bearer token in Authorization header, or ?token= query param'
      },
      timestamp: Date.now()
    })
  })

  return router
}

// Re-export route modules for direct access if needed
export { default as terminalRoutes } from './terminal'
export { default as projectRoutes } from './projects'
export { default as settingsRoutes } from './settings'
