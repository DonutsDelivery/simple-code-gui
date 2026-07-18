import { describe, expect, it } from 'vitest'
import { createBranch, createLeaf } from '../components/tile-tree'
import {
  createEmptyCanvasScene,
  filterStaleSceneTabs,
  generateCanvasScene,
  getSceneBounds,
  placeOrphanTabs,
  reconcileCanvasScene,
  remapSceneTabIds,
} from '../components/canvas'

describe('canvas scene generation', () => {
  // AC: @canvas-scene-persistence ac-2
  it('deterministically generates terminal nodes from tile leaves', () => {
    const tree = createBranch('root', 'horizontal', [
      createLeaf('left', ['a', 'b'], 'b'),
      createLeaf('right', ['c'], 'c'),
    ], [0.25, 0.75])
    const tabs = [
      { id: 'a', projectPath: '/one', title: 'A' },
      { id: 'b', projectPath: '/one', title: 'B' },
      { id: 'c', projectPath: '/two', title: 'C' },
    ]

    const scene = generateCanvasScene(tabs, { tileTree: tree, tileBounds: { x: 10, y: 20, width: 1000, height: 600 } })
    expect(scene.objects).toEqual([])
    expect(scene.nodes).toHaveLength(2)
    expect(scene.nodes[0]).toMatchObject({
      id: 'tile:left',
      tabIds: ['a', 'b'],
      activeTabId: 'b',
      projectPath: '/one',
      rect: { x: 10, y: 20, width: 250, height: 600 },
      presentation: { title: 'B' },
    })
    expect(scene.nodes[1].rect).toEqual({ x: 260, y: 20, width: 750, height: 600 })
    expect(generateCanvasScene(tabs, { tileTree: tree })).toEqual(generateCanvasScene(tabs, { tileTree: tree }))
  })

  it('filters stale tree tabs and places tabs absent from the tree as orphans', () => {
    const tree = createLeaf('only', ['stale', 'a'], 'stale')
    const scene = generateCanvasScene([{ id: 'a' }, { id: 'orphan' }], {
      tileTree: tree,
      tileBounds: { x: 0, y: 0, width: 680, height: 420 },
      gap: 20,
    })
    expect(scene.nodes[0]).toMatchObject({ tabIds: ['a'], activeTabId: 'a' })
    expect(scene.nodes[1]).toMatchObject({
      id: 'tab:orphan',
      rect: { x: 700, y: 0, width: 680, height: 420 },
    })
  })

  it('uses a stable grid when no tile tree exists', () => {
    const scene = generateCanvasScene([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { columns: 2, gap: 10 })
    expect(scene.nodes.map(node => ({ id: node.id, x: node.rect.x, y: node.rect.y }))).toEqual([
      { id: 'tab:a', x: 0, y: 0 },
      { id: 'tab:b', x: 690, y: 0 },
      { id: 'tab:c', x: 0, y: 430 },
    ])
  })
})

describe('canvas scene reconciliation', () => {
  // AC: @canvas-content-objects ac-1
  // AC: @canvas-content-objects ac-3
  it('keeps content objects unchanged while reconciling terminal tabs', () => {
    const scene = generateCanvasScene([{ id: 'a' }])
    const object = {
      id: 'note-a',
      kind: 'text' as const,
      title: 'Note',
      text: 'Persistent content',
      rect: { x: -400, y: 600, width: 240, height: 160 },
      zIndex: 8,
      groupId: 'group-a',
    }
    scene.groups.push({
      id: 'group-a',
      title: 'Content',
      rect: { x: -420, y: 580, width: 280, height: 200 },
      zIndex: 7,
      collapsed: false,
    })
    scene.objects.push(object)

    const reconciled = reconcileCanvasScene(scene, [{ id: 'renamed' }, { id: 'new' }], {
      tabIdRemap: { a: 'renamed' },
    })
    expect(reconciled.objects).toEqual([object])
    expect(reconciled.objects[0]).toBe(object)
    expect(reconciled.nodes.flatMap(node => node.tabIds)).toEqual(['renamed', 'new'])
  })

  it('includes content objects in scene bounds', () => {
    const scene = createEmptyCanvasScene()
    scene.nodes.push({
      id: 'node-a',
      tabIds: ['a'],
      activeTabId: 'a',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      zIndex: 0,
      presentation: {},
    })
    scene.objects.push({
      id: 'image-a',
      kind: 'image',
      assetId: 'asset-a',
      intrinsicWidth: 600,
      intrinsicHeight: 240,
      rect: { x: -50, y: 80, width: 300, height: 120 },
      zIndex: 1,
    })

    expect(getSceneBounds(scene)).toEqual({ x: -50, y: 0, width: 300, height: 200 })
  })

  // AC: @canvas-content-objects ac-1
  // AC: @canvas-content-objects ac-3
  it('places orphan terminals beyond existing content objects', () => {
    const scene = createEmptyCanvasScene()
    scene.objects.push({
      id: 'note-a',
      kind: 'text',
      text: 'Keep this space clear',
      rect: { x: 100, y: 60, width: 320, height: 180 },
      zIndex: 9,
    })
    scene.groups.push({
      id: 'group-a',
      title: 'Foreground group',
      rect: { x: 0, y: 0, width: 50, height: 50 },
      zIndex: 15,
      collapsed: false,
    })

    const reconciled = placeOrphanTabs(scene, [{ id: 'new' }], { gap: 20 })

    expect(reconciled.objects).toBe(scene.objects)
    expect(reconciled.nodes[0]).toMatchObject({
      rect: { x: 440, y: 60 },
      zIndex: 16,
    })
  })

  it('remaps tab ids, deduplicates collisions, and repairs the active tab', () => {
    const scene = generateCanvasScene([{ id: 'a' }, { id: 'b' }])
    scene.nodes[0].tabIds = ['a', 'alias']
    scene.nodes[0].activeTabId = 'alias'

    const remapped = remapSceneTabIds(scene, { a: 'next', alias: 'next', b: 'next' })
    expect(remapped.nodes).toHaveLength(1)
    expect(remapped.nodes[0].tabIds).toEqual(['next'])
    expect(remapped.nodes[0].activeTabId).toBe('next')
    expect(scene.nodes[0].tabIds).toEqual(['a', 'alias'])
  })

  it('drops empty stale nodes and falls back to a surviving active tab', () => {
    const scene = generateCanvasScene([{ id: 'a' }, { id: 'b' }])
    scene.nodes[0].tabIds = ['a', 'c']
    scene.nodes[0].activeTabId = 'c'

    const filtered = filterStaleSceneTabs(scene, new Set(['a']))
    expect(filtered.nodes).toHaveLength(1)
    expect(filtered.nodes[0]).toMatchObject({ tabIds: ['a'], activeTabId: 'a' })
  })

  // AC: @canvas-workspace ac-3
  it('preserves surviving geometry and deterministically places new sessions', () => {
    const scene = generateCanvasScene([{ id: 'a', title: 'Original' }])
    scene.nodes[0].rect = { x: -200, y: 75, width: 500, height: 300 }

    const reconciled = reconcileCanvasScene(scene, [{ id: 'a' }, { id: 'new', projectPath: '/project' }])
    expect(reconciled.nodes[0].rect).toEqual({ x: -200, y: 75, width: 500, height: 300 })
    expect(reconciled.nodes[1]).toMatchObject({
      id: 'tab:new',
      projectPath: '/project',
      rect: { x: 348, y: 75, width: 680, height: 420 },
    })
  })

  it('does not mutate the scene and returns it unchanged when there are no orphans', () => {
    const scene = createEmptyCanvasScene()
    expect(placeOrphanTabs(scene, [])).toBe(scene)
  })
})
