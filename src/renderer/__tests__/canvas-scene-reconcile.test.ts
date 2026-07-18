import { describe, expect, it } from 'vitest'
import { createBranch, createLeaf } from '../components/tile-tree'
import {
  createEmptyCanvasScene,
  filterStaleSceneTabs,
  generateCanvasScene,
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
