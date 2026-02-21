/**
 * Project Routes - Beads
 *
 * HTTP endpoints for Beads task management.
 */

import { Router, Request, Response } from 'express'
import { BeadsTask, BeadsCreateRequest, BeadsUpdateRequest } from '../../types.js'
import { getServices } from '../../app.js'
import { sendResponse, sendError } from './helpers.js'

const router = Router()

/**
 * GET /api/projects/beads/check
 * Check if Beads is installed and initialized for a project
 *
 * Query: cwd (required) - project path
 */
router.get('/check', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.beadsCheck) {
      return sendError(res, 503, 'Beads service not available')
    }

    const cwd = req.query.cwd as string
    if (!cwd) {
      return sendError(res, 400, 'cwd query parameter is required')
    }

    const result = await services.beadsCheck(cwd)

    sendResponse(res, 200, {
      success: true,
      data: result,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to check Beads')
  }
})

/**
 * POST /api/projects/beads/init
 * Initialize Beads for a project
 *
 * Body: { cwd: string }
 */
router.post('/init', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.beadsInit) {
      return sendError(res, 503, 'Beads service not available')
    }

    const { cwd } = req.body
    if (!cwd) {
      return sendError(res, 400, 'cwd is required')
    }

    const result = await services.beadsInit(cwd)

    sendResponse(res, result.success ? 200 : 500, {
      success: result.success,
      error: result.error,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to initialize Beads')
  }
})

/**
 * GET /api/projects/beads/tasks
 * List all Beads tasks for a project
 *
 * Query: cwd (required) - project path
 */
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.beadsList) {
      return sendError(res, 503, 'Beads service not available')
    }

    const cwd = req.query.cwd as string
    if (!cwd) {
      return sendError(res, 400, 'cwd query parameter is required')
    }

    const result = await services.beadsList(cwd)

    if (!result.success) {
      return sendError(res, 500, result.error || 'Failed to list tasks')
    }

    sendResponse<BeadsTask[]>(res, 200, {
      success: true,
      data: result.tasks,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to list Beads tasks')
  }
})

/**
 * GET /api/projects/beads/tasks/:taskId
 * Get a specific Beads task
 *
 * Query: cwd (required) - project path
 */
router.get('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.beadsShow) {
      return sendError(res, 503, 'Beads service not available')
    }

    const { taskId } = req.params
    const cwd = req.query.cwd as string

    if (!cwd) {
      return sendError(res, 400, 'cwd query parameter is required')
    }

    const result = await services.beadsShow(cwd, taskId)

    if (!result.success) {
      return sendError(res, result.error?.includes('not found') ? 404 : 500, result.error || 'Failed to get task')
    }

    sendResponse<BeadsTask>(res, 200, {
      success: true,
      data: result.task,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to get Beads task')
  }
})

/**
 * POST /api/projects/beads/tasks
 * Create a new Beads task
 *
 * Body: { cwd: string, title: string, description?: string, priority?: number, type?: string, labels?: string }
 */
router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.beadsCreate) {
      return sendError(res, 503, 'Beads service not available')
    }

    const { cwd, title, description, priority, type, labels }: BeadsCreateRequest & { cwd: string } = req.body

    if (!cwd) {
      return sendError(res, 400, 'cwd is required')
    }
    if (!title) {
      return sendError(res, 400, 'title is required')
    }

    const result = await services.beadsCreate(cwd, title, description, priority, type, labels)

    if (!result.success) {
      return sendError(res, 500, result.error || 'Failed to create task')
    }

    sendResponse<BeadsTask>(res, 201, {
      success: true,
      data: result.task,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to create Beads task')
  }
})

/**
 * PATCH /api/projects/beads/tasks/:taskId
 * Update a Beads task
 *
 * Body: { cwd: string, status?: string, title?: string, description?: string, priority?: number }
 */
router.patch('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.beadsUpdate) {
      return sendError(res, 503, 'Beads service not available')
    }

    const { taskId } = req.params
    const { cwd, status, title, description, priority }: BeadsUpdateRequest & { cwd: string } = req.body

    if (!cwd) {
      return sendError(res, 400, 'cwd is required')
    }

    const result = await services.beadsUpdate(cwd, taskId, status, title, description, priority)

    sendResponse(res, result.success ? 200 : 500, {
      success: result.success,
      error: result.error,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to update Beads task')
  }
})

/**
 * POST /api/projects/beads/tasks/:taskId/start
 * Start a Beads task (set status to in_progress)
 *
 * Body: { cwd: string }
 */
router.post('/tasks/:taskId/start', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.beadsStart) {
      return sendError(res, 503, 'Beads service not available')
    }

    const { taskId } = req.params
    const { cwd } = req.body

    if (!cwd) {
      return sendError(res, 400, 'cwd is required')
    }

    const result = await services.beadsStart(cwd, taskId)

    sendResponse(res, result.success ? 200 : 500, {
      success: result.success,
      error: result.error,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to start Beads task')
  }
})

/**
 * POST /api/projects/beads/tasks/:taskId/complete
 * Complete a Beads task
 *
 * Body: { cwd: string }
 */
router.post('/tasks/:taskId/complete', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.beadsComplete) {
      return sendError(res, 503, 'Beads service not available')
    }

    const { taskId } = req.params
    const { cwd } = req.body

    if (!cwd) {
      return sendError(res, 400, 'cwd is required')
    }

    const result = await services.beadsComplete(cwd, taskId)

    sendResponse(res, result.success ? 200 : 500, {
      success: result.success,
      data: result.result,
      error: result.error,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to complete Beads task')
  }
})

/**
 * DELETE /api/projects/beads/tasks/:taskId
 * Delete a Beads task
 *
 * Query: cwd (required) - project path
 */
router.delete('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.beadsDelete) {
      return sendError(res, 503, 'Beads service not available')
    }

    const { taskId } = req.params
    const cwd = req.query.cwd as string

    if (!cwd) {
      return sendError(res, 400, 'cwd query parameter is required')
    }

    const result = await services.beadsDelete(cwd, taskId)

    sendResponse(res, result.success ? 200 : 500, {
      success: result.success,
      error: result.error,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to delete Beads task')
  }
})

export default router
