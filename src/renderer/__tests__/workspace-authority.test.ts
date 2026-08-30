import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyCanvasScene } from '../components/canvas'
import { useWorkspaceStore, type WorkspaceSession } from '../stores/workspace'

const existingSession: WorkspaceSession = {
  serverId: 'server-old',
  authoritySessionId: 'workspace-old',
  id: 'server-old\0workspace-old',
  name: 'Old workspace',
  openTabs: [{ serverId: 'server-old', authorityTabId: 'old-pty', id: 'server-old\0old-pty', ptyId: 'old-pty', projectPath: '/old', title: 'Old' }],
  activeTabId: 'server-old\0old-pty',
  activeTileTree: null,
  canvasScene: createEmptyCanvasScene(),
  activeView: 'tiles',
  isRestored: true,
}

describe('authoritative workspace cache', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      projects: [{ serverId: 'server-old', path: '/old', name: 'Old' }],
      categories: [],
      sessions: [existingSession],
      activeSessionId: existingSession.id,
      openTabs: existingSession.openTabs,
      activeTabId: existingSession.activeTabId,
      activeTileTree: null,
      activeCanvasScene: existingSession.canvasScene,
      activeView: 'tiles',
      attentionByTabId: { ['server-old\0old-pty']: 'completed', ['server-a\0new-pty']: 'needs-input' },
    })
  })

  it('replaces renderer workspace state with the server snapshot without spawning local state', () => {
    useWorkspaceStore.getState().applyAuthoritativeWorkspace('server-a', {
      projects: [{ path: '/repo', name: 'Canonical' }],
      categories: [{ id: 'cat', name: 'Server', collapsed: false, order: 0 }],
      sessions: [{
        id: 'workspace-server',
        name: 'Server workspace',
        openTabs: [{
          id: 'new-pty',
          ptyId: 'new-pty',
          projectPath: '/repo',
          sessionId: 'agent-1',
          title: 'Canonical session',
          harnessId: 'hermes',
        }],
        activeTabId: 'new-pty',
        tileTree: { type: 'leaf', id: 'tile-1', tabIds: ['new-pty'], activeTabId: 'new-pty' },
        activeView: 'tiles',
      }],
      activeSessionId: 'workspace-server',
    })

    const state = useWorkspaceStore.getState()
    expect(state.projects).toEqual([
      { serverId: 'server-old', path: '/old', name: 'Old' },
      { serverId: 'server-a', path: '/repo', name: 'Canonical' },
    ])
    expect(state.sessions).toHaveLength(2)
    expect(state.activeSessionId).toBe('server-old\0workspace-old')
    expect(state.openTabs[0]).toMatchObject({ serverId: 'server-old', id: 'server-old\0old-pty' })
    expect(state.sessions[1].id).toBe('server-a\0workspace-server')
    expect(state.sessions[1].openTabs[0]).toMatchObject({ serverId: 'server-a', id: 'server-a\0new-pty', authorityTabId: 'new-pty', sessionId: 'agent-1' })
    expect(state.attentionByTabId).toEqual({ ['server-old\0old-pty']: 'completed', ['server-a\0new-pty']: 'needs-input' })
  })

  it('preserves an explicitly pending local session when the snapshot predates it', () => {
    const localSessionId = useWorkspaceStore.getState().addSession('server-a', 'Local')
    useWorkspaceStore.getState().addTab({
      serverId: 'server-a',
      authorityTabId: 'local-pty',
      id: 'server-a\0local-pty',
      ptyId: 'local-pty',
      projectPath: '/repo',
      title: 'Local tab',
    })

    useWorkspaceStore.getState().applyAuthoritativeWorkspace('server-a', {
      projects: [{ path: '/repo', name: 'Canonical' }],
      categories: [],
      sessions: [],
      activeSessionId: null,
    })

    const state = useWorkspaceStore.getState()
    // The unsaved local session and its tab must survive the apply.
    expect(state.sessions.find(session => session.serverId === 'server-a')?.id).toBe(localSessionId)
    expect(state.sessions.find(session => session.serverId === 'server-a')?.openTabs.map(tab => tab.authorityTabId)).toEqual(['local-pty'])
    expect(state.sessions.find(session => session.serverId === 'server-a')?.name).toBe('Local')
  })

  it('treats omitted established tabs as authority-owned deletions', () => {
    useWorkspaceStore.setState({
      projects: [{ serverId: 'server-a', path: '/repo', name: 'Canonical' }],
      categories: [],
      sessions: [{
        serverId: 'server-a',
        authoritySessionId: 'workspace-server',
        id: 'server-a\0workspace-server',
        name: 'Server workspace',
        openTabs: [
          { serverId: 'server-a', authorityTabId: 'new-pty', id: 'server-a\0new-pty', ptyId: 'new-pty', projectPath: '/repo', title: 'Canonical' },
          { serverId: 'server-a', authorityTabId: 'local-pty', id: 'server-a\0local-pty', ptyId: 'local-pty', projectPath: '/repo', title: 'Local tab' },
        ],
        activeTabId: 'server-a\0new-pty',
        activeTileTree: null,
        canvasScene: createEmptyCanvasScene(),
        activeView: 'tiles',
        isRestored: true,
      }],
      activeSessionId: 'server-a\0workspace-server',
      openTabs: [
        { serverId: 'server-a', authorityTabId: 'new-pty', id: 'server-a\0new-pty', ptyId: 'new-pty', projectPath: '/repo', title: 'Canonical' },
        { serverId: 'server-a', authorityTabId: 'local-pty', id: 'server-a\0local-pty', ptyId: 'local-pty', projectPath: '/repo', title: 'Local tab' },
      ],
      activeTabId: 'server-a\0new-pty',
      activeTileTree: null,
      activeCanvasScene: createEmptyCanvasScene(),
      activeView: 'tiles',
      attentionByTabId: {},
    })

    useWorkspaceStore.getState().applyAuthoritativeWorkspace('server-a', {
      projects: [{ path: '/repo', name: 'Canonical' }],
      categories: [],
      sessions: [{
        id: 'workspace-server',
        name: 'Server workspace',
        openTabs: [{
          id: 'new-pty',
          ptyId: 'new-pty',
          projectPath: '/repo',
          sessionId: 'agent-1',
          title: 'Canonical session',
          harnessId: 'hermes',
        }],
        activeTabId: 'new-pty',
        activeView: 'tiles',
      }],
      activeSessionId: 'workspace-server',
    })

    const state = useWorkspaceStore.getState()
    const session = state.sessions.find(session => session.serverId === 'server-a')
    expect(session?.openTabs.map(tab => tab.authorityTabId)).toEqual(['new-pty'])
  })
})
