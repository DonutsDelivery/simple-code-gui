/**
 * Terminal Routes - /api/terminal/* endpoints
 */

import { Express, Request, Response } from 'express'
import { WebSocket } from 'ws'
import type { SessionStore } from '../../session-store'
import { installAgentSessionSignalInstructions } from '../../ipc/agent-session-signal-instructions'
import type { AIBackend } from '../../ipc/instruction-files'
import { resolveMobileSpawnSettings } from './spawn-settings'
import { validateWithinProjectRoots } from '../../mobile-security'
import { getProjectRoots } from '../utils'
import type { SessionRuntimeRegistry } from '../../session-runtime-registry'

export function setupTerminalRoutes(
  app: Express,
  getPtyManager: () => any,
  getRuntimeRegistry: () => SessionRuntimeRegistry | null,
  getSessionStore: () => SessionStore | null,
  getTerminalSubscriptions: () => Map<string, Set<WebSocket>>,
  broadcastTerminalData: (ptyId: string, data: string) => void
): void {
  const dataSubscriptions = new Map<string, () => void>()

  app.post('/api/terminal/create', async (req: Request, res: Response) => {
    try {
      const { cwd, projectPath, agentSessionId, sessionId, model, backend } = req.body
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

      installAgentSessionSignalInstructions(safeSpawnCwd, spawnSettings.backend as AIBackend)
      const runtimeRegistry = getRuntimeRegistry()
      if (!runtimeRegistry) {
        return res.status(503).json({ error: 'Runtime authority is not available' })
      }
      const runtime = await runtimeRegistry.ensureRuntime({
        agentSessionId: agentSessionId || sessionId,
        nativeSessionId: sessionId,
        projectId: safeSpawnCwd,
        harnessId: spawnSettings.backend,
        autoAcceptTools: spawnSettings.autoAcceptTools,
        permissionMode: spawnSettings.permissionMode,
        model: spawnSettings.model,
      })
      const ptyId = runtime.ptyId

      if (!dataSubscriptions.has(ptyId)) {
        const disposeData = ptyManager.addDataListener(ptyId, (data: string) => {
          broadcastTerminalData(ptyId, data)
        })
        const disposeExit = ptyManager.addExitListener(ptyId, () => {
          disposeData()
          disposeExit()
          dataSubscriptions.delete(ptyId)
        })
        dataSubscriptions.set(ptyId, () => {
          disposeData()
          disposeExit()
        })
      }

      res.json({
        success: true,
        ptyId,
        runtimeId: runtime.runtimeId,
        agentSessionId: runtime.agentSessionId,
      })
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
      const acknowledgement = getRuntimeRegistry()?.writeInput(ptyId, data)
      if (!acknowledgement) return res.status(503).json({ error: 'Runtime authority is not available' })
      res.json({ success: true, acknowledgement })
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
      const runtimeRegistry = getRuntimeRegistry()
      if (!runtimeRegistry) return res.status(503).json({ error: 'Runtime authority is not available' })
      runtimeRegistry.resize(ptyId, cols, rows)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.delete('/api/terminal/:ptyId', async (req: Request, res: Response) => {
    try {
      const { ptyId } = req.params
      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }
      const runtimeRegistry = getRuntimeRegistry()
      if (!runtimeRegistry) return res.status(503).json({ error: 'Runtime authority is not available' })
      dataSubscriptions.get(ptyId)?.()
      dataSubscriptions.delete(ptyId)
      await runtimeRegistry.stopRuntimeByPty(ptyId)
      getTerminalSubscriptions().delete(ptyId)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })
}
