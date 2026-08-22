import { describe, expect, it } from 'vitest'
import { getPtyRecreationTabIds } from './useApiListeners'

describe('getPtyRecreationTabIds', () => {
  it('matches a canonical tab by its raw PTY id and returns server-scoped renderer ids', () => {
    const result = getPtyRecreationTabIds('local', {
      serverId: 'local',
      id: 'local\0old-pty',
      authorityTabId: 'old-pty',
      ptyId: 'old-pty',
    }, 'old-pty', 'new-pty')

    expect(result).toEqual({
      oldRendererId: 'local\0old-pty',
      newRendererId: 'local\0new-pty',
    })
  })

  it('does not match the same PTY id from another server', () => {
    expect(getPtyRecreationTabIds('local', {
      serverId: 'remote',
      id: 'remote\0old-pty',
      authorityTabId: 'old-pty',
      ptyId: 'old-pty',
    }, 'old-pty', 'new-pty')).toBeNull()
  })
})
