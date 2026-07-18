import { describe, expect, it } from 'vitest'
import {
  createEmptyCanvasScene,
  getNodeDetailLevel,
  getVisibleCanvasNodes,
  planCanvasNodeMounts,
  type CanvasRect,
  type CanvasTerminalNode,
} from '../components/canvas'

function node(id: string, rect: CanvasRect, zIndex = 0): CanvasTerminalNode {
  return { id, tabIds: [id], activeTabId: id, rect, zIndex, presentation: {} }
}

describe('canvas scene visibility', () => {
  it('returns intersecting nodes plus screen-space overscan', () => {
    const scene = createEmptyCanvasScene()
    scene.nodes = [
      node('visible', { x: 20, y: 20, width: 100, height: 100 }),
      node('overscan', { x: 550, y: 20, width: 100, height: 100 }),
      node('far', { x: 900, y: 20, width: 100, height: 100 }),
    ]
    const camera = { x: 0, y: 0, zoom: 2 }
    const viewport = { width: 1000, height: 600 }

    expect(getVisibleCanvasNodes(scene, camera, viewport).map(item => item.id)).toEqual(['visible'])
    expect(getVisibleCanvasNodes(scene, camera, viewport, 200).map(item => item.id)).toEqual(['visible', 'overscan'])
  })

  it('does not expose nodes inside collapsed groups', () => {
    const scene = createEmptyCanvasScene()
    scene.groups = [{
      id: 'group',
      title: 'Project',
      rect: { x: 0, y: 0, width: 400, height: 400 },
      zIndex: 0,
      collapsed: true,
    }]
    scene.nodes = [{ ...node('hidden', { x: 20, y: 20, width: 100, height: 100 }), groupId: 'group' }]
    expect(getVisibleCanvasNodes(scene, scene.camera, { width: 800, height: 600 })).toEqual([])
  })

  // AC: @canvas-terminal-lifecycle ac-3
  // AC: @canvas-content-objects ac-1
  it('builds a deterministic terminal-only bounded mount plan with visible nodes first', () => {
    const scene = createEmptyCanvasScene()
    scene.nodes = [
      node('overscan-near', { x: 520, y: 100, width: 100, height: 100 }, 5),
      node('visible-edge', { x: 450, y: 100, width: 100, height: 100 }),
      node('visible-center', { x: 200, y: 100, width: 100, height: 100 }),
      node('far', { x: 1000, y: 100, width: 100, height: 100 }),
    ]
    scene.objects = [{
      id: 'visible-note',
      kind: 'text',
      text: 'No PTY to mount',
      rect: { x: 100, y: 100, width: 100, height: 100 },
      zIndex: 10,
    }]
    const plan = planCanvasNodeMounts(scene, scene.camera, { width: 500, height: 300 }, {
      maxMounted: 2,
      overscanScreenPixels: 200,
    })

    expect(plan.visibleNodeIds).toEqual(['visible-center', 'visible-edge'])
    expect(plan.mountNodeIds).toEqual(['visible-center', 'visible-edge'])
    expect(plan.mountNodeIds).toHaveLength(2)
  })

  it('clamps invalid mount limits to an empty plan', () => {
    const scene = createEmptyCanvasScene()
    scene.nodes = [node('visible', { x: 0, y: 0, width: 100, height: 100 })]
    expect(planCanvasNodeMounts(scene, scene.camera, { width: 500, height: 300 }, { maxMounted: -4 }).mountNodeIds).toEqual([])
  })

  // AC: @canvas-visual-language ac-2
  it('maps semantic zoom thresholds to discrete detail levels', () => {
    expect(getNodeDetailLevel(1)).toBe('full')
    expect(getNodeDetailLevel(0.85)).toBe('full')
    expect(getNodeDetailLevel(0.7)).toBe('preview')
    expect(getNodeDetailLevel(0.4)).toBe('summary')
    expect(getNodeDetailLevel(0.2)).toBe('identity')
  })
})
