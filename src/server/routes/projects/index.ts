/**
 * Project Routes
 *
 * HTTP endpoints for project and workspace management.
 * Also includes Beads task management and GSD progress endpoints.
 */

import { Router } from 'express'
import workspaceRouter from './workspace.js'
import beadsRouter from './beads.js'
import gsdRouter from './gsd.js'

const router = Router()

// Mount workspace routes at root level (/, /list)
router.use('/', workspaceRouter)

// Mount beads routes under /beads
router.use('/beads', beadsRouter)

// Mount GSD routes under /gsd
router.use('/gsd', gsdRouter)

export default router

// Re-export helpers for potential use elsewhere
export { sendResponse, sendError } from './helpers.js'
