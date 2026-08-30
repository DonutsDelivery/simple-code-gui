import { describe, expect, it, vi } from 'vitest'
import type { CommandEnvelope } from '../../common/server-protocol'
import { EnvironmentEventLog } from '../environment-event-log'
import {
  EnvironmentCommandConflictError,
  EnvironmentCommandRouter,
  EnvironmentRevisionConflictError,
  type EnvironmentCommand,
  type EnvironmentPersistenceData,
} from '../environment-command-router'
import { EnvironmentState } from '../environment-state'
import type { Workspace } from '../session-store'

function makeWorkspace(): Workspace {
  return {
    projects: [{ path: '/repo', name: 'Repo', harnessId: 'hermes' }],
    sessions: [{ id: 'workspace-1', name: 'Workspace 1', openTabs: [], activeTabId: null }],
    activeSessionId: 'workspace-1',
  }
}

function envelope(
  commandId: string,
  expectedRevision: number,
  command: EnvironmentCommand,
  clientId = 'client-a',
): CommandEnvelope<EnvironmentCommand> {
  return { commandId, clientId, serverId: 'server-a', expectedRevision, command }
}

function createRouter(persist: (data: EnvironmentPersistenceData) => void = vi.fn()) {
  const state = new EnvironmentState('server-a', makeWorkspace())
  const eventLog = new EnvironmentEventLog<Workspace>('server-a')
  return { state, eventLog, persist, router: new EnvironmentCommandRouter(state, eventLog, { persist }) }
}

describe('EnvironmentCommandRouter', () => {
  it('serializes two clients onto one revision and exposes catch-up events', () => {
    const { router } = createRouter()
    const clientASnapshot = router.getSnapshot()
    const clientBSnapshot = router.getSnapshot()

    const result = router.execute(envelope('create-tile', clientASnapshot.revision, {
      type: 'create-tile',
      workspaceId: 'workspace-1',
      tile: { type: 'leaf', id: 'tile-1', tabIds: [], activeTabId: '' },
    }))

    expect(result.revision).toBe(1)
    expect(router.getSnapshot().workspace.sessions?.[0].tileTree).toMatchObject({ id: 'tile-1' })
    const catchUp = router.getEventsAfter(clientBSnapshot.revision)
    expect(catchUp.mode).toBe('events')
    expect(catchUp.events).toEqual([expect.objectContaining({ revision: 1, event: expect.objectContaining({ commandId: 'create-tile' }) })])
    expect(catchUp.events?.[0].event.snapshot).toEqual(router.getSnapshot())
  })

  it('replays a retried command without duplicating the mutation or event', () => {
    const { router, persist } = createRouter()
    const command = envelope('create-workspace', 0, {
      type: 'create-workspace',
      workspace: { id: 'workspace-2', name: 'Workspace 2', openTabs: [], activeTabId: null },
    })

    const first = router.execute(command)
    const retry = router.execute(command)

    expect(first).toMatchObject({ revision: 1, replayed: false })
    expect(retry).toMatchObject({ revision: 1, replayed: true })
    expect(router.getSnapshot().workspace.sessions?.filter(session => session.id === 'workspace-2')).toHaveLength(1)
    expect(router.getEventsAfter(0).events).toHaveLength(1)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('preserves canonical native session identity when a stale frontend attempts to overwrite it', () => {
    const { router } = createRouter()
    const authoritative = makeWorkspace()
    authoritative.sessions![0].openTabs = [{
      id: 'tab-a',
      projectPath: '/repo',
      title: 'Hermes',
      ptyId: 'pty-a',
      agentSessionId: 'agent-a',
      sessionId: '20260820_104135_167ab5',
      harnessId: 'hermes',
    }]
    router.execute(envelope('seed-identity', 0, { type: 'replace-workspace', workspace: authoritative }))

    const stale = structuredClone(authoritative)
    stale.sessions![0].openTabs[0].sessionId = 'wrong-native-session'
    stale.sessions![0].openTabs[0].harnessId = 'claude'
    stale.sessions![0].openTabs[0].ptyId = 'pty-new'
    router.execute(envelope('stale-projection', 1, { type: 'replace-workspace', workspace: stale }, 'client-b'))

    expect(router.getSnapshot().workspace.sessions![0].openTabs[0]).toMatchObject({
      ptyId: 'pty-new',
      agentSessionId: 'agent-a',
      sessionId: '20260820_104135_167ab5',
      harnessId: 'hermes',
    })
  })

  it('rejects stale writes with the current revision and snapshot', () => {
    const { router } = createRouter()
    router.execute(envelope('rename-a', 0, { type: 'rename-workspace', workspaceId: 'workspace-1', name: 'Renamed' }))

    expect(() => router.execute(envelope(
      'stale-delete',
      0,
      { type: 'delete-workspace', workspaceId: 'workspace-1' },
      'client-b',
    ))).toThrow(EnvironmentRevisionConflictError)

    try {
      router.execute(envelope('stale-again', 0, { type: 'delete-workspace', workspaceId: 'workspace-1' }, 'client-b'))
    } catch (error) {
      expect(error).toMatchObject({ code: 'REVISION_CONFLICT', expectedRevision: 0, currentRevision: 1 })
      expect((error as EnvironmentRevisionConflictError).snapshot.workspace.sessions?.[0].name).toBe('Renamed')
    }
  })

  it('rejects reuse of a command ID with a different request', () => {
    const { router } = createRouter()
    router.execute(envelope('same-id', 0, { type: 'rename-workspace', workspaceId: 'workspace-1', name: 'First' }))

    expect(() => router.execute(envelope(
      'same-id',
      1,
      { type: 'rename-workspace', workspaceId: 'workspace-1', name: 'Second' },
    ))).toThrow(EnvironmentCommandConflictError)
  })

  it('persists the snapshot, event, and receipt together and replays after restart', () => {
    let saved: EnvironmentPersistenceData | undefined
    const firstState = new EnvironmentState('server-a', makeWorkspace())
    const firstLog = new EnvironmentEventLog<Workspace>('server-a')
    const first = new EnvironmentCommandRouter(firstState, firstLog, { persist: data => { saved = structuredClone(data) } })
    const command = envelope('durable', 0, { type: 'update-project', projectPath: '/repo', updates: { name: 'Updated' } })
    first.execute(command)

    const restartedState = new EnvironmentState('server-a', makeWorkspace(), saved!.snapshot)
    const restartedLog = new EnvironmentEventLog<Workspace>('server-a', saved!.events)
    const restarted = new EnvironmentCommandRouter(restartedState, restartedLog, { receipts: saved!.receipts })

    expect(restarted.execute(command)).toMatchObject({ revision: 1, replayed: true })
    expect(restarted.getSnapshot().workspace.projects[0].name).toBe('Updated')
  })

  it('rolls back state, event, and receipt if atomic persistence fails', () => {
    const { router } = createRouter(() => { throw new Error('disk full') })

    expect(() => router.execute(envelope(
      'failing-command',
      0,
      { type: 'rename-workspace', workspaceId: 'workspace-1', name: 'Should roll back' },
    ))).toThrow('disk full')
    expect(router.getSnapshot()).toMatchObject({ revision: 0, workspace: { sessions: [expect.objectContaining({ name: 'Workspace 1' })] } })
    expect(router.getEventsAfter(0).events).toEqual([])
    expect(router.getReceipts()).toEqual([])
  })
})
