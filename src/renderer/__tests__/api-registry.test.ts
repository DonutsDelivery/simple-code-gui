import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServerProtocolDescriptor } from '../../common/server-protocol'
import { clearApi, getApi, getConnectedServerIds, initializeApi, setApi, type Api } from '../api'
import { HttpBackend } from '../api/http-backend'
import { ElectronBackend } from '../api/electron-backend'

function api(serverId: string): Api {
  return {
    getServerProtocol: () => createServerProtocolDescriptor('test', serverId),
  } as unknown as Api
}

describe('renderer API registry', () => {
  afterEach(() => {
    for (const serverId of getConnectedServerIds()) clearApi(serverId)
    vi.unstubAllGlobals()
  })

  it('routes only by explicit immutable server ID', () => {
    const first = api('server-a')
    const second = api('server-b')
    setApi(first)
    setApi(second)

    expect(getApi('server-a')).toBe(first)
    expect(getApi('server-b')).toBe(second)
    expect(getApi('missing')).toBeNull()
  })

  it('rejects APIs that have not established server identity', () => {
    expect(() => setApi({} as Api)).toThrow('stable server ID')
  })

  it('uses HttpBackend for remote config even when Electron is available', () => {
    vi.stubGlobal('window', {
      electronAPI: {
        getWorkspace: vi.fn(),
      },
    })

    const backend = initializeApi({ host: '10.0.0.5', port: 38470, token: 'device-token', secure: true })
    expect(backend).toBeInstanceOf(HttpBackend)
    expect(backend).not.toBeInstanceOf(ElectronBackend)
  })
})
