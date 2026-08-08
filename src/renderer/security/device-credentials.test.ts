import { beforeEach, describe, expect, it, vi } from 'vitest'

const { secureStorage, capacitor } = vi.hoisted(() => ({
  secureStorage: {
    set: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
  },
  capacitor: { isNativePlatform: vi.fn(() => true) },
}))

vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }))
vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: secureStorage }))

import { loadDeviceCredential, removeDeviceCredential, storeDeviceCredential } from './device-credentials'

describe('native device credentials', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores pairing credentials in native secure storage, not localStorage', async () => {
    const localSet = vi.spyOn(Storage.prototype, 'setItem')
    await storeDeviceCredential('server-a', 'token-secret')
    expect(secureStorage.set).toHaveBeenCalledWith('donutcode-device-credential:server-a', 'token-secret')
    expect(localSet).not.toHaveBeenCalled()
  })

  it('loads and removes credentials through the native secure-storage plugin', async () => {
    secureStorage.get.mockResolvedValue('token-secret')
    await expect(loadDeviceCredential('server-a')).resolves.toBe('token-secret')
    await removeDeviceCredential('server-a')
    expect(secureStorage.remove).toHaveBeenCalledWith('donutcode-device-credential:server-a')
  })
})
