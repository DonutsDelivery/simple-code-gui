import { describe, expect, it } from 'vitest'
import {
  createEmptyCanvasScene,
  fitBounds,
  getOverscanWorldRect,
  getViewportWorldRect,
  isCanvasScene,
  loadCanvasScene,
  rectsIntersect,
  screenToWorld,
  worldToScreen,
  zoomAtScreenPoint,
  type CanvasScene,
} from '../components/canvas'

function validScene(): CanvasScene {
  const scene = createEmptyCanvasScene()
  scene.nodes.push({
    id: 'node-a',
    tabIds: ['a'],
    activeTabId: 'a',
    rect: { x: 10, y: 20, width: 680, height: 420 },
    zIndex: 0,
    presentation: { title: 'Agent' },
  })
  return scene
}

describe('canvas scene geometry', () => {
  it('round trips between world and screen coordinates', () => {
    const camera = { x: -20, y: 30, zoom: 1.5 }
    const point = { x: 100, y: 70 }
    expect(screenToWorld(worldToScreen(point, camera), camera)).toEqual(point)
  })

  // AC: @canvas-navigation ac-1
  it('keeps the world position under the cursor fixed while zooming', () => {
    const camera = { x: 100, y: 50, zoom: 1 }
    const cursor = { x: 300, y: 200 }
    const anchor = screenToWorld(cursor, camera)
    const zoomed = zoomAtScreenPoint(camera, 1.75, cursor)
    expect(screenToWorld(cursor, zoomed)).toEqual(anchor)
    expect(zoomAtScreenPoint(camera, 10, cursor).zoom).toBe(2)
  })

  // AC: @canvas-navigation ac-2
  it('fits world bounds in the padded viewport and respects zoom limits', () => {
    const camera = fitBounds({ x: 100, y: 50, width: 800, height: 400 }, { width: 1000, height: 600 }, 100)
    expect(camera.zoom).toBe(1)
    expect(worldToScreen({ x: 100, y: 50 }, camera)).toEqual({ x: 100, y: 100 })
    expect(fitBounds({ x: 0, y: 0, width: 10, height: 10 }, { width: 1000, height: 600 }).zoom).toBe(2)
  })

  it('computes viewport and screen-space overscan in world coordinates', () => {
    const camera = { x: 10, y: 20, zoom: 2 }
    expect(getViewportWorldRect(camera, { width: 800, height: 600 })).toEqual({ x: 10, y: 20, width: 400, height: 300 })
    expect(getOverscanWorldRect(camera, { width: 800, height: 600 }, 100)).toEqual({ x: -40, y: -30, width: 500, height: 400 })
  })

  it('treats overlap as intersection but not edge-only contact', () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 }
    expect(rectsIntersect(rect, { x: 99, y: 99, width: 10, height: 10 })).toBe(true)
    expect(rectsIntersect(rect, { x: 100, y: 0, width: 10, height: 10 })).toBe(false)
  })
})

describe('canvas scene loading', () => {
  it('accepts a valid current scene without migration', () => {
    const scene = validScene()
    expect(isCanvasScene(scene)).toBe(true)
    expect(loadCanvasScene(scene)).toEqual({ status: 'ok', scene, migrated: false })
  })

  // AC: @canvas-scene-persistence ac-1
  it('migrates version zero defaults', () => {
    const scene = validScene()
    const legacy = {
      version: 0,
      camera: scene.camera,
      nodes: scene.nodes.map(({ presentation: _presentation, ...node }) => node),
    }
    const result = loadCanvasScene(legacy)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.migrated).toBe(true)
    expect(result.scene.nodes[0].rect).toEqual(scene.nodes[0].rect)
    expect(result.scene.nodes[0].presentation).toEqual({})
    expect(result.scene.settings.showGrid).toBe(true)
  })

  // AC: @canvas-scene-persistence ac-3
  it('distinguishes and preserves unknown future versions', () => {
    const future = { version: 99, futureField: { untouched: true } }
    expect(loadCanvasScene(future)).toEqual({ status: 'future-version', version: 99, data: future })
  })

  it('returns a recoverable empty scene for malformed data instead of throwing', () => {
    const malformed = { ...validScene(), nodes: [{ id: 'bad' }] }
    const result = loadCanvasScene(malformed)
    expect(result.status).toBe('recoverable-error')
    if (result.status !== 'recoverable-error') return
    expect(result.data).toBe(malformed)
    expect(result.scene.nodes).toEqual([])
  })

  it('rejects duplicate node or tab ids and dangling group references', () => {
    const scene = validScene()
    scene.nodes.push({ ...scene.nodes[0] })
    expect(isCanvasScene(scene)).toBe(false)

    const duplicateTab = validScene()
    duplicateTab.nodes.push({ ...duplicateTab.nodes[0], id: 'node-b' })
    expect(isCanvasScene(duplicateTab)).toBe(false)

    const dangling = validScene()
    dangling.nodes[0].groupId = 'missing'
    expect(isCanvasScene(dangling)).toBe(false)
  })
})
