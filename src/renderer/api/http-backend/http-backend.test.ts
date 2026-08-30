import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServerProtocolDescriptor } from '../../../common/server-protocol'
import type { Api } from '../types'
import { HttpBackend } from './http-backend'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HttpBackend API contract', () => {
  it('implements every renderer API method required at startup', () => {
    const api: Api = new HttpBackend({ host: 'localhost', port: 38470, token: 'test' })

    for (const method of [
      'getWorkspace', 'saveWorkspace', 'getSettings', 'saveSettings',
      'getEnvironmentSnapshot', 'getEnvironmentEvents', 'executeEnvironmentCommand', 'onEnvironmentEvent',
      'discoverSessions', 'listPtys', 'spawnPty', 'writePty', 'resizePty', 'killPty',
      'onPtyData', 'onPtyGeometry', 'onPtyExit', 'onPtyRecreated', 'onAgentSessionSignal',
      'onApiOpenSession', 'onOrchestratorSessionCreated',
    ] as const) {
      expect(typeof api[method], method).toBe('function')
    }
  })

  it('routes compatibility workspace writes through a revisioned environment command', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ serverId: 'server-a', revision: 4, workspace: { projects: [], categories: [] }, sessions: [], ptys: [] }))
      .mockResolvedValueOnce(jsonResponse({ serverId: 'server-a', revision: 5, result: { success: true }, replayed: false }))
    vi.stubGlobal('fetch', fetchMock)
    const backend = new HttpBackend({ host: 'localhost', port: 38470, token: 'test' })

    await expect(backend.saveWorkspace({ projects: [], categories: [] })).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:38470/api/environment/snapshot')
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:38470/api/environment/commands')
    const body = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(body).toMatchObject({ serverId: 'server-a', expectedRevision: 4, command: { type: 'replace-workspace' } })
  })

  it('negotiates protocol compatibility before reporting a successful connection', async () => {
    const descriptor = createServerProtocolDescriptor('1.3.58')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse(descriptor))
    vi.stubGlobal('fetch', fetchMock)

    const backend = new HttpBackend({ host: 'localhost', port: 38470, token: 'test' })

    await expect(backend.testConnection()).resolves.toEqual({ success: true })
    expect(backend.getServerProtocol()).toEqual(descriptor)
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:38470/health')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:38470/api/protocol',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.any(String) }),
      })
    )
  })

  it('returns a clean error for an incompatible server', async () => {
    const incompatible = {
      ...createServerProtocolDescriptor('future'),
      minVersion: 2,
      maxVersion: 2,
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse(incompatible)))

    const backend = new HttpBackend({ host: 'localhost', port: 38470, token: 'test' })

    const result = await backend.testConnection()
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Incompatible DonutCode protocol versions/)
    expect(backend.getServerProtocol()).toBeNull()
  })
})
