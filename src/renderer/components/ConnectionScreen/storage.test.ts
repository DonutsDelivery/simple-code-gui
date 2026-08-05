import { beforeEach, describe, expect, it, vi } from 'vitest'

const preferences = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}))
const storeDeviceCredential = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/preferences', () => ({ Preferences: preferences }))
vi.mock('../../security/device-credentials.js', () => ({ storeDeviceCredential }))

import { loadSavedHostsAsync } from './storage'

describe('saved host migration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    preferences.set.mockResolvedValue(undefined)
    preferences.remove.mockResolvedValue(undefined)
    storeDeviceCredential.mockResolvedValue(undefined)
  })

  it('moves a legacy token to secure storage without logging or copying it to Preferences', async () => {
    preferences.get
      .mockResolvedValueOnce({ value: null })
      .mockResolvedValueOnce({
        value: JSON.stringify([{
          id: 'legacy-host',
          name: 'Legacy Server',
          host: 'server.example',
          port: 443,
          token: 'durable-secret',
        }]),
      })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const hosts = await loadSavedHostsAsync()

    expect(storeDeviceCredential).toHaveBeenCalledWith('legacy-host', 'durable-secret')
    expect(preferences.set).toHaveBeenCalledTimes(1)
    expect(preferences.set.mock.calls[0][0].value).not.toContain('durable-secret')
    expect(preferences.remove).toHaveBeenCalledWith({ key: 'claude-terminal-saved-hosts' })
    expect(log.mock.calls.flat().join(' ')).not.toContain('durable-secret')
    expect(hosts).toEqual([expect.objectContaining({
      id: 'legacy-host',
      credentialRef: 'legacy-host',
    })])
    expect(hosts[0]).not.toHaveProperty('token')
    log.mockRestore()
  })
})