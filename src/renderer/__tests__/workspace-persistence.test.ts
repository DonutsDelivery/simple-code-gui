import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  EnvironmentCacheInvalidatedError,
  cacheEnvironmentSnapshot,
  consumeAuthoritativeSaveSuppression,
  getBaselineFingerprint,
  recordAuthoritativeBaseline,
  getEnvironmentCursor,
  loadAuthoritativeWorkspace,
  markAuthoritativeSaveSuppressed,
  resetEnvironmentPersistenceForTests,
  resolveAuthoritativeEnvironmentEvent,
  saveAuthoritativeWorkspace,
  serializeSessionsForSave,
} from '../stores/workspace-persistence'
import type { WorkspaceSession } from '../stores/workspace'
import { createEmptyCanvasScene } from '../components/canvas'
import type { Api, Workspace } from '../api/types'

const tab = (overrides: Partial<any> = {}) => ({
  serverId: 'server-a',
  id: 'pty-1',
  projectPath: '/proj/a',
  sessionId: 'sess-1',
  title: 'a - main',
  customTitle: false,
  ptyId: 'pty-1',
  backend: 'claude' as const,
  ...overrides,
})

beforeEach(() => resetEnvironmentPersistenceForTests())

describe('serializeSessionsForSave', () => {
  // AC: @layout/multi-workspace-persistence ac-1
  it('preserves savedData for inactive (unrestored) workspaces', () => {
    const sessions: WorkspaceSession[] = [
      {
        serverId: 'server-a', authoritySessionId: 'ws-active',
        id: 'ws-active',
        name: 'Workspace 1',
        openTabs: [tab()],
        activeTabId: 'pty-1',
        activeTileTree: { kind: 'leaf', id: 't1', tabIds: ['pty-1'], activeTabId: 'pty-1' } as any,
        canvasScene: createEmptyCanvasScene(),
        activeView: 'tiles',
        isRestored: true,
      },
      {
        serverId: 'server-a', authoritySessionId: 'ws-inactive',
        id: 'ws-inactive',
        name: 'Workspace 2',
        openTabs: [],
        activeTabId: null,
        activeTileTree: null,
        canvasScene: createEmptyCanvasScene(),
        activeView: 'tiles',
        savedData: {
          openTabs: [
            { serverId: 'server-a', id: 'saved-1', projectPath: '/proj/b', sessionId: 'sess-9', title: 'b', ptyId: 'saved-1' },
          ],
          tileTree: { kind: 'leaf', id: 'saved-tile', tabIds: ['saved-1'], activeTabId: 'saved-1' },
          canvasScene: { version: 99, future: true },
          activeView: 'canvas',
          activeTabId: 'saved-1',
        },
        isRestored: false,
      },
    ]

    const result = serializeSessionsForSave(sessions, 'server-a')

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('ws-active')
    expect(result[0].openTabs).toHaveLength(1)
    expect(result[0].activeTabId).toBe('pty-1')

    // The unrestored workspace must round-trip its savedData, NOT flush to empty.
    expect(result[1].id).toBe('ws-inactive')
    expect(result[1].openTabs).toHaveLength(1)
    expect(result[1].openTabs[0].projectPath).toBe('/proj/b')
    expect(result[1].activeTabId).toBe('saved-1')
    expect(result[1].tileTree).toMatchObject({ kind: 'leaf', id: 'saved-tile' })
    expect(result[1].canvasScene).toEqual({ version: 99, future: true })
    expect(result[1].activeView).toBe('canvas')
  })

  it('serializes restored workspaces from live state', () => {
    const sessions: WorkspaceSession[] = [
      {
        serverId: 'server-a', authoritySessionId: 'ws-1',
        id: 'ws-1',
        name: 'Workspace 1',
        openTabs: [tab({ id: 'server-a\0live-1', authorityTabId: 'live-1', ptyId: 'live-1', agentSessionId: 'agent-1', projectPath: '/proj/x' })],
        activeTabId: 'live-1',
        activeTileTree: null,
        canvasScene: createEmptyCanvasScene(),
        activeView: 'tiles',
        isRestored: true,
      },
    ]

    const result = serializeSessionsForSave(sessions, 'server-a')

    expect(result[0].openTabs).toHaveLength(1)
    expect(result[0].openTabs[0].projectPath).toBe('/proj/x')
    expect(result[0].openTabs[0].ptyId).toBe('live-1')
    expect(result[0].openTabs[0].agentSessionId).toBe('agent-1')
    expect(result[0].openTabs[0].id).toBe('live-1')
  })

  it('falls back to empty when an unrestored session has no savedData', () => {
    const sessions: WorkspaceSession[] = [
      {
        serverId: 'server-a', authoritySessionId: 'ws-empty',
        id: 'ws-empty',
        name: 'Empty',
        openTabs: [],
        activeTabId: null,
        activeTileTree: null,
        canvasScene: createEmptyCanvasScene(),
        activeView: 'tiles',
        isRestored: false,
      },
    ]

    const result = serializeSessionsForSave(sessions, 'server-a')

    expect(result[0].openTabs).toEqual([])
    expect(result[0].activeTabId).toBeNull()
    expect(result[0].tileTree).toBeUndefined()
  })

  // AC: @canvas-workspace ac-2
  // AC: @canvas-scene-persistence ac-1
  // AC: @canvas-content-objects ac-3
  it('serializes independent live Canvas view state', () => {
    const canvasScene = createEmptyCanvasScene()
    canvasScene.camera = { x: -320, y: 180, zoom: 0.72 }
    canvasScene.objects.push({
      id: 'note-a',
      kind: 'text',
      text: 'Persist me',
      rect: { x: 10, y: 20, width: 240, height: 160 },
      zIndex: 1,
    })
    const sessions: WorkspaceSession[] = [{
      serverId: 'server-a', authoritySessionId: 'ws-canvas',
      id: 'ws-canvas',
      name: 'Canvas',
      openTabs: [tab()],
      activeTabId: 'pty-1',
      activeTileTree: null,
      canvasScene,
      activeView: 'canvas',
      isRestored: true,
    }]

    const result = serializeSessionsForSave(sessions, 'server-a')

    expect(result[0].activeView).toBe('canvas')
    expect(result[0].canvasScene).toMatchObject({
      version: 2,
      camera: { x: -320, y: 180, zoom: 0.72 },
      objects: [canvasScene.objects[0]],
    })
    expect(result[0].tileTree).toBeUndefined()
  })

  it('strips falsy customTitle from live tabs', () => {
    const sessions: WorkspaceSession[] = [
      {
        serverId: 'server-a', authoritySessionId: 'ws-1',
        id: 'ws-1',
        name: 'Workspace 1',
        openTabs: [tab({ customTitle: false })],
        activeTabId: 'pty-1',
        activeTileTree: null,
        canvasScene: createEmptyCanvasScene(),
        activeView: 'tiles',
        isRestored: true,
      },
    ]

    const result = serializeSessionsForSave(sessions, 'server-a')
    expect((result[0].openTabs[0] as any).customTitle).toBeUndefined()
  })
})

describe('authoritative workspace persistence', () => {
  const workspace: Workspace = { projects: [], categories: [], sessions: [], activeSessionId: null }
  const identifiedApi = (serverId: string, implementation: object): Api => ({
    getServerProtocol: () => ({ serverId }) as any,
    ...implementation,
  }) as unknown as Api

  it('serializes local saves using the revision returned by the prior command', async () => {
    let revision = 0
    const executeEnvironmentCommand = vi.fn(async () => ({
      serverId: 'server-a',
      revision: ++revision,
      result: { success: true },
      replayed: false,
    }))
    const api = identifiedApi('server-a', {
      getEnvironmentSnapshot: vi.fn(async () => ({ serverId: 'server-a', revision: 0, workspace, sessions: [], ptys: [] })),
      executeEnvironmentCommand,
    })

    await Promise.all([
      saveAuthoritativeWorkspace(api, 'server-a', workspace),
      saveAuthoritativeWorkspace(api, 'server-a', workspace),
    ])

    expect(executeEnvironmentCommand.mock.calls.map(([command]) => command.expectedRevision)).toEqual([0, 1])
    expect(getEnvironmentCursor('server-a')).toEqual({ serverId: 'server-a', revision: 2 })
  })

  it('does not replay a stale full-workspace payload over a newer snapshot', async () => {
    const getEnvironmentSnapshot = vi.fn()
      .mockResolvedValueOnce({ serverId: 'server-a', revision: 4, workspace, sessions: [], ptys: [] })
      .mockResolvedValueOnce({ serverId: 'server-a', revision: 5, workspace, sessions: [], ptys: [] })
    const executeEnvironmentCommand = vi.fn().mockRejectedValue(new Error('Expected revision 4, current revision is 5'))
    const api = identifiedApi('server-a', { getEnvironmentSnapshot, executeEnvironmentCommand })

    await expect(saveAuthoritativeWorkspace(api, 'server-a', workspace)).rejects.toThrow('current revision is 5')

    expect(executeEnvironmentCommand).toHaveBeenCalledTimes(1)
    expect(getEnvironmentCursor('server-a')).toEqual({ serverId: 'server-a', revision: 5 })
  })

  it('retries once when a revision conflict came from runtime-registry commits (workspace content unchanged)', async () => {
    // Baseline recorded from a prior successful save at revision 4.
    cacheEnvironmentSnapshot({ serverId: 'server-a', revision: 4, workspace, sessions: [], ptys: [] })
    recordAuthoritativeBaseline('server-a', workspace)

    // First command attempt conflicts: the server's runtime registry advanced
    // the revision (create/attach-session) without changing workspace content.
    const getEnvironmentSnapshot = vi.fn()
      .mockResolvedValueOnce({ serverId: 'server-a', revision: 6, workspace, sessions: [], ptys: [] })
    const executeEnvironmentCommand = vi.fn()
      .mockRejectedValueOnce(new Error('Expected environment revision 4, current revision is 6'))
      .mockResolvedValueOnce({ serverId: 'server-a', revision: 7, replayed: false, events: [] })
    const api = identifiedApi('server-a', { getEnvironmentSnapshot, executeEnvironmentCommand })

    await expect(saveAuthoritativeWorkspace(api, 'server-a', workspace)).resolves.toBeUndefined()

    expect(executeEnvironmentCommand).toHaveBeenCalledTimes(2)
    // Second attempt must carry the refreshed cursor.
    expect(executeEnvironmentCommand.mock.calls[1][0].expectedRevision).toBe(6)
    expect(getEnvironmentCursor('server-a')).toEqual({ serverId: 'server-a', revision: 7 })
  })

  it('applies the next broadcast snapshot and catches up across an event gap', async () => {
    const revisionOne = { serverId: 'server-a', revision: 1, workspace: { ...workspace, activeSessionId: 'one' }, sessions: [], ptys: [] }
    const revisionThree = { serverId: 'server-a', revision: 3, workspace: { ...workspace, activeSessionId: 'three' }, sessions: [], ptys: [] }
    cacheEnvironmentSnapshot({ serverId: 'server-a', revision: 0, workspace, sessions: [], ptys: [] })
    const getEnvironmentEvents = vi.fn(async () => ({
      mode: 'events' as const,
      afterRevision: 1,
      currentRevision: 3,
      events: [{
        serverId: 'server-a', revision: 3, eventId: 'server-a:3', occurredAt: 3,
        event: { type: 'replace-workspace', clientId: 'client-b', commandId: 'three', result: {}, snapshot: revisionThree },
      }],
    }))
    const api = identifiedApi('server-a', { getEnvironmentEvents })

    await expect(resolveAuthoritativeEnvironmentEvent(api, 'server-a', {
      serverId: 'server-a', revision: 1, eventId: 'server-a:1', occurredAt: 1,
      event: { type: 'replace-workspace', clientId: 'client-b', commandId: 'one', result: {}, snapshot: revisionOne },
    })).resolves.toEqual(revisionOne)
    await expect(resolveAuthoritativeEnvironmentEvent(api, 'server-a', {
      serverId: 'server-a', revision: 3, eventId: 'server-a:3', occurredAt: 3,
      event: { type: 'replace-workspace', clientId: 'client-b', commandId: 'three', result: {}, snapshot: revisionThree },
    })).resolves.toEqual(revisionThree)

    expect(getEnvironmentEvents).toHaveBeenCalledWith(1)
    expect(getEnvironmentCursor('server-a')).toEqual({ serverId: 'server-a', revision: 3 })
  })

  it('cancels a queued full-workspace save when another client advances authority', async () => {
    let rejectFirst!: (reason: Error) => void
    const executeEnvironmentCommand = vi.fn(() => new Promise((_resolve, reject) => { rejectFirst = reject }))
    const api = identifiedApi('server-a', {
      getEnvironmentSnapshot: vi.fn(async () => ({ serverId: 'server-a', revision: 0, workspace, sessions: [], ptys: [] })),
      executeEnvironmentCommand,
    })
    cacheEnvironmentSnapshot(await api.getEnvironmentSnapshot!())

    const first = saveAuthoritativeWorkspace(api, 'server-a', workspace)
    await vi.waitFor(() => expect(executeEnvironmentCommand).toHaveBeenCalledTimes(1))
    const queued = saveAuthoritativeWorkspace(api, 'server-a', { ...workspace, activeSessionId: 'stale-local' })
    await resolveAuthoritativeEnvironmentEvent(api, 'server-a', {
      serverId: 'server-a', revision: 1, eventId: 'server-a:1', occurredAt: 1,
      event: {
        type: 'replace-workspace', clientId: 'client-b', commandId: 'remote', result: {},
        snapshot: { serverId: 'server-a', revision: 1, workspace: { ...workspace, activeSessionId: 'remote' }, sessions: [], ptys: [] },
      },
    })
    rejectFirst(new Error('revision conflict'))

    await expect(first).rejects.toThrow('revision conflict')
    await expect(queued).rejects.toBeInstanceOf(EnvironmentCacheInvalidatedError)
    expect(executeEnvironmentCommand).toHaveBeenCalledTimes(1)
  })

  it('keeps revisions and save queues isolated between simultaneous servers', async () => {
    let resolveServerA!: (response: any) => void
    const executeServerA = vi.fn(() => new Promise(resolve => { resolveServerA = resolve }))
    const executeServerB = vi.fn().mockResolvedValue({
      serverId: 'server-b', revision: 8, result: { success: true }, replayed: false,
    })
    const apiA = identifiedApi('server-a', {
      getEnvironmentSnapshot: vi.fn().mockResolvedValue({ serverId: 'server-a', revision: 2, workspace, sessions: [], ptys: [] }),
      executeEnvironmentCommand: executeServerA,
    })
    const apiB = identifiedApi('server-b', {
      getEnvironmentSnapshot: vi.fn().mockResolvedValue({ serverId: 'server-b', revision: 7, workspace, sessions: [], ptys: [] }),
      executeEnvironmentCommand: executeServerB,
    })

    const saveA = saveAuthoritativeWorkspace(apiA, 'server-a', workspace)
    await vi.waitFor(() => expect(executeServerA).toHaveBeenCalledTimes(1))
    const saveB = saveAuthoritativeWorkspace(apiB, 'server-b', workspace)
    await expect(saveB).resolves.toBeUndefined()

    expect(executeServerA.mock.calls[0][0]).toMatchObject({ serverId: 'server-a', expectedRevision: 2 })
    expect(executeServerB.mock.calls[0][0]).toMatchObject({ serverId: 'server-b', expectedRevision: 7 })
    expect(getEnvironmentCursor('server-b')).toEqual({ serverId: 'server-b', revision: 8 })

    resolveServerA({ serverId: 'server-a', revision: 3, result: { success: true }, replayed: false })
    await expect(saveA).resolves.toBeUndefined()
    expect(getEnvironmentCursor('server-a')).toEqual({ serverId: 'server-a', revision: 3 })
  })

  it('rejects an API that presents a different server identity', async () => {
    const wrongApi = identifiedApi('server-b', {
      getEnvironmentSnapshot: vi.fn().mockResolvedValue({ serverId: 'server-b', revision: 0, workspace, sessions: [], ptys: [] }),
    })
    expect(() => saveAuthoritativeWorkspace(wrongApi, 'server-a', workspace))
      .toThrow('expected server-a')
  })

  it('scopes authoritative-save suppression per server', () => {
    // An authoritative apply for server-a must not suppress a genuine state
    // change for server-b (multi-server: pairing/attach applies each server's
    // snapshot independently, while the save effect iterates every server).
    markAuthoritativeSaveSuppressed('server-a')
    expect(consumeAuthoritativeSaveSuppression('server-a')).toBe(true)
    expect(consumeAuthoritativeSaveSuppression('server-a')).toBe(false)

    markAuthoritativeSaveSuppressed('server-a')
    expect(consumeAuthoritativeSaveSuppression('server-b')).toBe(false)
    // server-a's pending suppression survives a probe of server-b.
    expect(consumeAuthoritativeSaveSuppression('server-a')).toBe(true)
  })

  it('records a baseline fingerprint on authoritative apply and save', async () => {
    const getEnvironmentSnapshot = vi.fn().mockResolvedValue({ serverId: 'server-a', revision: 0, workspace, sessions: [], ptys: [] })
    const api = identifiedApi('server-a', { getEnvironmentSnapshot })

    const loaded = await loadAuthoritativeWorkspace(api, 'server-a')
    expect(getBaselineFingerprint('server-a')).toBe(JSON.stringify({
      projects: loaded.projects ?? [],
      categories: loaded.categories ?? [],
      sessions: loaded.sessions ?? [],
      activeSessionId: loaded.activeSessionId ?? null,
    }))

    const executeEnvironmentCommand = vi.fn().mockResolvedValue({ serverId: 'server-a', revision: 1, result: { success: true }, replayed: false })
    const api2 = identifiedApi('server-a', { getEnvironmentSnapshot, executeEnvironmentCommand })
    await saveAuthoritativeWorkspace(api2, 'server-a', workspace)
    expect(getBaselineFingerprint('server-a')).toBe(JSON.stringify({
      projects: workspace.projects ?? [],
      categories: workspace.categories ?? [],
      sessions: workspace.sessions ?? [],
      activeSessionId: workspace.activeSessionId ?? null,
    }))
  })

  it('keeps a per-server baseline when another server applies', async () => {
    const getEnvironmentSnapshot = vi.fn().mockResolvedValue({ serverId: 'server-a', revision: 0, workspace, sessions: [], ptys: [] })
    const api = identifiedApi('server-a', { getEnvironmentSnapshot })
    await loadAuthoritativeWorkspace(api, 'server-a')
    const baselineA = getBaselineFingerprint('server-a')

    const getEnvironmentSnapshotB = vi.fn().mockResolvedValue({ serverId: 'server-b', revision: 0, workspace, sessions: [], ptys: [] })
    const apiB = identifiedApi('server-b', { getEnvironmentSnapshot: getEnvironmentSnapshotB })
    await loadAuthoritativeWorkspace(apiB, 'server-b')

    expect(getBaselineFingerprint('server-a')).toBe(baselineA)
    expect(getBaselineFingerprint('server-b')).toBe(JSON.stringify({
      projects: workspace.projects ?? [],
      categories: workspace.categories ?? [],
      sessions: workspace.sessions ?? [],
      activeSessionId: workspace.activeSessionId ?? null,
    }))
  })
})
