/**
 * Project Routes - Workspace
 *
 * HTTP endpoints for workspace and project list management.
 */

import { Router, Request, Response } from 'express'
import { Workspace } from '../../types.js'
import { getServices } from '../../app.js'
import { sendResponse, sendError } from './helpers.js'

const router = Router()

/**
 * GET /api/projects
 * Get the full workspace including all projects
 *
 * Returns: Workspace
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.getWorkspace) {
      return sendError(res, 503, 'Workspace service not available')
    }

    const workspace: Workspace = await services.getWorkspace()

    sendResponse(res, 200, {
      success: true,
      data: workspace,
      timestamp: Date.now()
    })
  } catch (error: any) {
    console.error('[Projects Route] Get workspace error:', error)
    sendError(res, 500, error.message || 'Failed to get workspace')
  }
})

/**
 * PUT /api/projects
 * Save the full workspace
 *
 * Body: Workspace
 */
router.put('/', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.saveWorkspace) {
      return sendError(res, 503, 'Workspace service not available')
    }

    const workspace: Workspace = req.body

    if (!workspace || !Array.isArray(workspace.projects)) {
      return sendError(res, 400, 'Invalid workspace data')
    }

    await services.saveWorkspace(workspace)

    sendResponse(res, 200, {
      success: true,
      timestamp: Date.now()
    })
  } catch (error: any) {
    console.error('[Projects Route] Save workspace error:', error)
    sendError(res, 500, error.message || 'Failed to save workspace')
  }
})

/**
 * GET /api/projects/list
 * Get just the list of projects (convenience endpoint)
 *
 * Returns: Project[]
 */
router.get('/list', async (_req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.getWorkspace) {
      return sendError(res, 503, 'Workspace service not available')
    }

    const workspace: Workspace = await services.getWorkspace()

    sendResponse(res, 200, {
      success: true,
      data: workspace.projects,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to get projects')
  }
})

export default router
