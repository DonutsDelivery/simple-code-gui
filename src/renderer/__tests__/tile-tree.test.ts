import { describe, it, expect } from 'vitest'
import {
  createLeaf,
  createBranch,
  reorderTabInLeaf,
  equalizeRatios,
  splitRoot,
  findAdjacentLeaf,
  getAllLeaves,
  type TileNode,
} from '../components/tile-tree'
import { computeFallbackDropZone, type TileLayout } from '../components/tiled-layout-utils'

const tabIds = (tree: TileNode): string[] =>
  getAllLeaves(tree).flatMap(l => l.tabIds)

describe('reorderTabInLeaf', () => {
  const leaf = () => createLeaf('L', ['a', 'b', 'c'], 'b')

  it('moves a tab to the front', () => {
    const r = reorderTabInLeaf(leaf(), 'L', 'c', 0)
    expect(getAllLeaves(r)[0].tabIds).toEqual(['c', 'a', 'b'])
  })

  it('clamps an out-of-range index', () => {
    const r = reorderTabInLeaf(leaf(), 'L', 'a', 99)
    expect(getAllLeaves(r)[0].tabIds).toEqual(['b', 'c', 'a'])
  })

  it('preserves activeTabId', () => {
    const r = reorderTabInLeaf(leaf(), 'L', 'a', 2)
    expect(getAllLeaves(r)[0].activeTabId).toBe('b')
  })

  it('no-ops on unknown leaf/tab and does not mutate input', () => {
    const input = leaf()
    expect(reorderTabInLeaf(input, 'X', 'a', 0)).toBe(input)
    expect(reorderTabInLeaf(input, 'L', 'z', 0)).toBe(input)
    expect(input.tabIds).toEqual(['a', 'b', 'c'])
  })
})

describe('equalizeRatios', () => {
  it('sets equal ratios at every level', () => {
    const tree = createBranch('root', 'horizontal', [
      createLeaf('a', ['a']),
      createBranch('b', 'vertical', [createLeaf('c', ['c']), createLeaf('d', ['d']), createLeaf('e', ['e'])], [0.8, 0.1, 0.1]),
    ], [0.9, 0.1])
    const r = equalizeRatios(tree) as any
    expect(r.ratios).toEqual([0.5, 0.5])
    expect(r.children[1].ratios).toEqual([1 / 3, 1 / 3, 1 / 3])
  })

  it('leaves a single leaf untouched', () => {
    const leaf = createLeaf('a', ['a'])
    expect(equalizeRatios(leaf)).toBe(leaf)
  })
})

describe('splitRoot', () => {
  it('appends to a same-direction root with 1/(n+1) ratio', () => {
    const root = createBranch('r', 'horizontal', [createLeaf('a', ['a']), createLeaf('b', ['b'])], [0.5, 0.5])
    const r = splitRoot(root, 'horizontal', createLeaf('c', ['c'])) as any
    expect(r.children.map((c: any) => c.id)).toEqual(['a', 'b', 'c'])
    expect(r.ratios[2]).toBeCloseTo(1 / 3)
    expect(r.ratios.reduce((s: number, x: number) => s + x, 0)).toBeCloseTo(1)
  })

  it('wraps when directions differ', () => {
    const root = createBranch('r', 'vertical', [createLeaf('a', ['a'])], [1])
    const r = splitRoot(root, 'horizontal', createLeaf('c', ['c'])) as any
    expect(r.direction).toBe('horizontal')
    expect(r.children).toHaveLength(2)
  })

  it('wraps a leaf root', () => {
    const r = splitRoot(createLeaf('a', ['a']), 'horizontal', createLeaf('c', ['c'])) as any
    expect(r.type).toBe('branch')
    expect(tabIds(r)).toEqual(['a', 'c'])
  })
})

describe('findAdjacentLeaf (2x2 grid)', () => {
  // Two columns; each column split into two rows.
  const grid = createBranch('root', 'horizontal', [
    createBranch('col0', 'vertical', [createLeaf('tl', ['tl']), createLeaf('bl', ['bl'])], [0.5, 0.5]),
    createBranch('col1', 'vertical', [createLeaf('tr', ['tr']), createLeaf('br', ['br'])], [0.5, 0.5]),
  ], [0.5, 0.5])
  const bounds = { x: 0, y: 0, width: 100, height: 100 }

  it('finds the tile to the right', () => {
    expect(findAdjacentLeaf(grid, bounds, 'tl', 'right')?.id).toBe('tr')
  })
  it('finds the tile below', () => {
    expect(findAdjacentLeaf(grid, bounds, 'tl', 'down')?.id).toBe('bl')
  })
  it('returns null past an edge', () => {
    expect(findAdjacentLeaf(grid, bounds, 'tl', 'left')).toBeNull()
    expect(findAdjacentLeaf(grid, bounds, 'tl', 'up')).toBeNull()
  })
})

describe('computeFallbackDropZone', () => {
  const layout: TileLayout[] = [
    { id: 'a', x: 0, y: 0, width: 50, height: 100, tabIds: ['a'], activeTabId: 'a' } as any,
    { id: 'b', x: 50, y: 0, width: 50, height: 100, tabIds: ['b'], activeTabId: 'b' } as any,
  ]

  it('returns root-right when past the right edge', () => {
    expect(computeFallbackDropZone(layout, 120, 50)?.type).toBe('root-right')
  })
  it('returns null when over the tiles', () => {
    expect(computeFallbackDropZone(layout, 25, 50)).toBeNull()
  })
})
