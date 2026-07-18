import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyCanvasScene } from '../components/canvas'
import { createLeaf } from '../components/tile-tree'
import { useWorkspaceStore, type OpenTab, type WorkspaceSession } from '../stores/workspace'

function tab(id: string, projectPath = '/project'): OpenTab {
  return { id, ptyId: id, projectPath, title: id, backend: 'claude' }
}

function session(id: string, tabs: OpenTab[] = []): WorkspaceSession {
  const canvasScene = createEmptyCanvasScene()
  return {
    id,
    name: id,
    openTabs: tabs,
    activeTabId: tabs[0]?.id ?? null,
    activeTileTree: tabs.length > 0 ? createLeaf(`tile-${id}`, tabs.map(item => item.id), tabs[0].id) : null,
    canvasScene,
    activeView: 'tiles',
    isRestored: true,
  }
}

beforeEach(() => {
  useWorkspaceStore.getState().initSessions([], null)
})

describe('workspace Canvas coexistence', () => {
  // AC: @canvas-workspace ac-1
  it('preserves independent tile and Canvas arrangements while switching views', () => {
    const first = tab('pty-1')
    const initial = session('ws-1', [first])
    initial.canvasScene!.nodes = [{
      id: 'node-1',
      tabIds: [first.id],
      activeTabId: first.id,
      rect: { x: -500, y: 220, width: 680, height: 420 },
      zIndex: 0,
      presentation: {},
    }]
    useWorkspaceStore.getState().initSessions([initial], initial.id)

    const originalTree = useWorkspaceStore.getState().activeTileTree
    const originalTab = useWorkspaceStore.getState().openTabs[0]
    useWorkspaceStore.getState().setActiveView('canvas')
    const movedScene = {
      ...useWorkspaceStore.getState().activeCanvasScene!,
      camera: { x: -300, y: 140, zoom: 0.7 },
    }
    useWorkspaceStore.getState().setActiveCanvasScene(movedScene)
    useWorkspaceStore.getState().setActiveView('tiles')

    const state = useWorkspaceStore.getState()
    expect(state.activeTileTree).toBe(originalTree)
    expect(state.openTabs[0]).toBe(originalTab)
    expect(state.openTabs[0].ptyId).toBe('pty-1')
    expect(state.activeCanvasScene?.camera).toEqual({ x: -300, y: 140, zoom: 0.7 })
    expect(state.sessions[0].activeView).toBe('tiles')
  })

  // AC: @canvas-workspace ac-3
  it('adds, remaps, and removes terminal membership in the Canvas scene', () => {
    const initial = session('ws-1')
    useWorkspaceStore.getState().initSessions([initial], initial.id)

    useWorkspaceStore.getState().addTab(tab('pty-old'))
    expect(useWorkspaceStore.getState().activeCanvasScene?.nodes.flatMap(node => node.tabIds)).toEqual(['pty-old'])

    useWorkspaceStore.getState().updateTab('pty-old', { id: 'pty-new', ptyId: 'pty-new' })
    expect(useWorkspaceStore.getState().activeCanvasScene?.nodes.flatMap(node => node.tabIds)).toEqual(['pty-new'])

    useWorkspaceStore.getState().removeTab('pty-new')
    expect(useWorkspaceStore.getState().activeCanvasScene?.nodes).toEqual([])
  })

  // AC: @canvas-workspace ac-3
  it('reconciles both source and destination scenes when moving sessions', () => {
    const first = tab('pty-1', '/one')
    const source = session('source', [first])
    source.canvasScene!.nodes = [{
      id: 'node-source',
      tabIds: [first.id],
      activeTabId: first.id,
      rect: { x: 50, y: 50, width: 680, height: 420 },
      zIndex: 0,
      presentation: {},
    }]
    const target = session('target')
    useWorkspaceStore.getState().initSessions([source, target], source.id)

    useWorkspaceStore.getState().moveTabsToSession([first.id], target.id)

    const state = useWorkspaceStore.getState()
    const updatedSource = state.sessions.find(item => item.id === source.id)!
    const updatedTarget = state.sessions.find(item => item.id === target.id)!
    expect(updatedSource.openTabs).toEqual([])
    expect(updatedSource.canvasScene?.nodes).toEqual([])
    expect(updatedTarget.openTabs.map(item => item.id)).toEqual([first.id])
    expect(updatedTarget.canvasScene?.nodes.flatMap(node => node.tabIds)).toEqual([first.id])
  })
})
