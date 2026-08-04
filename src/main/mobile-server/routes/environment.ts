import type { Express, Request, Response } from 'express'
import {
  EnvironmentCommandConflictError,
  EnvironmentCommandRouter,
  EnvironmentRevisionConflictError,
} from '../../environment-command-router.js'

export function setupEnvironmentRoutes(
  app: Express,
  getRouter: () => EnvironmentCommandRouter | null,
): void {
  app.get('/api/environment/snapshot', (_req: Request, res: Response) => {
    const router = getRouter()
    if (!router) return res.status(503).json({ error: 'Environment authority is not available' })
    return res.json(router.getSnapshot())
  })

  app.get('/api/environment/events', (req: Request, res: Response) => {
    const router = getRouter()
    if (!router) return res.status(503).json({ error: 'Environment authority is not available' })
    const after = Number(req.query.after ?? 0)
    if (!Number.isSafeInteger(after) || after < 0) {
      return res.status(400).json({ error: 'after must be a non-negative integer revision' })
    }
    return res.json(router.getEventsAfter(after))
  })

  app.post('/api/environment/commands', (req: Request, res: Response) => {
    const router = getRouter()
    if (!router) return res.status(503).json({ error: 'Environment authority is not available' })
    try {
      return res.json(router.execute(req.body))
    } catch (error) {
      if (error instanceof EnvironmentRevisionConflictError) {
        return res.status(409).json({
          error: error.message,
          code: error.code,
          expectedRevision: error.expectedRevision,
          currentRevision: error.currentRevision,
          snapshot: error.snapshot,
        })
      }
      if (error instanceof EnvironmentCommandConflictError) {
        return res.status(409).json({ error: error.message, code: error.code })
      }
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid environment command' })
    }
  })
}
