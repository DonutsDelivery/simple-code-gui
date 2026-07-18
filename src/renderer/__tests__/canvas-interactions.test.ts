import { describe, expect, it } from 'vitest'
import {
  arrangeCanvasNodes,
  createEmptyCanvasScene,
  findSpatialNeighbor,
  groupCanvasNodes,
  ungroupCanvasNodes,
  type CanvasRect,
  type CanvasTerminalNode,
} from '../components/canvas'

function node(id: string, rect: CanvasRect): CanvasTerminalNode {
  return { id, tabIds: [id], activeTabId: id, rect, zIndex: 0, presentation: { title: id } }
}

describe('canvas interactions', () => {
  // AC: @canvas-navigation ac-3
  it('finds spatial neighbors without relying on scene order', () => {
    const nodes = [
      node('center', { x: 400, y: 400, width: 100, height: 100 }),
      node('far-right', { x: 900, y: 400, width: 100, height: 100 }),
      node('near-right', { x: 560, y: 420, width: 100, height: 100 }),
      node('up', { x: 410, y: 100, width: 100, height: 100 }),
    ]

    expect(findSpatialNeighbor(nodes, 'center', 'right')).toBe('near-right')
    expect(findSpatialNeighbor(nodes, 'center', 'up')).toBe('up')
    expect(findSpatialNeighbor(nodes, null, 'right')).toBe('up')
  })

  // AC: @canvas-node-interaction ac-3
  it('arranges only selected nodes in deterministic rows and grids', () => {
    const scene = createEmptyCanvasScene()
    scene.nodes = [
      node('a', { x: 20, y: 40, width: 360, height: 220 }),
      node('b', { x: 900, y: 500, width: 360, height: 220 }),
      node('c', { x: 1700, y: 800, width: 360, height: 220 }),
    ]

    const row = arrangeCanvasNodes(scene, new Set(['a', 'b']), 'row')
    expect(row.nodes[0].rect).toMatchObject({ x: 20, y: 40 })
    expect(row.nodes[1].rect).toMatchObject({ x: 416, y: 40 })
    expect(row.nodes[2].rect).toEqual(scene.nodes[2].rect)

    const grid = arrangeCanvasNodes(scene, new Set(['a', 'b', 'c']), 'grid')
    expect(grid.nodes.map(item => [item.rect.x, item.rect.y])).toEqual([
      [20, 40],
      [416, 40],
      [20, 296],
    ])
  })

  // AC: @canvas-node-interaction ac-2
  it('groups and ungroups selected nodes', () => {
    const scene = createEmptyCanvasScene()
    scene.nodes = [
      node('a', { x: 100, y: 80, width: 360, height: 220 }),
      node('b', { x: 500, y: 340, width: 360, height: 220 }),
    ]
    const selection = new Set(['a', 'b'])
    const grouped = groupCanvasNodes(scene, selection, 'group-1', 'Review')

    expect(grouped.groups[0]).toMatchObject({
      id: 'group-1',
      title: 'Review',
      rect: { x: 56, y: 36, width: 848, height: 568 },
    })
    expect(grouped.nodes.every(item => item.groupId === 'group-1')).toBe(true)

    const ungrouped = ungroupCanvasNodes(grouped, selection)
    expect(ungrouped.groups).toEqual([])
    expect(ungrouped.nodes.every(item => item.groupId === undefined)).toBe(true)
  })
})
