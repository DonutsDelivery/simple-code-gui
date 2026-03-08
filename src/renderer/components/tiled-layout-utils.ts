export interface TileLayout {
  id: string
  tabIds: string[]    // Ordered list of OpenTab IDs in this tile
  activeTabId: string // Currently visible sub-tab
  x: number      // Left position as percentage (0-100)
  y: number      // Top position as percentage (0-100)
  width: number  // Width as percentage (0-100)
  height: number // Height as percentage (0-100)
}

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
}

export type DropZoneType =
  | 'swap'
  | 'split-top'
  | 'split-bottom'
  | 'split-left'
  | 'split-right'

export interface DropZone {
  type: DropZoneType
  targetTileId: string
  bounds: { x: number; y: number; width: number; height: number }
}

interface TileRow {
  y: number
  height: number
  tiles: TileLayout[]
}

export const MIN_SIZE = 10
const EPSILON = 1

function tilesOverlap(a: TileLayout, b: TileLayout): boolean {
  const overlapX = a.x < b.x + b.width && a.x + a.width > b.x
  const overlapY = a.y < b.y + b.height && a.y + a.height > b.y
  return overlapX && overlapY
}

function detectRows(layout: TileLayout[]): TileRow[] {
  const rowMap = new Map<string, TileLayout[]>()

  for (const tile of layout) {
    const key = `${Math.round(tile.y)}-${Math.round(tile.height)}`
    const existing = rowMap.get(key) || []
    existing.push(tile)
    rowMap.set(key, existing)
  }

  const rows: TileRow[] = []
  for (const tiles of rowMap.values()) {
    rows.push({
      y: tiles[0].y,
      height: tiles[0].height,
      tiles: tiles.sort((a, b) => a.x - b.x)
    })
  }

  return rows.sort((a, b) => a.y - b.y)
}

function findAdjacentTile(layout: TileLayout[], removed: TileLayout): TileLayout | null {
  const rightNeighbor = layout.find(t =>
    Math.abs(t.x - (removed.x + removed.width)) < EPSILON &&
    t.y < removed.y + removed.height + EPSILON &&
    t.y + t.height > removed.y - EPSILON
  )
  if (rightNeighbor) return rightNeighbor

  const bottomNeighbor = layout.find(t =>
    Math.abs(t.y - (removed.y + removed.height)) < EPSILON &&
    t.x < removed.x + removed.width + EPSILON &&
    t.x + t.width > removed.x - EPSILON
  )
  if (bottomNeighbor) return bottomNeighbor

  const leftNeighbor = layout.find(t =>
    Math.abs(t.x + t.width - removed.x) < EPSILON &&
    t.y < removed.y + removed.height + EPSILON &&
    t.y + t.height > removed.y - EPSILON
  )
  if (leftNeighbor) return leftNeighbor

  const topNeighbor = layout.find(t =>
    Math.abs(t.y + t.height - removed.y) < EPSILON &&
    t.x < removed.x + removed.width + EPSILON &&
    t.x + t.width > removed.x - EPSILON
  )
  return topNeighbor || null
}

/** Expand a tile into the removed tile's space along their shared edge only.
 *  Returns null if the expansion would overlap any other remaining tile. */
function expandAlongSharedEdge(
  tile: TileLayout,
  removed: TileLayout,
  remaining: TileLayout[]
): TileLayout | null {
  let candidate: TileLayout | null = null

  // Check which edge is shared and expand only in that direction
  if (Math.abs(tile.x + tile.width - removed.x) < EPSILON) {
    // tile is to the LEFT of removed → expand width rightward
    candidate = { ...tile, width: tile.width + removed.width }
  } else if (Math.abs(removed.x + removed.width - tile.x) < EPSILON) {
    // tile is to the RIGHT of removed → expand leftward
    candidate = { ...tile, x: removed.x, width: tile.width + removed.width }
  } else if (Math.abs(tile.y + tile.height - removed.y) < EPSILON) {
    // tile is ABOVE removed → expand height downward
    candidate = { ...tile, height: tile.height + removed.height }
  } else if (Math.abs(removed.y + removed.height - tile.y) < EPSILON) {
    // tile is BELOW removed → expand upward
    candidate = { ...tile, y: removed.y, height: tile.height + removed.height }
  }

  if (!candidate) return null

  // Verify the expansion doesn't overlap any other tile
  for (const other of remaining) {
    if (other.id === tile.id) continue
    if (tilesOverlap(candidate, other)) return null
  }

  return candidate
}

function findOptimalGrid(count: number, containerWidth: number, containerHeight: number): { rows: number; cols: number } {
  if (count <= 0) return { rows: 0, cols: 0 }
  if (count === 1) return { rows: 1, cols: 1 }

  let bestRows = 1
  let bestCols = count
  let bestDeviation = Infinity

  for (let rows = 1; rows <= count; rows++) {
    const cols = Math.ceil(count / rows)
    const tileWidth = containerWidth / cols
    const tileHeight = containerHeight / rows
    const tileAspect = tileWidth / tileHeight
    const deviation = Math.abs(Math.log(tileAspect))

    if (deviation < bestDeviation) {
      bestDeviation = deviation
      bestRows = rows
      bestCols = cols
    }
  }

  return { rows: bestRows, cols: bestCols }
}

function makeTile(id: string, x: number, y: number, width: number, height: number, tabIds?: string[], activeTabId?: string): TileLayout {
  const tIds = tabIds || [id]
  return { id, tabIds: tIds, activeTabId: activeTabId || tIds[0], x, y, width, height }
}

export function generateDefaultLayout(tabs: OpenTab[], containerWidth = 1920, containerHeight = 1080): TileLayout[] {
  // Each tab gets its own tile (no grouping by project)
  const count = tabs.length
  if (count === 0) return []
  if (count === 1) {
    return [makeTile(tabs[0].id, 0, 0, 100, 100)]
  }

  // For 3+ tiles, lay out in a single horizontal row where each tile gets
  // at least 50% viewport width (canvas extends beyond viewport)
  if (count >= 3) {
    const layout: TileLayout[] = []
    const tileWidth = 50  // Each tile gets 50% of viewport width
    for (let i = 0; i < count; i++) {
      layout.push(makeTile(tabs[i].id, i * tileWidth, 0, tileWidth, 100))
    }
    return layout
  }

  const { rows, cols } = findOptimalGrid(count, containerWidth, containerHeight)
  const layout: TileLayout[] = []
  const colWidth = 100 / cols
  const rowHeight = 100 / rows
  const fullRows = Math.floor(count / cols)
  const lastRowCount = count % cols

  let tabIndex = 0

  for (let row = 0; row < fullRows; row++) {
    for (let col = 0; col < cols; col++) {
      layout.push(makeTile(tabs[tabIndex].id, col * colWidth, row * rowHeight, colWidth, rowHeight))
      tabIndex++
    }
  }

  if (lastRowCount > 0) {
    const lastRowColWidth = 100 / lastRowCount
    for (let col = 0; col < lastRowCount; col++) {
      layout.push(makeTile(tabs[tabIndex].id, col * lastRowColWidth, fullRows * rowHeight, lastRowColWidth, rowHeight))
      tabIndex++
    }
  }

  return layout
}

export function validateLayout(layout: TileLayout[], tabs: OpenTab[], containerWidth = 1920, containerHeight = 1080): TileLayout[] {
  const tabIdSet = new Set(tabs.map(t => t.id))

  // Filter stale tabIds that no longer correspond to actual tabs
  let cleaned = layout.map(tile => {
    const validTabIds = (tile.tabIds || []).filter(id => tabIdSet.has(id))
    if (validTabIds.length === tile.tabIds?.length) return tile
    const activeTabId = validTabIds.includes(tile.activeTabId) ? tile.activeTabId : validTabIds[0]
    return { ...tile, tabIds: validTabIds, activeTabId: activeTabId || tile.activeTabId }
  })

  // Remove tiles that have no valid tabs and reclaim their space
  let emptyTileIds = cleaned.filter(t => t.tabIds.length === 0).map(t => t.id)
  for (const emptyId of emptyTileIds) {
    cleaned = removeTilePreservingStructure(cleaned, emptyId, tabs, containerWidth, containerHeight)
  }

  for (const tile of cleaned) {
    if (tile.x < 0 || tile.y < 0 ||
        tile.y + tile.height > 100.5 ||
        tile.width < 5 || tile.height < 5) {
      console.warn('Detected out-of-bounds tile, resetting to default layout', tile)
      return generateDefaultLayout(tabs, containerWidth, containerHeight)
    }
    if (!tile.tabIds || tile.tabIds.length === 0) {
      console.warn('Detected tile with empty tabIds, resetting to default layout', tile)
      return generateDefaultLayout(tabs, containerWidth, containerHeight)
    }
    if (!tile.activeTabId || !tile.tabIds.includes(tile.activeTabId)) {
      console.warn('Detected tile with invalid activeTabId, fixing', tile)
      tile.activeTabId = tile.tabIds[0]
    }
  }

  for (let i = 0; i < cleaned.length; i++) {
    for (let j = i + 1; j < cleaned.length; j++) {
      if (tilesOverlap(cleaned[i], cleaned[j])) {
        console.warn('Detected overlapping tiles:', cleaned[i], cleaned[j])
      }
    }
  }
  return cleaned
}

export function removeTilePreservingStructure(
  layout: TileLayout[],
  removedTileId: string,
  tabs: OpenTab[],
  containerWidth: number,
  containerHeight: number
): TileLayout[] {
  const removed = layout.find(t => t.id === removedTileId)
  if (!removed) return layout

  const remaining = layout.filter(t => t.id !== removedTileId)
  if (remaining.length === 0) return []

  const sameRow = remaining.filter(t =>
    Math.abs(t.y - removed.y) < EPSILON &&
    Math.abs(t.height - removed.height) < EPSILON
  )

  const sameColumn = remaining.filter(t =>
    Math.abs(t.x - removed.x) < EPSILON &&
    Math.abs(t.width - removed.width) < EPSILON
  )

  if (sameRow.length > 0) {
    // Only expand tiles directly adjacent to the removed tile to avoid
    // repositioning distant tiles over non-sameRow tiles (causing overlaps)
    const leftNeighbor = sameRow.find(t => Math.abs(t.x + t.width - removed.x) < EPSILON)
    const rightNeighbor = sameRow.find(t => Math.abs(t.x - (removed.x + removed.width)) < EPSILON)
    const neighbors = [leftNeighbor, rightNeighbor].filter(Boolean) as TileLayout[]

    if (neighbors.length > 0) {
      const extraWidthPerTile = removed.width / neighbors.length
      return remaining.map(t => {
        if (leftNeighbor && t.id === leftNeighbor.id) {
          return { ...t, width: t.width + extraWidthPerTile }
        }
        if (rightNeighbor && t.id === rightNeighbor.id) {
          return { ...t, x: t.x - extraWidthPerTile, width: t.width + extraWidthPerTile }
        }
        return t
      })
    }
  }

  if (sameColumn.length > 0) {
    // Only expand tiles directly adjacent to the removed tile
    const topNeighbor = sameColumn.find(t => Math.abs(t.y + t.height - removed.y) < EPSILON)
    const bottomNeighbor = sameColumn.find(t => Math.abs(t.y - (removed.y + removed.height)) < EPSILON)
    const neighbors = [topNeighbor, bottomNeighbor].filter(Boolean) as TileLayout[]

    if (neighbors.length > 0) {
      const extraHeightPerTile = removed.height / neighbors.length
      return remaining.map(t => {
        if (topNeighbor && t.id === topNeighbor.id) {
          return { ...t, height: t.height + extraHeightPerTile }
        }
        if (bottomNeighbor && t.id === bottomNeighbor.id) {
          return { ...t, y: t.y - extraHeightPerTile, height: t.height + extraHeightPerTile }
        }
        return t
      })
    }
  }

  // Fallback: find ALL tiles sharing an edge with the removed tile and expand them.
  // Group by which edge they share (left, right, top, bottom of the removed tile).
  const leftOf = remaining.filter(t => Math.abs(t.x + t.width - removed.x) < EPSILON &&
    t.y < removed.y + removed.height - EPSILON && t.y + t.height > removed.y + EPSILON)
  const rightOf = remaining.filter(t => Math.abs(t.x - (removed.x + removed.width)) < EPSILON &&
    t.y < removed.y + removed.height - EPSILON && t.y + t.height > removed.y + EPSILON)
  const above = remaining.filter(t => Math.abs(t.y + t.height - removed.y) < EPSILON &&
    t.x < removed.x + removed.width - EPSILON && t.x + t.width > removed.x + EPSILON)
  const below = remaining.filter(t => Math.abs(t.y - (removed.y + removed.height)) < EPSILON &&
    t.x < removed.x + removed.width - EPSILON && t.x + t.width > removed.x + EPSILON)

  // Try expanding tiles on one side into the gap. Prefer the side with tiles
  // that together span the full edge (so no gaps remain).
  const tryExpand = (tiles: TileLayout[], dir: 'right' | 'left' | 'down' | 'up'): TileLayout[] | null => {
    if (tiles.length === 0) return null
    const expandedIds = new Set(tiles.map(t => t.id))
    const result = remaining.map(t => {
      if (!expandedIds.has(t.id)) return t
      switch (dir) {
        case 'right': return { ...t, width: t.width + removed.width }
        case 'left': return { ...t, x: removed.x, width: t.width + removed.width }
        case 'down': return { ...t, height: t.height + removed.height }
        case 'up': return { ...t, y: removed.y, height: t.height + removed.height }
      }
    })
    // Verify no overlaps
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (tilesOverlap(result[i], result[j])) return null
      }
    }
    return result
  }

  const expanded = tryExpand(leftOf, 'right') || tryExpand(rightOf, 'left') ||
                   tryExpand(above, 'down') || tryExpand(below, 'up')
  if (expanded) return expanded

  // If nothing else worked, just leave the remaining tiles as-is.
  // A gap is better than resetting the entire layout.
  return remaining
}

export function splitTile(
  layout: TileLayout[],
  targetTileId: string,
  newTileId: string,
  direction: 'top' | 'bottom' | 'left' | 'right'
): TileLayout[] {
  const target = layout.find(t => t.id === targetTileId)
  if (!target) return layout

  const isHorizontal = direction === 'top' || direction === 'bottom'
  const newLayout = layout.filter(t => t.id !== targetTileId)

  // The target tile keeps its tabIds; the new tile gets a single tab
  const targetTabIds = target.tabIds || [targetTileId]
  const targetActiveTabId = target.activeTabId || targetTabIds[0]

  if (isHorizontal) {
    const halfHeight = target.height / 2
    const topTileId = direction === 'top' ? newTileId : targetTileId
    const bottomTileId = direction === 'bottom' ? newTileId : targetTileId
    newLayout.push(
      makeTile(topTileId, target.x, target.y, target.width, halfHeight,
        topTileId === targetTileId ? targetTabIds : [newTileId],
        topTileId === targetTileId ? targetActiveTabId : newTileId),
      makeTile(bottomTileId, target.x, target.y + halfHeight, target.width, halfHeight,
        bottomTileId === targetTileId ? targetTabIds : [newTileId],
        bottomTileId === targetTileId ? targetActiveTabId : newTileId)
    )
  } else {
    const halfWidth = target.width / 2
    const leftTileId = direction === 'left' ? newTileId : targetTileId
    const rightTileId = direction === 'right' ? newTileId : targetTileId
    newLayout.push(
      makeTile(leftTileId, target.x, target.y, halfWidth, target.height,
        leftTileId === targetTileId ? targetTabIds : [newTileId],
        leftTileId === targetTileId ? targetActiveTabId : newTileId),
      makeTile(rightTileId, target.x + halfWidth, target.y, halfWidth, target.height,
        rightTileId === targetTileId ? targetTabIds : [newTileId],
        rightTileId === targetTileId ? targetActiveTabId : newTileId)
    )
  }

  return newLayout
}

export function addTileToLayout(
  layout: TileLayout[],
  newTileId: string,
  activeTabId: string | null,
  containerWidth: number,
  containerHeight: number
): TileLayout[] {
  if (layout.length === 0) {
    return [makeTile(newTileId, 0, 0, 100, 100)]
  }

  // For 1 tile, split it so both tiles stay on-screen
  if (layout.length === 1) {
    const tile = layout[0]
    const tileAspect = (tile.width / 100 * containerWidth) / (tile.height / 100 * containerHeight)
    const direction = tileAspect > 1 ? 'right' : 'bottom'
    return splitTile(layout, tile.id, newTileId, direction)
  }

  // For 2+ tiles, always append to the right of the rightmost edge.
  // Never split or redistribute existing tiles — that destroys custom layouts.
  const rightmostEdge = Math.max(...layout.map(t => t.x + t.width))
  return [...layout, makeTile(newTileId, rightmostEdge, 0, 50, 100)]
}

export function computeDropZone(
  layout: TileLayout[],
  draggedTileId: string | null,
  mouseX: number,
  mouseY: number
): DropZone | null {
  // 30% edge threshold makes it easier to trigger split zones
  const EDGE_THRESHOLD = 0.30

  const targetTile = layout.find(t =>
    t.id !== draggedTileId &&
    mouseX >= t.x && mouseX <= t.x + t.width &&
    mouseY >= t.y && mouseY <= t.y + t.height
  )

  if (!targetTile) return null

  const relX = (mouseX - targetTile.x) / targetTile.width
  const relY = (mouseY - targetTile.y) / targetTile.height

  let type: DropZoneType = 'swap'
  let bounds = { x: targetTile.x, y: targetTile.y, width: targetTile.width, height: targetTile.height }

  // Calculate distances to each edge (0 = at edge, 0.5 = at center)
  const distToLeft = relX
  const distToRight = 1 - relX
  const distToTop = relY
  const distToBottom = 1 - relY

  // Find the closest edge
  const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom)

  // Only trigger split zone if we're within the threshold
  if (minDist < EDGE_THRESHOLD) {
    if (minDist === distToTop) {
      type = 'split-top'
      bounds = { x: targetTile.x, y: targetTile.y, width: targetTile.width, height: targetTile.height / 2 }
    } else if (minDist === distToBottom) {
      type = 'split-bottom'
      bounds = { x: targetTile.x, y: targetTile.y + targetTile.height / 2, width: targetTile.width, height: targetTile.height / 2 }
    } else if (minDist === distToLeft) {
      type = 'split-left'
      bounds = { x: targetTile.x, y: targetTile.y, width: targetTile.width / 2, height: targetTile.height }
    } else if (minDist === distToRight) {
      type = 'split-right'
      bounds = { x: targetTile.x + targetTile.width / 2, y: targetTile.y, width: targetTile.width / 2, height: targetTile.height }
    }
  }

  return { type, targetTileId: targetTile.id, bounds }
}

/** Migrate a legacy tile (without tabIds) to the new format */
export function migrateTile(tile: TileLayout): TileLayout {
  if (tile.tabIds && tile.tabIds.length > 0) return tile
  return { ...tile, tabIds: [tile.id], activeTabId: tile.activeTabId || tile.id }
}

/** Add a tab to an existing tile's tabIds */
export function addTabToExistingTile(layout: TileLayout[], tileId: string, tabId: string): TileLayout[] {
  return layout.map(tile => {
    if (tile.id === tileId) {
      const tabIds = [...tile.tabIds, tabId]
      return { ...tile, tabIds, activeTabId: tabId }
    }
    return tile
  })
}

/** Find a tile that contains a tab for the given project */
export function findTileForProject(layout: TileLayout[], tabs: OpenTab[], projectPath: string): TileLayout | undefined {
  return layout.find(tile =>
    tile.tabIds.some(tabId => {
      const tab = tabs.find(t => t.id === tabId)
      return tab && tab.projectPath === projectPath
    })
  )
}

/** Remove a tab from its tile. If the tile becomes empty, remove the tile and reclaim space. */
export function removeTabFromTile(
  layout: TileLayout[],
  tabId: string,
  tabs: OpenTab[],
  containerWidth: number,
  containerHeight: number
): TileLayout[] {
  const tile = layout.find(t => t.tabIds.includes(tabId))
  if (!tile) return layout

  const newTabIds = tile.tabIds.filter(id => id !== tabId)
  if (newTabIds.length === 0) {
    // Tile is empty, remove it entirely and reclaim space
    return removeTilePreservingStructure(layout, tile.id, tabs, containerWidth, containerHeight)
  }

  // Update the tile with the remaining tabs
  const newActiveTabId = tile.activeTabId === tabId ? newTabIds[newTabIds.length - 1] : tile.activeTabId
  return layout.map(t => {
    if (t.id === tile.id) {
      return { ...t, tabIds: newTabIds, activeTabId: newActiveTabId }
    }
    return t
  })
}

/** Get all tab IDs across all tiles */
export function getAllTabIdsFromLayout(layout: TileLayout[]): Set<string> {
  const ids = new Set<string>()
  for (const tile of layout) {
    for (const tabId of tile.tabIds) {
      ids.add(tabId)
    }
  }
  return ids
}

export function findTilesOnDivider(
  position: number,
  isVertical: boolean,
  side: 'before' | 'after',
  layout: TileLayout[]
): TileLayout[] {
  const EPSILON = 1
  return layout.filter(tile => {
    if (isVertical) {
      if (side === 'before') {
        return Math.abs(tile.x + tile.width - position) < EPSILON
      } else {
        return Math.abs(tile.x - position) < EPSILON
      }
    } else {
      if (side === 'before') {
        return Math.abs(tile.y + tile.height - position) < EPSILON
      } else {
        return Math.abs(tile.y - position) < EPSILON
      }
    }
  })
}

/** Find tiles on a divider that form a contiguous segment with the anchor tile.
 *  For horizontal dividers, contiguity is horizontal adjacency.
 *  For vertical dividers, contiguity is vertical adjacency. */
export function findContiguousTilesOnDivider(
  position: number,
  isVertical: boolean,
  side: 'before' | 'after',
  layout: TileLayout[],
  anchorTile: TileLayout
): TileLayout[] {
  const allOnDivider = findTilesOnDivider(position, isVertical, side, layout)
  if (allOnDivider.length <= 1) return allOnDivider
  if (!allOnDivider.find(t => t.id === anchorTile.id)) return allOnDivider

  const group = new Set<string>([anchorTile.id])
  let changed = true
  while (changed) {
    changed = false
    for (const tile of allOnDivider) {
      if (group.has(tile.id)) continue
      for (const memberId of group) {
        const member = allOnDivider.find(t => t.id === memberId)!
        const adjacent = isVertical
          ? (Math.abs(tile.y + tile.height - member.y) < EPSILON || Math.abs(member.y + member.height - tile.y) < EPSILON)
          : (Math.abs(tile.x + tile.width - member.x) < EPSILON || Math.abs(member.x + member.width - tile.x) < EPSILON)
        if (adjacent) {
          group.add(tile.id)
          changed = true
          break
        }
      }
    }
  }
  return allOnDivider.filter(t => group.has(t.id))
}

/** Find tiles on the opposite side of a divider that overlap with the given group's perpendicular range */
export function findOverlappingTilesOnDivider(
  position: number,
  isVertical: boolean,
  side: 'before' | 'after',
  layout: TileLayout[],
  groupTiles: TileLayout[]
): TileLayout[] {
  if (groupTiles.length === 0) return []
  const allOnDivider = findTilesOnDivider(position, isVertical, side, layout)
  if (isVertical) {
    const minY = Math.min(...groupTiles.map(t => t.y))
    const maxY = Math.max(...groupTiles.map(t => t.y + t.height))
    return allOnDivider.filter(t => t.y + EPSILON < maxY && t.y + t.height > minY + EPSILON)
  } else {
    const minX = Math.min(...groupTiles.map(t => t.x))
    const maxX = Math.max(...groupTiles.map(t => t.x + t.width))
    return allOnDivider.filter(t => t.x + EPSILON < maxX && t.x + t.width > minX + EPSILON)
  }
}

