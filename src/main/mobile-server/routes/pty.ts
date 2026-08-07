/**
 * PTY Routes - /api/pty/* endpoints
 */

import { Express, Request, Response } from 'express'
import { WebSocket } from 'ws'
import { validateWithinProjectRoots } from '../../mobile-security'
import { log, getProjectRoots } from '../utils'
import { LocalPty } from '../types'
import type { SessionStore } from '../../session-store'
import type { SessionRuntimeRegistry } from '../../session-runtime-registry'
import { installAgentSessionSignalInstructions } from '../../ipc/agent-session-signal-instructions'
import type { AIBackend } from '../../ipc/instruction-files'
import { resolveMobileSpawnSettings } from './spawn-settings'

// L3: cap how many backends a mobile client can spawn so a runaway/abusive
// client can't exhaust host resources by spawning unbounded PTY processes.
const MAX_MOBILE_PTYS = 16

export function setupPtyRoutes(
  app: Express,
  getPtyManager: () => any,
  getRuntimeRegistry: () => SessionRuntimeRegistry | null,
  getSessionStore: () => SessionStore | null,
  getLocalPtys: () => Map<string, LocalPty>,
  getPtyStreams: () => Map<string, Set<WebSocket>>,
  broadcastPtyExit: (ptyId: string, code: number) => void
): void {
  // List all host-owned live PTYs for diagnostics and compatibility clients.
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
      const { projectPath, sessionId, agentSessionId, model, backend } = req.body

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
      const runtimeRegistry = getRuntimeRegistry()
      if (!runtimeRegistry) {
        return res.status(500).json({ error: 'Runtime registry not available' })
      }

      // L3: enforce the mobile-visible PTY ceiling only for a new runtime. An
      // attach to an already running canonical session must remain available.
      const canonicalSessionId = agentSessionId || sessionId
      const existingRuntime = canonicalSessionId
        ? runtimeRegistry.getRuntime(canonicalSessionId)
        : null
      if (!existingRuntime && getLocalPtys().size >= MAX_MOBILE_PTYS) {
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

      installAgentSessionSignalInstructions(safeProjectPath, spawnSettings.backend as AIBackend)
      const runtime = await runtimeRegistry.ensureRuntime({
        agentSessionId: canonicalSessionId,
        nativeSessionId: sessionId,
        projectId: safeProjectPath,
        harnessId: spawnSettings.backend,
        autoAcceptTools: spawnSettings.autoAcceptTools,
        permissionMode: spawnSettings.permissionMode,
        model: spawnSettings.model,
      })
      const ptyId = runtime.ptyId

      if (!getLocalPtys().has(ptyId)) {
        const localPty: LocalPty = {
          ptyId,
          projectPath: safeProjectPath,
          dataCallbacks: new Set(),
          exitCallbacks: new Set()
        }
        getLocalPtys().set(ptyId, localPty)

        localPty.disposeExit = ptyManager.addExitListener(ptyId, (code: number) => {
          log('PTY exited', { ptyId, code })
          broadcastPtyExit(ptyId, code)
          getLocalPtys().delete(ptyId)
        })
      }

      log(runtime.created ? 'PTY spawned' : 'PTY attached', {
        ptyId,
        agentSessionId: runtime.agentSessionId,
        projectPath: safeProjectPath,
      })
      res.json({
        ptyId,
        runtimeId: runtime.runtimeId,
        agentSessionId: runtime.agentSessionId,
        attached: !runtime.created,
      })
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

      const acknowledgement = getRuntimeRegistry()?.writeInput(id, data)
      log('PTY write', { ptyId: id, dataLength: data.length })
      res.json({ success: true, acknowledgement })
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

      getRuntimeRegistry()?.resize(id, cols, rows)
      log('PTY resize', { ptyId: id, cols, rows })
      res.json({ success: true })
    } catch (error) {
      log('PTY resize error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Switch a PTY to another harness. Mirrors the desktop IPC
  // (pty:set-backend): stop the old runtime, ensure a new runtime bound to the
  // requested harness, then tell connected stream clients to re-attach. A
  // harness change creates a distinct canonical session; the old runtime is
  // stopped but its saved state remains under the original harness binding.
  app.post('/api/pty/:id/backend', async (req: Request, res: Response) => {
    try {
      const { id } = req.params
      const { backend } = req.body
      const validBackends = ['claude', 'gemini', 'codex', 'opencode', 'aider', 'droid', 'hermes', 'grok']
      if (typeof backend !== 'string' || !validBackends.includes(backend)) {
        return res.status(400).json({ error: 'backend must be a supported harness' })
      }

      const ptyManager = getPtyManager()
      const runtimeRegistry = getRuntimeRegistry()
      if (!ptyManager || !runtimeRegistry) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }

      const process = ptyManager.getProcess(id)
      if (!process) {
        return res.status(404).json({ error: 'PTY not found' })
      }

      const { cwd, sessionId, backend: oldBackend } = process
      const effectiveSessionId = oldBackend !== backend ? undefined : sessionId
      const projectPath = cwd

      installAgentSessionSignalInstructions(projectPath, backend as AIBackend)
      await runtimeRegistry.stopRuntimeByPty(id)

      const runtime = await runtimeRegistry.ensureRuntime({
        nativeSessionId: effectiveSessionId,
        projectId: projectPath,
        harnessId: backend,
      })
      const newId = runtime.ptyId

      // Wire the replacement PTY into the mobile-visible registry so its data
      // and exit streams keep flowing to attached clients.
      if (!getLocalPtys().has(newId)) {
        const localPty: LocalPty = {
          ptyId: newId,
          projectPath,
          dataCallbacks: new Set(),
          exitCallbacks: new Set()
        }
        getLocalPtys().set(newId, localPty)
        localPty.disposeExit = ptyManager.addExitListener(newId, (code: number) => {
          log('PTY exited', { ptyId: newId, code })
          broadcastPtyExit(newId, code)
          getLocalPtys().delete(newId)
        })
      }

      // Detach the old stream sockets: they are pointed at the stopped PTY.
      // Clients re-attach against the replacement id.
      const oldStreams = getPtyStreams().get(id)
      if (oldStreams) {
        for (const ws of oldStreams) {
          if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'PTY recreated')
        }
        getPtyStreams().delete(id)
      }

      log('PTY backend switched', { oldId: id, newId, backend, projectPath })
      res.json({ success: true, oldId: id, newId, backend, sessionId: effectiveSessionId })
    } catch (error) {
      log('PTY backend switch error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Detach a frontend. Pass ?stop=true only for an explicit host runtime stop.
  app.delete('/api/pty/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params

      const ptyManager = getPtyManager()
      if (!ptyManager) {
        return res.status(500).json({ error: 'PTY manager not available' })
      }

      if (!ptyManager.getProcess(id)) {
        return res.status(404).json({ error: 'PTY not found' })
      }

      // Closing a frontend view detaches by default. Explicit process stop is
      // reserved for callers that deliberately pass ?stop=true.
      const shouldStop = req.query.stop === 'true'
      if (shouldStop) {
        const localPty = getLocalPtys().get(id)
        localPty?.disposeExit?.()
        getLocalPtys().delete(id)
        await getRuntimeRegistry()?.stopRuntimeByPty(id)
        const streams = getPtyStreams().get(id)
        if (streams) {
          streams.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'PTY stopped')
          })
          getPtyStreams().delete(id)
        }
      }

      log(shouldStop ? 'PTY stopped' : 'PTY detached', { ptyId: id })
      res.json({ success: true, stopped: shouldStop })
    } catch (error) {
      log('PTY kill error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })
}
