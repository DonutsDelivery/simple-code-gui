// N-ary split tree for tiling layout
// Every internal node (branch) splits space among N children.
// Every leaf node holds a tab group (multiple tabs, one active).

export interface TileBranch {
  type: 'branch'
  id: string
  direction: 'horizontal' | 'vertical' // horizontal = children left-to-right
  children: TileNode[]
  ratios: number[] // sum to 1.0, one per child
}

export interface TileLeaf {
  type: 'leaf'
  id: string
  tabIds: string[]
  activeTabId: string
}

export type TileNode = TileLeaf | TileBranch

export interface ComputedRect {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_RATIO = 0.05 // ~5% minimum size

let _tileIdCounter = 0
export function generateTileId(): string {
  return `tile-${Date.now()}-${++_tileIdCounter}`
}

// ── Constructors ──

export function createLeaf(id: string, tabIds: string[], activeTabId?: string): TileLeaf {
  return { type: 'leaf', id, tabIds, activeTabId: activeTabId || tabIds[0] }
}

export function createBranch(id: string, direction: 'horizontal' | 'vertical', children: TileNode[], ratios?: number[]): TileBranch {
  const r = ratios || children.map(() => 1 / children.length)
  return { type: 'branch', id, direction, children, ratios: r }
}

// ── Queries ──

export function findLeafById(tree: TileNode, leafId: string): TileLeaf | null {
  if (tree.type === 'leaf') return tree.id === leafId ? tree : null
  for (const child of tree.children) {
    const found = findLeafById(child, leafId)
    if (found) return found
  }
  return null
}

export function findLeafByTabId(tree: TileNode, tabId: string): TileLeaf | null {
  if (tree.type === 'leaf') return tree.tabIds.includes(tabId) ? tree : null
  for (const child of tree.children) {
    const found = findLeafByTabId(child, tabId)
    if (found) return found
  }
  return null
}

export function findParent(tree: TileNode, nodeId: string): { parent: TileBranch; index: number } | null {
  if (tree.type === 'leaf') return null
  for (let i = 0; i < tree.children.length; i++) {
    if (tree.children[i].id === nodeId) return { parent: tree, index: i }
    const found = findParent(tree.children[i], nodeId)
    if (found) return found
  }
  return null
}

export function findBranchById(tree: TileNode, branchId: string): TileBranch | null {
  if (tree.type === 'branch') {
    if (tree.id === branchId) return tree
    for (const child of tree.children) {
      const found = findBranchById(child, branchId)
      if (found) return found
    }
  }
  return null
}

export function getAllTabIds(tree: TileNode): Set<string> {
  const ids = new Set<string>()
  if (tree.type === 'leaf') {
    for (const id of tree.tabIds) ids.add(id)
  } else {
    for (const child of tree.children) {
      for (const id of getAllTabIds(child)) ids.add(id)
    }
  }
  return ids
}

export function getAllLeaves(tree: TileNode): TileLeaf[] {
  if (tree.type === 'leaf') return [tree]
  const leaves: TileLeaf[] = []
  for (const child of tree.children) {
    leaves.push(...getAllLeaves(child))
  }
  return leaves
}

// ── Layout Computation ──

export function computeRects(node: TileNode, bounds: ComputedRect): Map<string, ComputedRect> {
  const result = new Map<string, ComputedRect>()

  if (node.type === 'leaf') {
    result.set(node.id, { ...bounds })
    return result
  }

  let offset = 0
  for (let i = 0; i < node.children.length; i++) {
    const ratio = node.ratios[i]
    let childBounds: ComputedRect

    if (node.direction === 'horizontal') {
      childBounds = {
        x: bounds.x + offset * bounds.width,
        y: bounds.y,
        width: ratio * bounds.width,
        height: bounds.height
      }
    } else {
      childBounds = {
        x: bounds.x,
        y: bounds.y + offset * bounds.height,
        width: bounds.width,
        height: ratio * bounds.height
      }
    }

    const childRects = computeRects(node.children[i], childBounds)
    for (const [id, rect] of childRects) {
      result.set(id, rect)
    }
    offset += ratio
  }

  return result
}

/** Find which leaf contains a point (using computed rects) */
export function findLeafAtPoint(
  tree: TileNode,
  bounds: ComputedRect,
  x: number,
  y: number,
  excludeLeafId?: string
): TileLeaf | null {
  const rects = computeRects(tree, bounds)
  for (const leaf of getAllLeaves(tree)) {
    if (excludeLeafId && leaf.id === excludeLeafId) continue
    const rect = rects.get(leaf.id)
    if (rect && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      return leaf
    }
  }
  return null
}

// ── Divider Info (for resize) ──

export interface DividerInfo {
  branchId: string
  childIndex: number // divider is between children[childIndex] and children[childIndex+1]
  direction: 'horizontal' | 'vertical' // the branch's direction
  position: number // position as percentage (x for horizontal, y for vertical)
  start: number // perpendicular start
  end: number // perpendicular end
}

export function computeDividers(node: TileNode, bounds: ComputedRect): DividerInfo[] {
  if (node.type === 'leaf') return []

  const dividers: DividerInfo[] = []
  let offset = 0

  for (let i = 0; i < node.children.length; i++) {
    const ratio = node.ratios[i]

    if (i < node.children.length - 1) {
      const dividerOffset = offset + ratio
      if (node.direction === 'horizontal') {
        dividers.push({
          branchId: node.id,
          childIndex: i,
          direction: 'horizontal',
          position: bounds.x + dividerOffset * bounds.width,
          start: bounds.y,
          end: bounds.y + bounds.height
        })
      } else {
        dividers.push({
          branchId: node.id,
          childIndex: i,
          direction: 'vertical',
          position: bounds.y + dividerOffset * bounds.height,
          start: bounds.x,
          end: bounds.x + bounds.width
        })
      }
    }

    // Recurse into children
    let childBounds: ComputedRect
    if (node.direction === 'horizontal') {
      childBounds = {
        x: bounds.x + offset * bounds.width,
        y: bounds.y,
        width: ratio * bounds.width,
        height: bounds.height
      }
    } else {
      childBounds = {
        x: bounds.x,
        y: bounds.y + offset * bounds.height,
        width: bounds.width,
        height: ratio * bounds.height
      }
    }
    dividers.push(...computeDividers(node.children[i], childBounds))

    offset += ratio
  }

  return dividers
}

/** Find the nearest divider to a point on a given edge of a leaf */
export function findDividerForEdge(
  tree: TileNode,
  bounds: ComputedRect,
  leafId: string,
  edge: 'left' | 'right' | 'top' | 'bottom'
): DividerInfo | null {
  const rects = computeRects(tree, bounds)
  const leafRect = rects.get(leafId)
  if (!leafRect) return null

  const dividers = computeDividers(tree, bounds)
  const EPSILON = 0.5

  for (const div of dividers) {
    if (div.direction === 'horizontal') {
      // This divider is a vertical line at div.position
      if (edge === 'right' && Math.abs(div.position - (leafRect.x + leafRect.width)) < EPSILON) return div
      if (edge === 'left' && Math.abs(div.position - leafRect.x) < EPSILON) return div
    } else {
      // This divider is a horizontal line at div.position
      if (edge === 'bottom' && Math.abs(div.position - (leafRect.y + leafRect.height)) < EPSILON) return div
      if (edge === 'top' && Math.abs(div.position - leafRect.y) < EPSILON) return div
    }
  }
  return null
}

// ── Tree Mutations (all return new trees — immutable) ──

/** Deep-clone a tree node */
function cloneNode(node: TileNode): TileNode {
  if (node.type === 'leaf') {
    return { ...node, tabIds: [...node.tabIds] }
  }
  return {
    ...node,
    children: node.children.map(cloneNode),
    ratios: [...node.ratios]
  }
}

/** Replace a node by ID within the tree */
function replaceNode(tree: TileNode, nodeId: string, replacement: TileNode): TileNode {
  if (tree.id === nodeId) return replacement
  if (tree.type === 'leaf') return tree
  const newChildren = tree.children.map(child => replaceNode(child, nodeId, replacement))
  if (newChildren === tree.children) return tree
  return { ...tree, children: newChildren, ratios: [...tree.ratios] }
}

/** Normalize a tree: flatten single-child branches, merge same-direction nested branches */
function normalize(node: TileNode): TileNode {
  if (node.type === 'leaf') return node

  // First normalize children
  let children = node.children.map(normalize)
  let ratios = [...node.ratios]

  // Flatten same-direction nested branches
  const newChildren: TileNode[] = []
  const newRatios: number[] = []
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child.type === 'branch' && child.direction === node.direction) {
      // Absorb grandchildren
      for (let j = 0; j < child.children.length; j++) {
        newChildren.push(child.children[j])
        newRatios.push(ratios[i] * child.ratios[j])
      }
    } else {
      newChildren.push(child)
      newRatios.push(ratios[i])
    }
  }
  children = newChildren
  ratios = newRatios

  // Single child: promote
  if (children.length === 1) return children[0]
  if (children.length === 0) return children[0] // shouldn't happen, but safety

  return { ...node, children, ratios }
}

export function splitLeaf(
  tree: TileNode,
  leafId: string,
  direction: 'horizontal' | 'vertical',
  newLeaf: TileLeaf,
  position: 'before' | 'after' = 'after'
): TileNode {
  const newTree = cloneNode(tree)

  // Find the leaf and its parent
  const parentInfo = findParent(newTree, leafId)

  if (parentInfo && parentInfo.parent.direction === direction) {
    // Parent has the same direction: insert as sibling
    const { parent, index } = parentInfo
    const siblingRatio = parent.ratios[index]
    const halfRatio = siblingRatio / 2
    parent.ratios[index] = halfRatio

    if (position === 'after') {
      parent.children.splice(index + 1, 0, newLeaf)
      parent.ratios.splice(index + 1, 0, halfRatio)
    } else {
      parent.children.splice(index, 0, newLeaf)
      parent.ratios.splice(index, 0, halfRatio)
    }
    return normalize(newTree)
  }

  // Different direction or root leaf: wrap in a new branch
  const leaf = newTree.type === 'leaf' && newTree.id === leafId
    ? newTree
    : findLeafInMutableTree(newTree, leafId)

  if (!leaf) return tree // leaf not found

  const children = position === 'after'
    ? [{ ...leaf }, newLeaf]
    : [newLeaf, { ...leaf }]

  const branch = createBranch(generateTileId(), direction, children, [0.5, 0.5])

  if (newTree.id === leafId) return branch

  return normalize(replaceNode(newTree, leafId, branch))
}

function findLeafInMutableTree(tree: TileNode, leafId: string): TileLeaf | null {
  if (tree.type === 'leaf') return tree.id === leafId ? tree : null
  for (const child of tree.children) {
    const found = findLeafInMutableTree(child, leafId)
    if (found) return found
  }
  return null
}

export function removeLeaf(tree: TileNode, leafId: string): TileNode | null {
  // If the tree IS the leaf, removing it empties the tree
  if (tree.type === 'leaf') {
    return tree.id === leafId ? null : tree
  }

  const newTree = cloneNode(tree)
  const parentInfo = findParent(newTree, leafId)
  if (!parentInfo) return tree // leaf not found

  const { parent, index } = parentInfo
  parent.children.splice(index, 1)
  parent.ratios.splice(index, 1)

  // Re-normalize ratios to sum to 1.0
  const total = parent.ratios.reduce((a, b) => a + b, 0)
  if (total > 0) {
    for (let i = 0; i < parent.ratios.length; i++) {
      parent.ratios[i] /= total
    }
  }

  return normalize(newTree)
}

export function resizeChildren(
  tree: TileNode,
  branchId: string,
  childIndex: number,
  delta: number // ratio delta: positive grows child[childIndex], shrinks child[childIndex+1]
): TileNode {
  const newTree = cloneNode(tree)
  const branch = findBranchInMutableTree(newTree, branchId)
  if (!branch || childIndex < 0 || childIndex >= branch.ratios.length - 1) return tree

  const r1 = branch.ratios[childIndex] + delta
  const r2 = branch.ratios[childIndex + 1] - delta

  if (r1 < MIN_RATIO || r2 < MIN_RATIO) return tree

  branch.ratios[childIndex] = r1
  branch.ratios[childIndex + 1] = r2

  return newTree
}

function findBranchInMutableTree(tree: TileNode, branchId: string): TileBranch | null {
  if (tree.type === 'branch') {
    if (tree.id === branchId) return tree
    for (const child of tree.children) {
      const found = findBranchInMutableTree(child, branchId)
      if (found) return found
    }
  }
  return null
}

export function swapLeaves(tree: TileNode, leafId1: string, leafId2: string): TileNode {
  const newTree = cloneNode(tree)
  const leaf1 = findLeafInMutableTree(newTree, leafId1)
  const leaf2 = findLeafInMutableTree(newTree, leafId2)
  if (!leaf1 || !leaf2) return tree

  // Swap tab content, not positions
  const tmp = { tabIds: [...leaf1.tabIds], activeTabId: leaf1.activeTabId }
  leaf1.tabIds = [...leaf2.tabIds]
  leaf1.activeTabId = leaf2.activeTabId
  leaf2.tabIds = tmp.tabIds
  leaf2.activeTabId = tmp.activeTabId

  return newTree
}

export function moveLeaf(
  tree: TileNode,
  sourceLeafId: string,
  targetLeafId: string,
  direction: 'horizontal' | 'vertical',
  position: 'before' | 'after' = 'after'
): TileNode {
  // Safety: moving a leaf onto itself would remove it and fail to reinsert
  if (sourceLeafId === targetLeafId) return tree

  // Get the source leaf's content before removing
  const sourceLeaf = findLeafById(tree, sourceLeafId)
  if (!sourceLeaf) return tree

  const movedLeaf = createLeaf(sourceLeaf.id, [...sourceLeaf.tabIds], sourceLeaf.activeTabId)

  // Remove source from tree
  let result = removeLeaf(tree, sourceLeafId)
  if (!result) return tree

  // Split target to insert source
  result = splitLeaf(result, targetLeafId, direction, movedLeaf, position)
  return result
}

export function addTabToLeaf(tree: TileNode, leafId: string, tabId: string): TileNode {
  const newTree = cloneNode(tree)
  const leaf = findLeafInMutableTree(newTree, leafId)
  if (!leaf) return tree

  leaf.tabIds.push(tabId)
  leaf.activeTabId = tabId
  return newTree
}

export function removeTabFromLeaf(tree: TileNode, tabId: string): TileNode | null {
  const leaf = findLeafByTabId(tree, tabId)
  if (!leaf) return tree

  if (leaf.tabIds.length <= 1) {
    // Last tab in leaf — remove the entire leaf
    return removeLeaf(tree, leaf.id)
  }

  const newTree = cloneNode(tree)
  const mutableLeaf = findLeafInMutableTree(newTree, leaf.id)
  if (!mutableLeaf) return tree

  mutableLeaf.tabIds = mutableLeaf.tabIds.filter(id => id !== tabId)
  if (mutableLeaf.activeTabId === tabId) {
    mutableLeaf.activeTabId = mutableLeaf.tabIds[mutableLeaf.tabIds.length - 1]
  }
  return newTree
}

export function setActiveTabInLeaf(tree: TileNode, leafId: string, tabId: string): TileNode {
  const newTree = cloneNode(tree)
  const leaf = findLeafInMutableTree(newTree, leafId)
  if (!leaf || !leaf.tabIds.includes(tabId)) return tree
  leaf.activeTabId = tabId
  return newTree
}

/** Reorder a tab within its leaf's tab strip (move tabId to toIndex). activeTabId is preserved. */
export function reorderTabInLeaf(tree: TileNode, leafId: string, tabId: string, toIndex: number): TileNode {
  const newTree = cloneNode(tree)
  const leaf = findLeafInMutableTree(newTree, leafId)
  if (!leaf) return tree
  const from = leaf.tabIds.indexOf(tabId)
  if (from < 0) return tree
  leaf.tabIds.splice(from, 1)
  const clamped = Math.max(0, Math.min(toIndex, leaf.tabIds.length))
  leaf.tabIds.splice(clamped, 0, tabId)
  return newTree
}

/** Add a new tile at the root level (a new column or new row spanning the whole canvas). */
export function splitRoot(
  tree: TileNode,
  direction: 'horizontal' | 'vertical',
  newLeaf: TileLeaf,
  position: 'before' | 'after' = 'after'
): TileNode {
  if (tree.type === 'branch' && tree.direction === direction) {
    const n = tree.children.length + 1
    const newRatios = tree.ratios.map(r => r * (n - 1) / n)
    const children = [...tree.children]
    if (position === 'after') {
      children.push(newLeaf)
      newRatios.push(1 / n)
    } else {
      children.unshift(newLeaf)
      newRatios.unshift(1 / n)
    }
    return { ...tree, children, ratios: newRatios }
  }
  const children = position === 'after' ? [tree, newLeaf] : [newLeaf, tree]
  return createBranch(generateTileId(), direction, children, [0.5, 0.5])
}

/** Reset every branch's ratios to equal sizes, recursively. */
export function equalizeRatios(tree: TileNode): TileNode {
  if (tree.type === 'leaf') return tree
  const children = tree.children.map(equalizeRatios)
  return { ...tree, children, ratios: children.map(() => 1 / children.length) }
}

/** Find the adjacent leaf in a given direction, by computed-rect geometry. */
export function findAdjacentLeaf(
  tree: TileNode,
  bounds: ComputedRect,
  leafId: string,
  dir: 'left' | 'right' | 'up' | 'down'
): TileLeaf | null {
  const rects = computeRects(tree, bounds)
  const from = rects.get(leafId)
  if (!from) return null
  const fromCx = from.x + from.width / 2
  const fromCy = from.y + from.height / 2

  let best: TileLeaf | null = null
  let bestScore = -Infinity
  for (const leaf of getAllLeaves(tree)) {
    if (leaf.id === leafId) continue
    const r = rects.get(leaf.id)
    if (!r) continue
    const cx = r.x + r.width / 2
    const cy = r.y + r.height / 2

    // Must be on the correct side; score by perpendicular overlap minus distance.
    let onSide = false
    let overlap = 0
    let dist = 0
    if (dir === 'left' || dir === 'right') {
      onSide = dir === 'left' ? cx < fromCx : cx > fromCx
      overlap = Math.min(from.y + from.height, r.y + r.height) - Math.max(from.y, r.y)
      dist = Math.abs(cx - fromCx)
    } else {
      onSide = dir === 'up' ? cy < fromCy : cy > fromCy
      overlap = Math.min(from.x + from.width, r.x + r.width) - Math.max(from.x, r.x)
      dist = Math.abs(cy - fromCy)
    }
    if (!onSide || overlap <= 0) continue
    const score = overlap - dist
    if (score > bestScore) {
      bestScore = score
      best = leaf
    }
  }
  return best
}

// ── Default Tree Generation ──

export function generateDefaultTree(tabIds: string[], containerWidth = 1920, containerHeight = 1080): TileNode | null {
  if (tabIds.length === 0) return null
  if (tabIds.length === 1) return createLeaf(tabIds[0], [tabIds[0]])

  if (tabIds.length === 2) {
    const aspect = containerWidth / containerHeight
    const direction = aspect > 1 ? 'horizontal' : 'vertical'
    return createBranch(generateTileId(), direction, [
      createLeaf(tabIds[0], [tabIds[0]]),
      createLeaf(tabIds[1], [tabIds[1]])
    ], [0.5, 0.5])
  }

  // 3+ tabs: horizontal row, equal ratios
  const leaves = tabIds.map(id => createLeaf(id, [id]))
  const ratios = tabIds.map(() => 1 / tabIds.length)
  return createBranch(generateTileId(), 'horizontal', leaves, ratios)
}

/** Add a new leaf to an existing tree (for when a new tab is opened without a specific position) */
export function addLeafToTree(
  tree: TileNode | null,
  newTabId: string,
  containerWidth = 1920,
  containerHeight = 1080
): TileNode {
  const newLeaf = createLeaf(newTabId, [newTabId])

  if (!tree) return newLeaf

  if (tree.type === 'leaf') {
    const aspect = containerWidth / containerHeight
    const direction = aspect > 1 ? 'horizontal' : 'vertical'
    return createBranch(generateTileId(), direction, [tree, newLeaf], [0.5, 0.5])
  }

  // For branch: if root is horizontal, add as a new sibling
  if (tree.direction === 'horizontal') {
    const n = tree.children.length + 1
    // Give the new leaf an equal share by redistributing
    const newRatios = tree.ratios.map(r => r * (n - 1) / n)
    newRatios.push(1 / n)
    return {
      ...tree,
      children: [...tree.children, newLeaf],
      ratios: newRatios
    }
  }

  // Root is vertical: wrap in horizontal branch
  return createBranch(generateTileId(), 'horizontal', [tree, newLeaf], [0.5, 0.5])
}

// ── Migration from flat layout ──

import type { TileLayout } from './tiled-layout-utils.js'

const EPSILON = 1.5

export function migrateFromFlat(layout: TileLayout[]): TileNode | null {
  if (layout.length === 0) return null
  if (layout.length === 1) {
    const t = layout[0]
    return createLeaf(t.id, t.tabIds || [t.id], t.activeTabId || t.tabIds?.[0] || t.id)
  }

  return inferTree(layout)
}

function inferTree(tiles: TileLayout[]): TileNode {
  if (tiles.length === 1) {
    const t = tiles[0]
    return createLeaf(t.id, t.tabIds || [t.id], t.activeTabId || t.tabIds?.[0] || t.id)
  }

  // Try to find a horizontal split (all share same Y and height → horizontal row)
  const rows = groupByRow(tiles)
  if (rows.length > 1) {
    // Multiple rows: vertical split
    const children = rows.map(row => inferTree(row.tiles))
    const totalHeight = rows.reduce((s, r) => s + r.height, 0)
    const ratios = rows.map(r => r.height / totalHeight)
    return createBranch(generateTileId(), 'vertical', children, ratios)
  }

  // Try to find a vertical split (all share same X and width → vertical column)
  const cols = groupByColumn(tiles)
  if (cols.length > 1) {
    // Multiple columns: horizontal split
    const children = cols.map(col => inferTree(col.tiles))
    const totalWidth = cols.reduce((s, c) => s + c.width, 0)
    const ratios = cols.map(c => c.width / totalWidth)
    return createBranch(generateTileId(), 'horizontal', children, ratios)
  }

  // Single row: arrange horizontally by x position
  const sorted = [...tiles].sort((a, b) => a.x - b.x)
  const totalWidth = sorted.reduce((s, t) => s + t.width, 0)
  const children = sorted.map(t => {
    const tIds = t.tabIds || [t.id]
    return createLeaf(t.id, tIds, t.activeTabId || tIds[0])
  })
  const ratios = sorted.map(t => t.width / totalWidth)
  return createBranch(generateTileId(), 'horizontal', children, ratios)
}

function groupByRow(tiles: TileLayout[]): { y: number; height: number; tiles: TileLayout[] }[] {
  const groups: { y: number; height: number; tiles: TileLayout[] }[] = []
  for (const tile of tiles) {
    let found = groups.find(g => Math.abs(g.y - tile.y) < EPSILON && Math.abs(g.height - tile.height) < EPSILON)
    if (!found) {
      found = { y: tile.y, height: tile.height, tiles: [] }
      groups.push(found)
    }
    found.tiles.push(tile)
  }
  groups.sort((a, b) => a.y - b.y)
  // Only consider it a multi-row layout if each row has tiles
  return groups
}

function groupByColumn(tiles: TileLayout[]): { x: number; width: number; tiles: TileLayout[] }[] {
  const groups: { x: number; width: number; tiles: TileLayout[] }[] = []
  for (const tile of tiles) {
    let found = groups.find(g => Math.abs(g.x - tile.x) < EPSILON && Math.abs(g.width - tile.width) < EPSILON)
    if (!found) {
      found = { x: tile.x, width: tile.width, tiles: [] }
      groups.push(found)
    }
    found.tiles.push(tile)
  }
  groups.sort((a, b) => a.x - b.x)
  return groups
}

// ── Serialization ──

export function serializeTree(tree: TileNode): object {
  return tree // already plain object
}

export function deserializeTree(data: any): TileNode | null {
  if (!data || typeof data !== 'object') return null
  if (data.type === 'leaf') {
    if (!data.id || !Array.isArray(data.tabIds)) return null
    return {
      type: 'leaf',
      id: data.id,
      tabIds: data.tabIds,
      activeTabId: data.activeTabId || data.tabIds[0]
    }
  }
  if (data.type === 'branch') {
    if (!data.id || !Array.isArray(data.children) || !Array.isArray(data.ratios)) return null
    const children = data.children
      .map((c: any) => deserializeTree(c))
      .filter((c: TileNode | null): c is TileNode => c !== null)
    if (children.length === 0) return null
    if (children.length === 1) return children[0]
    const ratios = data.ratios.slice(0, children.length)
    const total = ratios.reduce((a: number, b: number) => a + b, 0)
    const normalizedRatios = total > 0 ? ratios.map((r: number) => r / total) : children.map(() => 1 / children.length)
    return {
      type: 'branch',
      id: data.id,
      direction: data.direction === 'vertical' ? 'vertical' : 'horizontal',
      children,
      ratios: normalizedRatios
    }
  }
  return null
}

/** Remap tab IDs in the tree using a mapping function */
export function remapTabIds(tree: TileNode, mapping: Map<string, string>): TileNode {
  if (tree.type === 'leaf') {
    const newTabIds = tree.tabIds.map(id => mapping.get(id) || id)
    const newActiveTabId = mapping.get(tree.activeTabId) || tree.activeTabId
    const newId = mapping.get(tree.id) || newTabIds[0] || tree.id
    return { ...tree, id: newId, tabIds: newTabIds, activeTabId: newActiveTabId }
  }
  return {
    ...tree,
    children: tree.children.map(child => remapTabIds(child, mapping))
  }
}

/** Filter out tabs that don't exist in the given set, removing empty leaves */
export function filterTabs(tree: TileNode, validTabIds: Set<string>): TileNode | null {
  if (tree.type === 'leaf') {
    const filtered = tree.tabIds.filter(id => validTabIds.has(id))
    if (filtered.length === 0) return null
    const activeTabId = filtered.includes(tree.activeTabId) ? tree.activeTabId : filtered[0]
    return { ...tree, tabIds: filtered, activeTabId, id: filtered[0] }
  }

  const newChildren: TileNode[] = []
  const newRatios: number[] = []
  for (let i = 0; i < tree.children.length; i++) {
    const filtered = filterTabs(tree.children[i], validTabIds)
    if (filtered) {
      newChildren.push(filtered)
      newRatios.push(tree.ratios[i])
    }
  }

  if (newChildren.length === 0) return null
  if (newChildren.length === 1) return newChildren[0]

  // Re-normalize ratios
  const total = newRatios.reduce((a, b) => a + b, 0)
  const normalizedRatios = total > 0 ? newRatios.map(r => r / total) : newChildren.map(() => 1 / newChildren.length)

  return { ...tree, children: newChildren, ratios: normalizedRatios }
}
