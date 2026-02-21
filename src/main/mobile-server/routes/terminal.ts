/**
 * Terminal Routes - /api/terminal/* endpoints
 */

import { Express, Request, Response } from 'express'
import { WebSocket } from 'ws'

export function setupTerminalRoutes(
  app: Express,
  getPtyManager: () => any,
  getTerminalSubscriptions: () => Map<string, Set<WebSocket>>,
  broadcastTerminalData: (ptyId: string, data: string) => void
): void {
  app.post('/api/terminal/create', async (req: Request, res: Response) => {
    try {
      const { cwd, backend = 'claude' } = req.body
      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }

      const ptyId = await ptyManager.spawn(cwd, backend)

      // Set up data forwarding to WebSocket subscribers
      ptyManager.onData(ptyId, (data: string) => {
        broadcastTerminalData(ptyId, data)
      })

      res.json({ success: true, ptyId })
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })

  app.post('/api/terminal/:ptyId/write', (req: Request, res: Response) => {
    try {
      const { ptyId } = req.params
      const { data } = req.body
      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }
      ptyManager.write(ptyId, data)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })

  app.post('/api/terminal/:ptyId/resize', (req: Request, res: Response) => {
    try {
      const { ptyId } = req.params
      const { cols, rows } = req.body
      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }
      ptyManager.resize(ptyId, cols, rows)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })

  app.delete('/api/terminal/:ptyId', (req: Request, res: Response) => {
    try {
      const { ptyId } = req.params
      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }
      ptyManager.kill(ptyId)
      getTerminalSubscriptions().delete(ptyId)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })
}
