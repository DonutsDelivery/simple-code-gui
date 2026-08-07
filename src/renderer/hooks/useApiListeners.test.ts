import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useApiListeners } from './useApiListeners'
import { useWorkspaceStore } from '../stores/workspace'
import type { Api } from '../api'

// The pty-recreated listener enumerates all connected servers via the api
// registry; mock it so tests can exercise multi-server subscriptions.
const apiRegistry: { ids: string[]; get: (serverId: string) => Api | null } = {
  ids: [],
  get: () => null,
}
vi.mock('../api', () => ({
  getApi: (serverId: string) => apiRegistry.get(serverId),
  getConnectedServerIds: () => apiRegistry.ids,
}))

const SERVER_ID = 'server-1'
const RAW_OLD_PTY = 'old-raw-pty-id'
const RAW_NEW_PTY = 'new-raw-pty-id'
const COMPOSITE_TAB_ID = `${SERVER_ID}\u0000${RAW_OLD_PTY}`

function makeApi(overrides: Partial<Api> = {}): Api {
  return {
    onPtyRecreated: vi.fn(() => () => {}),
    onApiOpenSession: vi.fn(() => () => {}),
    onOrchestratorSessionCreated: vi.fn(() => () => {}),
    ...overrides,
  } as unknown as Api
}

describe('useApiListeners pty recreated', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      openTabs: [],
      activeTabId: null,
      tileTree: null,
      setTileTree: vi.fn(),
      setActiveTab: vi.fn(),
    })
  })

  it('re-points the tab when the event carries the raw server pty id', () => {
    // Tab id is the composite `${serverId}\0${ptyId}`; the recreated event
    // carries the raw pty id. This is the multi-server id scheme.
    useWorkspaceStore.setState({
      openTabs: [
        {
          serverId: SERVER_ID,
          id: COMPOSITE_TAB_ID,
          ptyId: RAW_OLD_PTY,
          projectPath: '/repo',
          title: 'repo',
        },
      ],
      activeTabId: COMPOSITE_TAB_ID,
    })
    const updateTab = vi.fn()
    const setActiveTab = vi.fn()

    let callback: ((e: { oldId: string; newId: string; backend: string; sessionId?: string }) => void) | null = null
    const api = makeApi({
      onPtyRecreated: vi.fn((cb: typeof callback) => {
        callback = cb
        return () => {}
      }),
    })

    renderHook(() => useApiListeners({
      api,
      serverId: SERVER_ID,
      projects: [],
      settings: null,
      addTab: vi.fn(),
      updateTab,
      setActiveTab,
      setTileTree: vi.fn(),
      tileTree: null,
      openTabs: useWorkspaceStore.getState().openTabs,
    }))

    callback!({ oldId: RAW_OLD_PTY, newId: RAW_NEW_PTY, backend: 'hermes' })

    // The tab whose raw ptyId matched gets re-pointed: composite renderer id
    // rebuilt around the new pty id, raw pty identity updated.
    const NEW_COMPOSITE = `${SERVER_ID}\u0000${RAW_NEW_PTY}`
    expect(updateTab).toHaveBeenCalledWith(COMPOSITE_TAB_ID, {
      id: NEW_COMPOSITE,
      ptyId: RAW_NEW_PTY,
      authorityTabId: RAW_NEW_PTY,
      backend: 'hermes',
      sessionId: undefined,
    })
    expect(setActiveTab).toHaveBeenCalledWith(NEW_COMPOSITE)
  })

  it('re-points API-created tabs that use the raw pty id', () => {
    useWorkspaceStore.setState({
      openTabs: [
        {
          serverId: SERVER_ID,
          id: RAW_OLD_PTY,
          ptyId: RAW_OLD_PTY,
          projectPath: '/repo',
          title: 'repo',
        },
      ],
      activeTabId: RAW_OLD_PTY,
    })
    const updateTab = vi.fn()
    const setActiveTab = vi.fn()

    let callback: ((e: { oldId: string; newId: string; backend: string; sessionId?: string }) => void) | null = null
    const api = makeApi({
      onPtyRecreated: vi.fn((cb: typeof callback) => {
        callback = cb
        return () => {}
      }),
    })

    renderHook(() => useApiListeners({
      api,
      serverId: SERVER_ID,
      projects: [],
      settings: null,
      addTab: vi.fn(),
      updateTab,
      setActiveTab,
      setTileTree: vi.fn(),
      tileTree: null,
      openTabs: useWorkspaceStore.getState().openTabs,
    }))

    callback!({ oldId: RAW_OLD_PTY, newId: RAW_NEW_PTY, backend: 'codex' })

    expect(updateTab).toHaveBeenCalledWith(RAW_OLD_PTY, {
      id: RAW_NEW_PTY,
      ptyId: RAW_NEW_PTY,
      authorityTabId: RAW_NEW_PTY,
      backend: 'codex',
      sessionId: undefined,
    })
    expect(setActiveTab).toHaveBeenCalledWith(RAW_NEW_PTY)
  })

  it('subscribes pty recreated on every connected server, not just the active one', () => {
    const REMOTE_PTY = 'remote-pty'
    const NEW_REMOTE_PTY = 'remote-pty-2'
    const REMOTE_SERVER = 'server-2'
    useWorkspaceStore.setState({
      openTabs: [
        {
          serverId: REMOTE_SERVER,
          id: `${REMOTE_SERVER}\u0000${REMOTE_PTY}`,
          ptyId: REMOTE_PTY,
          projectPath: '/remote',
          title: 'remote',
        },
      ],
      activeTabId: null,
    })
    const updateTab = vi.fn()

    let remoteCallback: ((e: { oldId: string; newId: string; backend: string; sessionId?: string }) => void) | null = null
    const remoteApi = makeApi({
      onPtyRecreated: vi.fn((cb: typeof remoteCallback) => {
        remoteCallback = cb
        return () => {}
      }),
    })
    const activeApi = makeApi()
    apiRegistry.ids = [SERVER_ID, REMOTE_SERVER]
    apiRegistry.get = (serverId: string) => (serverId === REMOTE_SERVER ? remoteApi : activeApi)

    renderHook(() => useApiListeners({
      api: activeApi,
      serverId: SERVER_ID,
      projects: [],
      settings: null,
      addTab: vi.fn(),
      updateTab,
      setActiveTab: vi.fn(),
      setTileTree: vi.fn(),
      tileTree: null,
      openTabs: useWorkspaceStore.getState().openTabs,
    }))

    // A switch on the REMOTE server (not the active one) must still re-point the tab.
    remoteCallback!({ oldId: REMOTE_PTY, newId: NEW_REMOTE_PTY, backend: 'hermes' })
    expect(updateTab).toHaveBeenCalledWith(`${REMOTE_SERVER}\u0000${REMOTE_PTY}`, expect.objectContaining({
      id: `${REMOTE_SERVER}\u0000${NEW_REMOTE_PTY}`,
      ptyId: NEW_REMOTE_PTY,
      backend: 'hermes',
    }))
  })
})
