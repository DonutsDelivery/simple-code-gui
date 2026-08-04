import { afterEach, describe, expect, it } from 'vitest'
import { createServerProtocolDescriptor } from '../../common/server-protocol'
import { clearApi, getApi, getConnectedServerIds, setApi, type Api } from '../api'

function api(serverId: string): Api {
  return {
    getServerProtocol: () => createServerProtocolDescriptor('test', serverId),
  } as unknown as Api
}

describe('renderer API registry', () => {
  afterEach(() => {
    for (const serverId of getConnectedServerIds()) clearApi(serverId)
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
})
