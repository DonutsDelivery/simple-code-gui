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
    serverId: 'server-a',
    authoritySessionId: 'ws',
    id: 'ws',
    name: 'Workspace',
    openTabs: [
      { serverId: 'server-a', id: 'a', ptyId: 'pty-a', projectPath: '/a', title: 'A' },
      { serverId: 'server-a', id: 'hidden-a', ptyId: 'pty-hidden', projectPath: '/a', title: 'Hidden' },
      { serverId: 'server-a', id: 'b', ptyId: 'pty-b', projectPath: '/b', title: 'B' },
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
    expect([...getVisibleTabIds([tiled], tiled.id, false)]).toEqual(['server-a\0a', 'server-a\0b'])
    expect(getVisibleTabIds([tiled], tiled.id, false)).not.toContain('server-a\0hidden-a')

    const canvas = workspace('canvas')
    expect([...getVisibleTabIds([canvas], canvas.id, false)]).toEqual(['server-a\0a', 'server-a\0b'])
    expect(getVisibleTabIds([canvas], canvas.id, false)).not.toContain('server-a\0hidden-a')
  })

  // AC: @agent-session-notifications ac-3
  it('only treats the active tab as visible on mobile and resolves background PTYs', () => {
    const current = workspace('tiles')
    expect([...getVisibleTabIds([current], current.id, true)]).toEqual(['server-a\0a'])
    expect(findTabByPtyId([current], 'server-a', 'pty-hidden')).toBe('server-a\0hidden-a')
  })
})
