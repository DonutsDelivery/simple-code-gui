import { beforeEach, describe, expect, it, vi } from 'vitest'

const preferences = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: preferences,
}))

import { useConnectionsStore } from '../stores/connections'

const connection = {
  serverId: 'server-a',
  displayName: 'Studio Server',
  endpoints: [{ host: '127.0.0.1', port: 38470 }],
  credentialRef: 'credential-a',
  lastSeenProtocolVersion: 1,
  capabilities: ['pty' as const],
}

describe('connections store', () => {
  beforeEach(() => {
    preferences.get.mockReset().mockResolvedValue({ value: null })
    preferences.set.mockReset().mockResolvedValue(undefined)
    useConnectionsStore.setState({ connections: [], statuses: {}, hydrated: false })
  })

  it('persists structural connection metadata by stable server ID', async () => {
    await useConnectionsStore.getState().upsert(connection)
    await useConnectionsStore.getState().rename('server-a', 'Renamed')

    expect(useConnectionsStore.getState().connections).toEqual([
      expect.objectContaining({ serverId: 'server-a', displayName: 'Renamed' }),
    ])
    const persisted = JSON.parse(preferences.set.mock.calls.at(-1)![0].value)
    expect(persisted).toEqual([
      expect.objectContaining({ serverId: 'server-a', credentialRef: 'credential-a' }),
    ])
  })

  it('hydrates valid entries and rejects malformed endpoints', async () => {
    preferences.get.mockResolvedValue({
      value: JSON.stringify([
        connection,
        { serverId: 'bad', displayName: 'Bad', endpoints: [{ host: '', port: 70000 }] },
      ]),
    })

    await useConnectionsStore.getState().hydrate()

    expect(useConnectionsStore.getState().hydrated).toBe(true)
    expect(useConnectionsStore.getState().connections.map(item => item.serverId)).toEqual(['server-a'])
  })

  it('tracks each server status independently', () => {
    useConnectionsStore.getState().setStatus({ serverId: 'server-a', state: 'connected' })
    useConnectionsStore.getState().setStatus({ serverId: 'server-b', state: 'error', error: 'offline' })

    expect(useConnectionsStore.getState().statuses).toMatchObject({
      'server-a': { state: 'connected' },
      'server-b': { state: 'error', error: 'offline' },
    })
  })
})
