import { createServer, type Server } from 'http'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { EnvironmentCommandRouter } from '../../environment-command-router'
import { EnvironmentEventLog } from '../../environment-event-log'
import { EnvironmentState } from '../../environment-state'
import type { Workspace } from '../../session-store'
import { setupEnvironmentRoutes } from './environment'

let server: Server | null = null

afterEach(async () => {
  if (!server) return
  await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
  server = null
})

async function startRoute(): Promise<{ baseUrl: string; router: EnvironmentCommandRouter }> {
  const workspace: Workspace = {
    projects: [{ path: '/repo', name: 'Repo' }],
    sessions: [{ id: 'workspace-1', name: 'Workspace 1', openTabs: [], activeTabId: null }],
    activeSessionId: 'workspace-1',
  }
  const state = new EnvironmentState('server-http', workspace)
  const log = new EnvironmentEventLog<Workspace>('server-http')
  const router = new EnvironmentCommandRouter(state, log)
  const app = express()
  app.use(express.json())
  setupEnvironmentRoutes(app, () => router)
  server = createServer(app)
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
  return { baseUrl: `http://127.0.0.1:${address.port}`, router }
}

describe('environment routes', () => {
  it('exposes snapshot, command, and cursor catch-up over one semantic contract', async () => {
    const { baseUrl } = await startRoute()
    const snapshot = await fetch(`${baseUrl}/api/environment/snapshot`).then(response => response.json())
    expect(snapshot).toMatchObject({ serverId: 'server-http', revision: 0 })

    const command = {
      serverId: 'server-http',
      clientId: 'http-client',
      commandId: 'rename-1',
      expectedRevision: 0,
      command: { type: 'rename-workspace', workspaceId: 'workspace-1', name: 'Remote name' },
    }
    const response = await fetch(`${baseUrl}/api/environment/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ revision: 1, replayed: false })

    const events = await fetch(`${baseUrl}/api/environment/events?after=0`).then(value => value.json())
    expect(events).toMatchObject({ mode: 'events', currentRevision: 1 })
    expect(events.events).toEqual([expect.objectContaining({ revision: 1 })])
  })

  it('returns conflict metadata for a stale command and replays an identical retry', async () => {
    const { baseUrl } = await startRoute()
    const first = {
      serverId: 'server-http',
      clientId: 'http-client',
      commandId: 'set-active',
      expectedRevision: 0,
      command: { type: 'set-active-workspace', workspaceId: 'workspace-1' },
    }
    await fetch(`${baseUrl}/api/environment/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(first),
    })

    const replay = await fetch(`${baseUrl}/api/environment/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(first),
    })
    await expect(replay.json()).resolves.toMatchObject({ revision: 1, replayed: true })

    const stale = await fetch(`${baseUrl}/api/environment/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...first, commandId: 'stale', clientId: 'other-client' }),
    })
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toMatchObject({
      code: 'REVISION_CONFLICT',
      expectedRevision: 0,
      currentRevision: 1,
      snapshot: { revision: 1 },
    })
  })

  it('rejects runtime lifecycle commands from public clients', async () => {
    const { baseUrl, router } = await startRoute()
    const response = await fetch(`${baseUrl}/api/environment/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: 'server-http',
        clientId: 'http-client',
        commandId: 'fake-stop',
        expectedRevision: 0,
        command: { type: 'stop-session', agentSessionId: 'session-a' },
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'stop-session is reserved for the server runtime registry',
    })
    expect(router.getSnapshot().revision).toBe(0)
  })

  it('rejects unknown commands without advancing the revision', async () => {
    const { baseUrl, router } = await startRoute()
    const response = await fetch(`${baseUrl}/api/environment/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: 'server-http',
        clientId: 'http-client',
        commandId: 'unknown',
        expectedRevision: 0,
        command: { type: 'destroy-everything' },
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unknown environment command: destroy-everything' })
    expect(router.getSnapshot().revision).toBe(0)
  })
})
