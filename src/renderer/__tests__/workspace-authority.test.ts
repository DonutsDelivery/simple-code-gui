import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyCanvasScene } from '../components/canvas'
import { useWorkspaceStore, type WorkspaceSession } from '../stores/workspace'

const existingSession: WorkspaceSession = {
  id: 'workspace-old',
  name: 'Old workspace',
  openTabs: [{ id: 'old-pty', ptyId: 'old-pty', projectPath: '/old', title: 'Old' }],
  activeTabId: 'old-pty',
  activeTileTree: null,
  canvasScene: createEmptyCanvasScene(),
  activeView: 'tiles',
  isRestored: true,
}

describe('authoritative workspace cache', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      projects: [{ path: '/old', name: 'Old' }],
      categories: [],
      sessions: [existingSession],
      activeSessionId: existingSession.id,
      openTabs: existingSession.openTabs,
      activeTabId: existingSession.activeTabId,
      activeTileTree: null,
      activeCanvasScene: existingSession.canvasScene,
      activeView: 'tiles',
      attentionByTabId: { 'old-pty': 'completed', 'new-pty': 'needs-input' },
    })
  })

  it('replaces renderer workspace state with the server snapshot without spawning local state', () => {
    useWorkspaceStore.getState().applyAuthoritativeWorkspace({
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
    expect(state.projects).toEqual([{ path: '/repo', name: 'Canonical' }])
    expect(state.sessions).toHaveLength(1)
    expect(state.activeSessionId).toBe('workspace-server')
    expect(state.openTabs[0]).toMatchObject({ id: 'new-pty', ptyId: 'new-pty', sessionId: 'agent-1' })
    expect(state.activeTileTree).toMatchObject({ id: 'tile-1' })
    expect(state.attentionByTabId).toEqual({ 'new-pty': 'needs-input' })
  })
})
