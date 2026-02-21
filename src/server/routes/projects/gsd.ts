/**
 * Project Routes - GSD (Get Shit Done)
 *
 * HTTP endpoints for GSD progress tracking.
 */

import { Router, Request, Response } from 'express'
import { GSDProgress } from '../../types.js'
import { getServices } from '../../app.js'
import { sendResponse, sendError } from './helpers.js'

const router = Router()

/**
 * GET /api/projects/gsd/check
 * Check if GSD is initialized for a project
 *
 * Query: cwd (required) - project path
 */
router.get('/check', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.gsdProjectCheck) {
      return sendError(res, 503, 'GSD service not available')
    }

    const cwd = req.query.cwd as string
    if (!cwd) {
      return sendError(res, 400, 'cwd query parameter is required')
    }

    const result = await services.gsdProjectCheck(cwd)

    sendResponse(res, 200, {
      success: true,
      data: result,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to check GSD')
  }
})

/**
 * GET /api/projects/gsd/progress
 * Get GSD progress for a project
 *
 * Query: cwd (required) - project path
 */
router.get('/progress', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.gsdGetProgress) {
      return sendError(res, 503, 'GSD service not available')
    }

    const cwd = req.query.cwd as string
    if (!cwd) {
      return sendError(res, 400, 'cwd query parameter is required')
    }

    const result = await services.gsdGetProgress(cwd)

    if (!result.success) {
      return sendError(res, 500, result.error || 'Failed to get GSD progress')
    }

    sendResponse<GSDProgress>(res, 200, {
      success: true,
      data: result.data,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to get GSD progress')
  }
})

export default router
