import { describe, expect, it, vi } from 'vitest'
import { createServerProtocolDescriptor } from '../../common/server-protocol'
import { ConnectionRegistry, type ConnectableApi, type ConnectionEndpoint } from '../api/connection-registry'

function fakeApi(serverId: string): ConnectableApi {
  const descriptor = createServerProtocolDescriptor('test', serverId, 'linux')
  return {
    testConnection: vi.fn().mockResolvedValue({ success: true }),
    disconnect: vi.fn(),
    getServerProtocol: () => descriptor,
  } as unknown as ConnectableApi
}

function saved(serverId: string, port: number) {
  return {
    serverId,
    displayName: serverId,
    endpoints: [{ host: '127.0.0.1', port }],
    credentialRef: `credential:${serverId}`,
    lastSeenProtocolVersion: 0,
    capabilities: [],
  }
}

describe('ConnectionRegistry', () => {
  it('keeps simultaneous server APIs isolated by immutable server ID', async () => {
    const apis = new Map<string, ConnectableApi>([
      ['4001', fakeApi('server-a')],
      ['4002', fakeApi('server-b')],
    ])
    const registry = new ConnectionRegistry(
      reference => `token-for-${reference}`,
      (endpoint: ConnectionEndpoint) => apis.get(String(endpoint.port))!,
    )
    registry.register(saved('server-a', 4001))
    registry.register(saved('server-b', 4002))

    await Promise.all([registry.connect('server-a'), registry.connect('server-b')])

    expect(registry.get('server-a')).toBe(apis.get('4001'))
    expect(registry.get('server-b')).toBe(apis.get('4002'))
    expect(registry.getStatus('server-a').state).toBe('connected')
    expect(registry.getStatus('server-b').state).toBe('connected')

    registry.disconnect('server-a')
    expect(() => registry.get('server-a')).toThrow('not connected')
    expect(registry.get('server-b')).toBe(apis.get('4002'))
    expect(registry.getStatus('server-b').state).toBe('connected')
  })

  it('never falls back when a requested server is unknown or offline', async () => {
    const registry = new ConnectionRegistry(() => 'token', () => fakeApi('server-a'))
    registry.register(saved('server-a', 4001))

    expect(() => registry.get('missing')).toThrow('not connected')
    expect(() => registry.get('server-a')).toThrow('not connected')
  })

  it('rejects an endpoint that presents a different stable server identity', async () => {
    const registry = new ConnectionRegistry(() => 'token', () => fakeApi('server-b'))
    registry.register(saved('server-a', 4001))

    await expect(registry.connect('server-a')).rejects.toThrow(
      'Server identity mismatch: expected server-a, received server-b',
    )
    expect(registry.getStatus('server-a')).toMatchObject({ state: 'error' })
    expect(() => registry.get('server-a')).toThrow('not connected')
  })
})
