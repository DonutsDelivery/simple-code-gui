import { describe, expect, it } from 'vitest'
import { createEmptyCanvasScene } from '../components/canvas'
import { createBranch, createLeaf } from '../components/tile-tree'
import type { WorkspaceSession } from '../stores/workspace'
import { findTabByPtyId, getVisibleTabIds } from '../utils/agentAttention'

function workspace(view: 'tiles' | 'canvas'): WorkspaceSession {
  const scene = createEmptyCanvasScene()
  scene.nodes = [
    { id: 'node-a', tabIds: ['a', 'hidden-a'], activeTabId: 'a', projectPath: '/a', rect: { x: 0, y: 0, width: 680, height: 420 }, zIndex: 0, presentation: {} },
    { id: 'node-b', tabIds: ['b'], activeTabId: 'b', projectPath: '/b', rect: { x: 700, y: 0, width: 680, height: 420 }, zIndex: 1, presentation: {} },
  ]
  return {
    id: 'ws',
    name: 'Workspace',
    openTabs: [
      { id: 'a', ptyId: 'pty-a', projectPath: '/a', title: 'A' },
      { id: 'hidden-a', ptyId: 'pty-hidden', projectPath: '/a', title: 'Hidden' },
      { id: 'b', ptyId: 'pty-b', projectPath: '/b', title: 'B' },
    ],
    activeTabId: 'a',
    activeTileTree: createBranch('root', 'horizontal', [
      createLeaf('leaf-a', ['a', 'hidden-a'], 'a'),
      createLeaf('leaf-b', ['b'], 'b'),
    ]),
    canvasScene: scene,
    activeView: view,
    isRestored: true,
  }
}

describe('agent attention visibility', () => {
  // AC: @agent-session-notifications ac-3
  // AC: @agent-session-notifications ac-4
  it('treats each visible tile or Canvas card active subtab as opened', () => {
    const tiled = workspace('tiles')
    expect([...getVisibleTabIds([tiled], tiled.id, false)]).toEqual(['a', 'b'])
    expect(getVisibleTabIds([tiled], tiled.id, false)).not.toContain('hidden-a')

    const canvas = workspace('canvas')
    expect([...getVisibleTabIds([canvas], canvas.id, false)]).toEqual(['a', 'b'])
    expect(getVisibleTabIds([canvas], canvas.id, false)).not.toContain('hidden-a')
  })

  // AC: @agent-session-notifications ac-3
  it('only treats the active tab as visible on mobile and resolves background PTYs', () => {
    const current = workspace('tiles')
    expect([...getVisibleTabIds([current], current.id, true)]).toEqual(['a'])
    expect(findTabByPtyId([current], 'pty-hidden')).toBe('hidden-a')
  })
})
