import type { Express, Request, Response } from 'express'
import type { CoordinationRouter } from '../../coordination-router.js'

export function setupCoordinationRoutes(
  app: Express,
  getRouter: () => CoordinationRouter | null,
): void {
  app.get('/api/coordination', (_req: Request, res: Response) => {
    const router = getRouter()
    if (!router) return res.status(503).json({ error: 'Coordination authority is not available' })
    return res.json(router.getSnapshot())
  })

  app.get('/api/coordination/assignments/:assignmentId', (req: Request, res: Response) => {
    const router = getRouter()
    if (!router) return res.status(503).json({ error: 'Coordination authority is not available' })
    const assignment = router.getAssignment(req.params.assignmentId)
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' })
    return res.json({ assignment })
  })

  app.post('/api/coordination/messages', (req: Request, res: Response) => {
    const router = getRouter()
    if (!router) return res.status(503).json({ error: 'Coordination authority is not available' })
    try {
      return res.json(router.send(req.body))
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid coordination message' })
    }
  })

  app.post('/api/coordination/messages/:messageId/deliver', (req: Request, res: Response) => {
    const router = getRouter()
    if (!router) return res.status(503).json({ error: 'Coordination authority is not available' })
    try {
      return res.json({ delivered: router.deliver(req.params.messageId) })
    } catch (error) {
      return res.status(404).json({ error: error instanceof Error ? error.message : 'Message not found' })
    }
  })
}
