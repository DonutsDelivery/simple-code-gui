import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore, type WorkspaceSession } from '../stores/workspace'

const session = (serverId: string, name: string): WorkspaceSession => ({
  serverId,
  authoritySessionId: name,
  id: `${serverId}\0${name}`,
  name,
  openTabs: [],
  activeTabId: null,
  activeTileTree: null,
  canvasScene: null,
  activeView: 'tiles',
  isRestored: true,
})

beforeEach(() => {
  useWorkspaceStore.setState({
    projects: [],
    categories: [],
    sessions: [],
    activeSessionId: null,
    openTabs: [],
    activeTabId: null,
    activeTileTree: null,
    activeCanvasScene: null,
    activeView: 'tiles',
    attentionByTabId: {},
  })
})

describe('ensureSessionForServer', () => {
  it('keeps the active session when it already belongs to the target server', () => {
    const local = session('server-a', 'workspace-a')
    useWorkspaceStore.setState({ sessions: [local], activeSessionId: local.id, openTabs: local.openTabs })

    const id = useWorkspaceStore.getState().ensureSessionForServer('server-a')
    expect(id).toBe(local.id)
    expect(useWorkspaceStore.getState().sessions).toHaveLength(1)
  })

  it('switches to an existing session owned by the target server', () => {
    const local = session('server-a', 'workspace-a')
    const remote = session('server-b', 'workspace-b')
    useWorkspaceStore.setState({ sessions: [local, remote], activeSessionId: local.id, openTabs: local.openTabs })

    const id = useWorkspaceStore.getState().ensureSessionForServer('server-b')
    expect(id).toBe(remote.id)
    expect(useWorkspaceStore.getState().activeSessionId).toBe(remote.id)
    expect(useWorkspaceStore.getState().sessions).toHaveLength(2)
  })

  it('creates a session owned by the target server when none exists', () => {
    const local = session('server-a', 'workspace-a')
    useWorkspaceStore.setState({ sessions: [local], activeSessionId: local.id, openTabs: local.openTabs })

    const id = useWorkspaceStore.getState().ensureSessionForServer('server-b')
    const created = useWorkspaceStore.getState().sessions.find(s => s.id === id)
    expect(created).toBeDefined()
    expect(created!.serverId).toBe('server-b')
    expect(useWorkspaceStore.getState().activeSessionId).toBe(id)
  })
})
