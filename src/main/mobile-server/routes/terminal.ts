/**
 * Terminal Routes - /api/terminal/* endpoints
 */

import { Express, Request, Response } from 'express'
import { WebSocket } from 'ws'
import type { SessionStore } from '../../session-store'
import { resolveMobileSpawnSettings } from './spawn-settings'
import { validateWithinProjectRoots } from '../../mobile-security'
import { getProjectRoots } from '../utils'

export function setupTerminalRoutes(
  app: Express,
  getPtyManager: () => any,
  getSessionStore: () => SessionStore | null,
  getTerminalSubscriptions: () => Map<string, Set<WebSocket>>,
  broadcastTerminalData: (ptyId: string, data: string) => void
): void {
  app.post('/api/terminal/create', async (req: Request, res: Response) => {
    try {
      const { cwd, projectPath, sessionId, model, backend } = req.body
      const spawnCwd = projectPath || cwd
      if (!spawnCwd || typeof spawnCwd !== 'string') {
        return res.status(400).json({ error: 'projectPath is required' })
      }

      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }

      // H2: constrain the spawn cwd to a registered workspace project (or a
      // subdirectory of one) — same gate as /api/pty/spawn.
      const pathValidation = validateWithinProjectRoots(
        spawnCwd,
        getProjectRoots(getSessionStore()),
        { mustExist: true, mustBeDirectory: true }
      )
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeSpawnCwd = pathValidation.normalizedPath!

      const spawnSettings = resolveMobileSpawnSettings(
        getSessionStore(),
        safeSpawnCwd,
        backend,
        model
      )

      const ptyId = await ptyManager.spawn(
        safeSpawnCwd,
        sessionId,
        spawnSettings.autoAcceptTools,
        spawnSettings.permissionMode,
        spawnSettings.model,
        spawnSettings.backend
      )

      // Set up data forwarding to WebSocket subscribers
      ptyManager.onData(ptyId, (data: string) => {
        broadcastTerminalData(ptyId, data)
      })

      res.json({ success: true, ptyId })
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' })
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
      res.status(500).json({ error: 'Internal server error' })
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
      res.status(500).json({ error: 'Internal server error' })
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
      res.status(500).json({ error: 'Internal server error' })
    }
  })
}
