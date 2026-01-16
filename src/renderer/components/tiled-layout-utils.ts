export interface TileLayout {
  id: string
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
  backend?: string
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

export function generateDefaultLayout(tabs: OpenTab[], containerWidth = 1920, containerHeight = 1080): TileLayout[] {
  const count = tabs.length
  if (count === 0) return []
  if (count === 1) {
    return [{ id: tabs[0].id, x: 0, y: 0, width: 100, height: 100 }]
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
      layout.push({
        id: tabs[tabIndex].id,
        x: col * colWidth,
        y: row * rowHeight,
        width: colWidth,
        height: rowHeight
      })
      tabIndex++
    }
  }

  if (lastRowCount > 0) {
    const lastRowColWidth = 100 / lastRowCount
    for (let col = 0; col < lastRowCount; col++) {
      layout.push({
        id: tabs[tabIndex].id,
        x: col * lastRowColWidth,
        y: fullRows * rowHeight,
        width: lastRowColWidth,
        height: rowHeight
      })
      tabIndex++
    }
  }

  return layout
}

export function validateLayout(layout: TileLayout[], tabs: OpenTab[], containerWidth = 1920, containerHeight = 1080): TileLayout[] {
  for (const tile of layout) {
    if (tile.x < 0 || tile.y < 0 ||
        tile.x + tile.width > 100.5 || tile.y + tile.height > 100.5 ||
        tile.width < 5 || tile.height < 5) {
      console.warn('Detected out-of-bounds tile, resetting to default layout', tile)
      return generateDefaultLayout(tabs, containerWidth, containerHeight)
    }
  }

  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      if (tilesOverlap(layout[i], layout[j])) {
        console.warn('Detected overlapping tiles, resetting to default layout')
        return generateDefaultLayout(tabs, containerWidth, containerHeight)
      }
    }
  }
  return layout
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

  if (isHorizontal) {
    const halfHeight = target.height / 2
    const topTileId = direction === 'top' ? newTileId : targetTileId
    const bottomTileId = direction === 'bottom' ? newTileId : targetTileId
    newLayout.push(
      { id: topTileId, x: target.x, y: target.y, width: target.width, height: halfHeight },
      { id: bottomTileId, x: target.x, y: target.y + halfHeight, width: target.width, height: halfHeight }
    )
  } else {
    const halfWidth = target.width / 2
    const leftTileId = direction === 'left' ? newTileId : targetTileId
    const rightTileId = direction === 'right' ? newTileId : targetTileId
    newLayout.push(
      { id: leftTileId, x: target.x, y: target.y, width: halfWidth, height: target.height },
      { id: rightTileId, x: target.x + halfWidth, y: target.y, width: halfWidth, height: target.height }
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
    return [{ id: newTileId, x: 0, y: 0, width: 100, height: 100 }]
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
    return [{ id: newTileId, x: 0, y: 0, width: 100, height: 100 }]
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

  updatedLayout.push({
    id: newTileId,
    x: currentX,
    y: shortestRow.y,
    width: newWidth,
    height: shortestRow.height
  })

  return updatedLayout
}

export function computeDropZone(
  layout: TileLayout[],
  draggedTileId: string,
  mouseX: number,
  mouseY: number
): DropZone | null {
  const EDGE_THRESHOLD = 0.2

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

  if (relY < EDGE_THRESHOLD) {
    type = 'split-top'
    bounds = { x: targetTile.x, y: targetTile.y, width: targetTile.width, height: targetTile.height / 2 }
  } else if (relY > 1 - EDGE_THRESHOLD) {
    type = 'split-bottom'
    bounds = { x: targetTile.x, y: targetTile.y + targetTile.height / 2, width: targetTile.width, height: targetTile.height / 2 }
  } else if (relX < EDGE_THRESHOLD) {
    type = 'split-left'
    bounds = { x: targetTile.x, y: targetTile.y, width: targetTile.width / 2, height: targetTile.height }
  } else if (relX > 1 - EDGE_THRESHOLD) {
    type = 'split-right'
    bounds = { x: targetTile.x + targetTile.width / 2, y: targetTile.y, width: targetTile.width / 2, height: targetTile.height }
  }

  return { type, targetTileId: targetTile.id, bounds }
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

