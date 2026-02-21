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

function expandToFill(tile: TileLayout, removed: TileLayout): TileLayout {
  const newX = Math.min(tile.x, removed.x)
  const newY = Math.min(tile.y, removed.y)
  const newRight = Math.max(tile.x + tile.width, removed.x + removed.width)
  const newBottom = Math.max(tile.y + tile.height, removed.y + removed.height)

  return {
    ...tile,
    x: newX,
    y: newY,
    width: newRight - newX,
    height: newBottom - newY
  }
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
  // Group tabs by projectPath
  const groups = new Map<string, OpenTab[]>()
  for (const tab of tabs) {
    const key = tab.projectPath
    const group = groups.get(key) || []
    group.push(tab)
    groups.set(key, group)
  }

  const groupList = [...groups.values()]
  const count = groupList.length
  if (count === 0) return []
  if (count === 1) {
    const group = groupList[0]
    const tileId = group[0].id
    const tabIds = group.map(t => t.id)
    return [makeTile(tileId, 0, 0, 100, 100, tabIds, tabIds[tabIds.length - 1])]
  }

  const { rows, cols } = findOptimalGrid(count, containerWidth, containerHeight)
  const layout: TileLayout[] = []
  const colWidth = 100 / cols
  const rowHeight = 100 / rows
  const fullRows = Math.floor(count / cols)
  const lastRowCount = count % cols

  let groupIndex = 0

  for (let row = 0; row < fullRows; row++) {
    for (let col = 0; col < cols; col++) {
      const group = groupList[groupIndex]
      const tileId = group[0].id
      const tabIds = group.map(t => t.id)
      layout.push(makeTile(tileId, col * colWidth, row * rowHeight, colWidth, rowHeight, tabIds, tabIds[tabIds.length - 1]))
      groupIndex++
    }
  }

  if (lastRowCount > 0) {
    const lastRowColWidth = 100 / lastRowCount
    for (let col = 0; col < lastRowCount; col++) {
      const group = groupList[groupIndex]
      const tileId = group[0].id
      const tabIds = group.map(t => t.id)
      layout.push(makeTile(tileId, col * lastRowColWidth, fullRows * rowHeight, lastRowColWidth, rowHeight, tabIds, tabIds[tabIds.length - 1]))
      groupIndex++
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
        tile.x + tile.width > 100.5 || tile.y + tile.height > 100.5 ||
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
        console.warn('Detected overlapping tiles, resetting to default layout')
        return generateDefaultLayout(tabs, containerWidth, containerHeight)
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
    const extraWidthPerTile = removed.width / sameRow.length
    const sortedRow = [...sameRow].sort((a, b) => a.x - b.x)
    const rowStartX = Math.min(removed.x, sortedRow[0].x)
    const newPositions = new Map<string, { x: number; width: number }>()
    let currentX = rowStartX
    for (const tile of sortedRow) {
      const newWidth = tile.width + extraWidthPerTile
      newPositions.set(tile.id, { x: currentX, width: newWidth })
      currentX += newWidth
    }
    return remaining.map(t => {
      const newPos = newPositions.get(t.id)
      if (newPos) return { ...t, x: newPos.x, width: newPos.width }
      return t
    })
  }

  if (sameColumn.length > 0) {
    const extraHeightPerTile = removed.height / sameColumn.length
    const sortedCol = [...sameColumn].sort((a, b) => a.y - b.y)
    const colStartY = Math.min(removed.y, sortedCol[0].y)
    const newPositions = new Map<string, { y: number; height: number }>()
    let currentY = colStartY
    for (const tile of sortedCol) {
      const newHeight = tile.height + extraHeightPerTile
      newPositions.set(tile.id, { y: currentY, height: newHeight })
      currentY += newHeight
    }
    return remaining.map(t => {
      const newPos = newPositions.get(t.id)
      if (newPos) return { ...t, y: newPos.y, height: newPos.height }
      return t
    })
  }

  const adjacent = findAdjacentTile(remaining, removed)
  if (adjacent) {
    return remaining.map(t => {
      if (t.id === adjacent.id) return expandToFill(t, removed)
      return t
    })
  }

  const remainingTabs = tabs.filter(t => t.id !== removedTileId)
  return generateDefaultLayout(remainingTabs, containerWidth, containerHeight)
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

  if (activeTabId) {
    const activeTile = layout.find(t => t.id === activeTabId)
    if (activeTile) {
      const tileAspect = (activeTile.width / 100 * containerWidth) / (activeTile.height / 100 * containerHeight)
      const direction = tileAspect > 1 ? 'right' : 'bottom'
      return splitTile(layout, activeTabId, newTileId, direction)
    }
  }

  const rows = detectRows(layout)
  if (rows.length === 0) {
    return [makeTile(newTileId, 0, 0, 100, 100)]
  }

  const shortestRow = rows.reduce((min, row) =>
    row.tiles.length < min.tiles.length ? row : min
  )

  const rowTiles = shortestRow.tiles
  const newWidth = 100 / (rowTiles.length + 1)
  let currentX = 0

  const updatedLayout = layout.map(t => {
    const inRow = rowTiles.some(rt => rt.id === t.id)
    if (inRow) {
      const result = { ...t, x: currentX, width: newWidth }
      currentX += newWidth
      return result
    }
    return t
  })

  updatedLayout.push(makeTile(newTileId, currentX, shortestRow.y, newWidth, shortestRow.height))

  return updatedLayout
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

