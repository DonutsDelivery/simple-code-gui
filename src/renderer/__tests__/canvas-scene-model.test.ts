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
  type CanvasSketchObject,
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
  // AC: @canvas-content-objects ac-3
  // AC: @canvas-notes-images ac-1
  // AC: @canvas-sketch-pad ac-1
  it('accepts and preserves valid text, image, and replayable sketch objects', () => {
    const scene = validScene()
    scene.objects = [
      {
        id: 'note-a',
        kind: 'text',
        title: 'Notes',
        text: 'Remember this',
        rect: { x: 20, y: 30, width: 320, height: 180 },
        zIndex: 2,
      },
      {
        id: 'image-a',
        kind: 'image',
        assetId: 'sha256:image',
        altText: 'Imported diagram',
        intrinsicWidth: 1280,
        intrinsicHeight: 960,
        rect: { x: 400, y: 30, width: 640, height: 480 },
        zIndex: 3,
      },
      {
        id: 'sketch-a',
        kind: 'sketch',
        rect: { x: 20, y: 260, width: 500, height: 300 },
        zIndex: 4,
        documentSize: { width: 1000, height: 600 },
        revision: 7,
        strokes: [
          { id: 'stroke-1', tool: 'pen', color: '#123456', width: 4, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
          { id: 'stroke-2', tool: 'eraser', color: '#000000', width: 12, points: [{ x: 5, y: 6 }] },
        ],
        export: { assetId: 'sha256:export', revision: 7 },
      },
    ]

    const result = loadCanvasScene(scene)
    expect(result).toEqual({ status: 'ok', scene, migrated: false })
  })

  it('accepts a valid current scene without migration', () => {
    const scene = validScene()
    expect(isCanvasScene(scene)).toBe(true)
    expect(loadCanvasScene(scene)).toEqual({ status: 'ok', scene, migrated: false })
  })

  // AC: @canvas-content-objects ac-3
  it('migrates valid version one scenes by adding an empty objects collection', () => {
    const scene = validScene()
    const { objects: _objects, ...legacyScene } = scene
    const legacy = { ...legacyScene, version: 1 }

    const result = loadCanvasScene(legacy)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.migrated).toBe(true)
    expect(result.scene).toEqual({ ...legacy, version: 2, objects: [] })
  })

  // AC: @canvas-scene-persistence ac-1
  it('migrates version zero defaults through the full migration chain', () => {
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
    expect(result.scene.objects).toEqual([])
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

  it('enforces content object count, text, geometry, stroke, and point bounds', () => {
    const textObject = {
      id: 'note-a',
      kind: 'text' as const,
      text: 'a',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      zIndex: 0,
    }
    const scene = createEmptyCanvasScene()
    scene.objects = Array.from({ length: 500 }, (_, index) => ({ ...textObject, id: `note-${index}` }))
    expect(isCanvasScene(scene)).toBe(true)
    scene.objects.push({ ...textObject, id: 'one-too-many' })
    expect(isCanvasScene(scene)).toBe(false)

    const oversizedText = createEmptyCanvasScene()
    oversizedText.objects = [{ ...textObject, text: 'a'.repeat(100 * 1024 + 1) }]
    expect(isCanvasScene(oversizedText)).toBe(false)

    const sketch: CanvasSketchObject = {
      id: 'sketch-a',
      kind: 'sketch',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      zIndex: 0,
      documentSize: { width: 100, height: 100 },
      revision: 1,
      strokes: [],
    }
    const invalidDocument = createEmptyCanvasScene()
    invalidDocument.objects = [{ ...sketch, documentSize: { ...sketch.documentSize, width: Number.POSITIVE_INFINITY } }]
    expect(isCanvasScene(invalidDocument)).toBe(false)

    const oversizedDocument = createEmptyCanvasScene()
    oversizedDocument.objects = [{ ...sketch, documentSize: { width: 4097, height: 100 } }]
    expect(isCanvasScene(oversizedDocument)).toBe(false)

    const oversizedStroke = createEmptyCanvasScene()
    oversizedStroke.objects = [{
      ...sketch,
      strokes: [{ id: 'stroke-a', tool: 'pen', color: '#000000', width: 513, points: [] }],
    }]
    expect(isCanvasScene(oversizedStroke)).toBe(false)

    const duplicateStrokeIds = createEmptyCanvasScene()
    duplicateStrokeIds.objects = [{
      ...sketch,
      strokes: [
        { id: 'duplicate', tool: 'pen', color: '#000000', width: 2, points: [] },
        { id: 'duplicate', tool: 'eraser', color: '#000000', width: 8, points: [] },
      ],
    }]
    expect(isCanvasScene(duplicateStrokeIds)).toBe(false)

    const tooManyStrokes = createEmptyCanvasScene()
    tooManyStrokes.objects = [{
      ...sketch,
      strokes: Array.from({ length: 5001 }, (_, index) => ({
        id: `stroke-${index}`,
        tool: 'pen' as const,
        color: '#000000',
        width: 1,
        points: [],
      })),
    }]
    expect(isCanvasScene(tooManyStrokes)).toBe(false)

    const tooManyPoints = createEmptyCanvasScene()
    tooManyPoints.objects = [{
      ...sketch,
      strokes: [{
        id: 'stroke-a',
        tool: 'eraser',
        color: '#000000',
        width: 1,
        points: Array.from({ length: 200_001 }, () => ({ x: 0, y: 0 })),
      }],
    }]
    expect(isCanvasScene(tooManyPoints)).toBe(false)
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

    const duplicateObjects = createEmptyCanvasScene()
    duplicateObjects.objects = [
      { id: 'same', kind: 'text', text: 'one', rect: { x: 0, y: 0, width: 10, height: 10 }, zIndex: 0 },
      { id: 'same', kind: 'image', assetId: 'asset', intrinsicWidth: 10, intrinsicHeight: 10, rect: { x: 20, y: 0, width: 10, height: 10 }, zIndex: 1 },
    ]
    expect(isCanvasScene(duplicateObjects)).toBe(false)

    duplicateObjects.objects = [
      { id: 'object', kind: 'text', text: 'one', rect: { x: 0, y: 0, width: 10, height: 10 }, zIndex: 0, groupId: 'missing' },
    ]
    expect(isCanvasScene(duplicateObjects)).toBe(false)
  })
})
