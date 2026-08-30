import { createServer, type Server } from 'http'
import { mkdirSync, rmSync } from 'fs'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentCommandRouter } from '../../environment-command-router'
import { EnvironmentEventLog } from '../../environment-event-log'
import { EnvironmentState } from '../../environment-state'
import { SessionRuntimeRegistry } from '../../session-runtime-registry'
import type { LocalPty } from '../types'
import { setupPtyRoutes } from './pty'
import { DeviceRegistry } from '../device-registry'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setupTerminalRoutes } from './terminal'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

class FakePtyManager {
  private nextId = 0
  private live = new Map<string, object>()
  private exitListeners = new Map<string, Set<(code: number) => void>>()
  readonly spawn = vi.fn(() => {
    const id = `pty-${++this.nextId}`
    this.live.set(id, {})
    return id
  })
  readonly writeUserInput = vi.fn()
  readonly write = vi.fn()
  readonly resize = vi.fn()
  readonly addDataListener = vi.fn(() => () => {})
  readonly terminate = vi.fn(async (id: string) => {
    this.live.delete(id)
    for (const listener of this.exitListeners.get(id) ?? []) listener(0)
  })

  getProcess(id: string): object | undefined { return this.live.get(id) }
  listSessions(): object[] { return [] }
  addExitListener(id: string, listener: (code: number) => void): () => void {
    const listeners = this.exitListeners.get(id) ?? new Set()
    listeners.add(listener)
    this.exitListeners.set(id, listeners)
    return () => listeners.delete(listener)
  }
}

let server: Server | null = null
const projectPath = '/tmp/donutcode-runtime-route-test'

afterEach(async () => {
  if (!server) return
  await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
  server = null
  rmSync(projectPath, { recursive: true, force: true })
})

async function startRoute(): Promise<{
  baseUrl: string
  ptyManager: FakePtyManager
  router: EnvironmentCommandRouter
  registry: SessionRuntimeRegistry
  localPtys: Map<string, LocalPty>
}> {
  mkdirSync(projectPath, { recursive: true })
  const state = new EnvironmentState('server-http', {
    projects: [{ path: projectPath, name: 'Repo', harnessId: 'claude' }],
    sessions: [],
    activeSessionId: null,
  })
  const router = new EnvironmentCommandRouter(state, new EnvironmentEventLog('server-http'))
  const ptyManager = new FakePtyManager()
  const registry = new SessionRuntimeRegistry(ptyManager as any, router)
  const localPtys = new Map<string, LocalPty>()
  const ptyStreams = new Map()
  const app = express()
  app.use(express.json())
  setupPtyRoutes(
    app,
    new DeviceRegistry(mkdtempSync(join(tmpdir(), 'donutcode-pty-registry-'))),
    () => ptyManager,
    () => registry,
    () => ({
      getWorkspace: () => ({ projects: [{ path: projectPath, name: 'Repo' }] }),
      getProjectSettings: () => null,
      getSettings: () => ({}),
    }) as any,
    () => localPtys,
    () => ptyStreams,
    () => {},
  )
  setupTerminalRoutes(
    app,
    () => ptyManager,
    () => registry,
    () => ({
      getWorkspace: () => ({ projects: [{ path: projectPath, name: 'Repo' }] }),
      getProjectSettings: () => null,
      getSettings: () => ({}),
    }) as any,
    () => new Map(),
    () => {},
  )
  server = createServer(app)
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
  return { baseUrl: `http://127.0.0.1:${address.port}`, ptyManager, router, registry, localPtys }
}

describe('PTY runtime authority routes', () => {
  it('returns the server-side harness launch error to the authenticated client', async () => {
    const { baseUrl, ptyManager } = await startRoute()
    ptyManager.spawn.mockImplementationOnce(() => {
      throw new Error('posix_spawnp failed: No such file or directory')
    })

    const response = await fetch(`${baseUrl}/api/pty/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, backend: 'hermes' }),
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to start hermes harness on this server: posix_spawnp failed: No such file or directory',
    })
  })

  it('atomically attaches concurrent clients, orders input, and detaches without stopping', async () => {
    const { baseUrl, ptyManager, router } = await startRoute()
    const request = {
      projectPath: '/tmp/donutcode-runtime-route-test',
      sessionId: 'canonical-session',
      agentSessionId: 'canonical-session',
      backend: 'claude',
    }

    const responses = await Promise.all([
      fetch(`${baseUrl}/api/pty/spawn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
      }).then(response => response.json()),
      fetch(`${baseUrl}/api/pty/spawn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
      }).then(response => response.json()),
    ])

    expect(ptyManager.spawn).toHaveBeenCalledTimes(1)
    expect(responses[0].ptyId).toBe(responses[1].ptyId)
    expect(responses.map(response => response.attached).sort()).toEqual([false, true])
    expect(router.getSnapshot().ptys).toHaveLength(1)

    const legacyAttach = await fetch(`${baseUrl}/api/terminal/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    }).then(response => response.json())
    expect(legacyAttach).toMatchObject({
      success: true,
      ptyId: responses[0].ptyId,
      runtimeId: responses[0].runtimeId,
      agentSessionId: 'canonical-session',
    })
    expect(ptyManager.spawn).toHaveBeenCalledTimes(1)

    const firstInput = await fetch(`${baseUrl}/api/pty/${responses[0].ptyId}/write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'a' }),
    }).then(response => response.json())
    const secondInput = await fetch(`${baseUrl}/api/pty/${responses[0].ptyId}/write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'b' }),
    }).then(response => response.json())
    expect([firstInput.acknowledgement.sequence, secondInput.acknowledgement.sequence]).toEqual([1, 2])

    const detach = await fetch(`${baseUrl}/api/pty/${responses[0].ptyId}`, { method: 'DELETE' })
      .then(response => response.json())
    expect(detach).toEqual({ success: true, stopped: false })
    expect(ptyManager.getProcess(responses[0].ptyId)).toBeTruthy()

    const reconnect = await fetch(`${baseUrl}/api/pty/spawn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    }).then(response => response.json())
    expect(reconnect).toMatchObject({ ptyId: responses[0].ptyId, attached: true })
    expect(ptyManager.spawn).toHaveBeenCalledTimes(1)

    const stop = await fetch(`${baseUrl}/api/pty/${responses[0].ptyId}?stop=true`, { method: 'DELETE' })
      .then(response => response.json())
    expect(stop).toEqual({ success: true, stopped: true })
    expect(ptyManager.terminate).toHaveBeenCalledWith(responses[0].ptyId)
    expect(ptyManager.getProcess(responses[0].ptyId)).toBeUndefined()
    expect(router.getSnapshot().sessions[0].lifecycle).toBe('stopped')
  })

  it('switches a live PTY to another harness and reports the replacement id', async () => {
    const { baseUrl, ptyManager, router } = await startRoute()
    const spawn = await fetch(`${baseUrl}/api/pty/spawn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: '/tmp/donutcode-runtime-route-test',
        sessionId: 'canonical-session',
        agentSessionId: 'canonical-session',
        backend: 'claude',
      }),
    }).then(response => response.json())

    const switched = await fetch(`${baseUrl}/api/pty/${spawn.ptyId}/backend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'hermes' }),
    }).then(response => response.json())

    expect(switched).toMatchObject({ success: true, oldId: spawn.ptyId, backend: 'hermes' })
    expect(switched.newId).not.toBe(spawn.ptyId)
    // A harness change creates a distinct canonical session, not a resume.
    expect(switched.sessionId).toBeUndefined()
    expect(ptyManager.terminate).toHaveBeenCalledWith(spawn.ptyId)
    expect(ptyManager.getProcess(switched.newId)).toBeTruthy()
    expect(router.getSnapshot().sessions.map(s => s.harnessId)).toContain('hermes')

    // Switching an unknown pty is rejected.
    const missing = await fetch(`${baseUrl}/api/pty/nope/backend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'codex' }),
    })
    expect(missing.status).toBe(404)

    // Unsupported harnesses are rejected.
    const invalid = await fetch(`${baseUrl}/api/pty/${spawn.ptyId}/backend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'clippy' }),
    })
    expect(invalid.status).toBe(400)
  })

  it('lets the authority HTTP client resize a host-owned desktop PTY', async () => {
    const { baseUrl, ptyManager, registry, localPtys } = await startRoute()
    const runtime = await registry.ensureRuntime({
      agentSessionId: 'desktop-session',
      projectId: projectPath,
      harnessId: 'claude',
    })

    const attached = await fetch(`${baseUrl}/api/pty/spawn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath,
        sessionId: 'desktop-session',
        agentSessionId: 'desktop-session',
        backend: 'claude',
      }),
    }).then(response => response.json())
    expect(attached).toMatchObject({ ptyId: runtime.ptyId, attached: true })
    expect(localPtys.has(runtime.ptyId)).toBe(false)

    const resized = await fetch(`${baseUrl}/api/pty/${runtime.ptyId}/resize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 42, rows: 18 }),
    }).then(response => response.json())
    expect(resized).toEqual({ success: true, applied: true })
    expect(ptyManager.resize).toHaveBeenCalledWith(runtime.ptyId, 42, 18)
  })

  it('keeps a desktop HTTP spawn under authority resize ownership', async () => {
    const { baseUrl, ptyManager, localPtys } = await startRoute()
    const spawned = await fetch(`${baseUrl}/api/pty/spawn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, agentSessionId: 'remote-session', backend: 'claude' }),
    }).then(response => response.json())
    expect(spawned.attached).toBe(false)
    expect(localPtys.has(spawned.ptyId)).toBe(false)

    const resized = await fetch(`${baseUrl}/api/pty/${spawned.ptyId}/resize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 100, rows: 36 }),
    }).then(response => response.json())
    expect(resized).toEqual({ success: true, applied: true })
    expect(ptyManager.resize).toHaveBeenCalledWith(spawned.ptyId, 100, 36)
  })

  it('does not apply the remote 16-session cap to host desktop spawns', async () => {
    const { baseUrl, localPtys } = await startRoute()
    const ids = new Set<string>()
    for (let i = 0; i < 18; i += 1) {
      const spawned = await fetch(`${baseUrl}/api/pty/spawn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, agentSessionId: `desktop-${i}`, backend: 'claude' }),
      }).then(response => response.json())
      expect(spawned.ptyId).toBeTruthy()
      expect(spawned.error).toBeUndefined()
      ids.add(spawned.ptyId)
    }
    expect(ids.size).toBe(18)
    expect(localPtys.size).toBe(0)
  })
})
