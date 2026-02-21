/**
 * PTY Routes - /api/pty/* endpoints
 */

import { Express, Request, Response } from 'express'
import { WebSocket } from 'ws'
import { validateProjectPath } from '../../mobile-security'
import { log } from '../utils'
import { LocalPty } from '../types'

export function setupPtyRoutes(
  app: Express,
  getPtyManager: () => any,
  getLocalPtys: () => Map<string, LocalPty>,
  getPtyStreams: () => Map<string, Set<WebSocket>>,
  getPtyDataBuffer: () => Map<string, string[]>,
  broadcastPtyData: (ptyId: string, data: string) => void,
  broadcastPtyExit: (ptyId: string, code: number) => void
): void {
  // Spawn a new PTY
  app.post('/api/pty/spawn', async (req: Request, res: Response) => {
    try {
      const { projectPath, sessionId, model, backend } = req.body

      if (!projectPath || typeof projectPath !== 'string') {
        return res.status(400).json({ error: 'projectPath is required' })
      }

      const pathValidation = validateProjectPath(projectPath)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeProjectPath = pathValidation.normalizedPath!

      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }

      log('PTY spawn request', { projectPath: safeProjectPath, sessionId, model, backend })

      const ptyId = ptyManager.spawn(
        safeProjectPath,
        sessionId,
        undefined, // autoAcceptTools
        undefined, // permissionMode
        model,
        backend
      )

      // Track this PTY for cleanup
      const localPty: LocalPty = {
        ptyId,
        projectPath: safeProjectPath,
        dataCallbacks: new Set(),
        exitCallbacks: new Set()
      }
      getLocalPtys().set(ptyId, localPty)

      // Set up data forwarding to WebSocket streams
      ptyManager.onData(ptyId, (data: string) => {
        broadcastPtyData(ptyId, data)
      })

      // Set up exit handler
      ptyManager.onExit(ptyId, (code: number) => {
        log('PTY exited', { ptyId, code })
        broadcastPtyExit(ptyId, code)
        getLocalPtys().delete(ptyId)
        getPtyStreams().delete(ptyId)
        getPtyDataBuffer().delete(ptyId)
      })

      log('PTY spawned', { ptyId, projectPath })
      res.json({ ptyId })
    } catch (error) {
      log('PTY spawn error', { error: String(error) })
      res.status(500).json({ error: String(error) })
    }
  })

  // Write data to PTY
  app.post('/api/pty/:id/write', (req: Request, res: Response) => {
    try {
      const { id } = req.params
      const { data } = req.body

      if (!data || typeof data !== 'string') {
        return res.status(400).json({ error: 'data is required and must be a string' })
      }

      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }

      if (!ptyManager.getProcess(id)) {
        return res.status(404).json({ error: 'PTY not found' })
      }

      ptyManager.write(id, data)
      log('PTY write', { ptyId: id, dataLength: data.length })
      res.json({ success: true })
    } catch (error) {
      log('PTY write error', { error: String(error) })
      res.status(500).json({ error: String(error) })
    }
  })

  // Resize PTY
  app.post('/api/pty/:id/resize', (req: Request, res: Response) => {
    try {
      const { id } = req.params
      const { cols, rows } = req.body

      if (typeof cols !== 'number' || typeof rows !== 'number') {
        return res.status(400).json({ error: 'cols and rows are required and must be numbers' })
      }

      if (cols < 1 || rows < 1 || cols > 500 || rows > 500) {
        return res.status(400).json({ error: 'cols and rows must be between 1 and 500' })
      }

      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }

      if (!ptyManager.getProcess(id)) {
        return res.status(404).json({ error: 'PTY not found' })
      }

      ptyManager.resize(id, cols, rows)
      log('PTY resize', { ptyId: id, cols, rows })
      res.json({ success: true })
    } catch (error) {
      log('PTY resize error', { error: String(error) })
      res.status(500).json({ error: String(error) })
    }
  })

  // Kill PTY
  app.delete('/api/pty/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params

      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }

      if (!ptyManager.getProcess(id)) {
        return res.status(404).json({ error: 'PTY not found' })
      }

      ptyManager.kill(id)
      getLocalPtys().delete(id)

      // Close any WebSocket streams for this PTY
      const streams = getPtyStreams().get(id)
      if (streams) {
        streams.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'PTY killed')
          }
        })
        getPtyStreams().delete(id)
      }

      log('PTY killed', { ptyId: id })
      res.json({ success: true })
    } catch (error) {
      log('PTY kill error', { error: String(error) })
      res.status(500).json({ error: String(error) })
    }
  })
}
