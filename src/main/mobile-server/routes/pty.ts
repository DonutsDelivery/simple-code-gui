/**
 * PTY Routes - /api/pty/* endpoints
 */

import { Express, Request, Response } from 'express'
import { WebSocket } from 'ws'
import { validateWithinProjectRoots } from '../../mobile-security'
import { log, getProjectRoots } from '../utils'
import { LocalPty } from '../types'
import type { SessionStore } from '../../session-store'
import { resolveMobileSpawnSettings } from './spawn-settings'

// L3: cap how many backends a mobile client can spawn so a runaway/abusive
// client can't exhaust host resources by spawning unbounded PTY processes.
const MAX_MOBILE_PTYS = 16

export function setupPtyRoutes(
  app: Express,
  getPtyManager: () => any,
  getSessionStore: () => SessionStore | null,
  getLocalPtys: () => Map<string, LocalPty>,
  getPtyStreams: () => Map<string, Set<WebSocket>>,
  getPtyDataBuffer: () => Map<string, string[]>,
  broadcastPtyData: (ptyId: string, data: string) => void,
  broadcastPtyExit: (ptyId: string, code: number) => void
): void {
  // List all active PTYs (any owner: desktop renderer or mobile-spawned).
  // Mobile clients call this before spawning so they can attach to a
  // matching live PTY instead of spawning a parallel `--resume` process,
  // which would branch the conversation.
  app.get('/api/pty/list', (_req: Request, res: Response) => {
    try {
      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }
      const sessions = ptyManager.listSessions()
      res.json({ ptys: sessions })
    } catch (error) {
      log('PTY list error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Spawn a new PTY
  app.post('/api/pty/spawn', async (req: Request, res: Response) => {
    try {
      const { projectPath, sessionId, model, backend } = req.body

      if (!projectPath || typeof projectPath !== 'string') {
        return res.status(400).json({ error: 'projectPath is required' })
      }

      // H2: constrain the spawn cwd to a registered workspace project (or a
      // subdirectory of one). A LAN token-holder must not be able to start a
      // backend in an arbitrary directory.
      const pathValidation = validateWithinProjectRoots(
        projectPath,
        getProjectRoots(getSessionStore()),
        { mustExist: true, mustBeDirectory: true }
      )
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeProjectPath = pathValidation.normalizedPath!

      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }

      // L3: enforce the mobile-spawned PTY ceiling.
      if (getLocalPtys().size >= MAX_MOBILE_PTYS) {
        log('PTY spawn rejected: cap reached', { active: getLocalPtys().size })
        return res.status(429).json({ error: 'Too many active sessions. Close one before starting another.' })
      }

      const spawnSettings = resolveMobileSpawnSettings(
        getSessionStore(),
        safeProjectPath,
        backend,
        model
      )

      log('PTY spawn request', {
        projectPath: safeProjectPath,
        sessionId,
        model: spawnSettings.model,
        backend: spawnSettings.backend,
        permissionMode: spawnSettings.permissionMode,
        autoAcceptTools: spawnSettings.autoAcceptTools
      })

      const ptyId = ptyManager.spawn(
        safeProjectPath,
        sessionId,
        spawnSettings.autoAcceptTools,
        spawnSettings.permissionMode,
        spawnSettings.model,
        spawnSettings.backend
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
      res.status(500).json({ error: 'Internal server error' })
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
      res.status(500).json({ error: 'Internal server error' })
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
      res.status(500).json({ error: 'Internal server error' })
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
      res.status(500).json({ error: 'Internal server error' })
    }
  })
}
