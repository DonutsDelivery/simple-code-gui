import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Terminal } from './Terminal'
import { Theme } from '../themes'

export interface TileLayout {
  id: string
  x: number      // Left position as percentage (0-100)
  y: number      // Top position as percentage (0-100)
  width: number  // Width as percentage (0-100)
  height: number // Height as percentage (0-100)
}

interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  backend?: string
}

interface Project {
  path: string
  name: string
  color?: string
}

// Drop zone types for drag-and-drop rearrangement
type DropZoneType =
  | 'swap'              // Center of tile - swap positions
  | 'split-top'         // Top edge - split tile horizontally, new above
  | 'split-bottom'      // Bottom edge - split tile horizontally, new below
  | 'split-left'        // Left edge - split tile vertically, new left
  | 'split-right'       // Right edge - split tile vertically, new right

interface DropZone {
  type: DropZoneType
  targetTileId: string
  bounds: { x: number; y: number; width: number; height: number }
}

// Row structure for layout analysis
interface TileRow {
  y: number
  height: number
  tiles: TileLayout[]
}

interface TiledTerminalViewProps {
  tabs: OpenTab[]
  projects: Project[]
  theme: Theme
  onCloseTab: (id: string) => void
  onFocusTab: (id: string) => void
  layout: TileLayout[]
  onLayoutChange: (layout: TileLayout[]) => void
}

// Check if two tiles overlap
function tilesOverlap(a: TileLayout, b: TileLayout): boolean {
  const overlapX = a.x < b.x + b.width && a.x + a.width > b.x
  const overlapY = a.y < b.y + b.height && a.y + a.height > b.y
  return overlapX && overlapY
}

// Validate and fix overlapping or out-of-bounds tiles by resetting to default layout if needed
function validateLayout(layout: TileLayout[], tabs: OpenTab[], containerWidth = 1920, containerHeight = 1080): TileLayout[] {
  // Check for any tiles outside the viewport (0-100%)
  for (const tile of layout) {
    if (tile.x < 0 || tile.y < 0 ||
        tile.x + tile.width > 100.5 || tile.y + tile.height > 100.5 ||
        tile.width < 5 || tile.height < 5) {
      console.warn('Detected out-of-bounds tile, resetting to default layout', tile)
      return generateDefaultLayout(tabs, containerWidth, containerHeight)
    }
  }

  // Check for any overlapping tiles
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      if (tilesOverlap(layout[i], layout[j])) {
        // Found overlap - return fresh default layout
        console.warn('Detected overlapping tiles, resetting to default layout')
        return generateDefaultLayout(tabs, containerWidth, containerHeight)
      }
    }
  }
  return layout
}

// Minimum tile size in percentage
const MIN_SIZE = 10
const EPSILON = 1 // Tolerance for comparing positions

// Detect rows by grouping tiles with same y position and height
function detectRows(layout: TileLayout[]): TileRow[] {
  const rowMap = new Map<string, TileLayout[]>()

  for (const tile of layout) {
    // Create a key based on y position and height (rounded to avoid float issues)
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

// Find adjacent tile that can expand into removed space
function findAdjacentTile(layout: TileLayout[], removed: TileLayout): TileLayout | null {
  // Check right neighbor (tiles whose left edge touches our right edge)
  const rightNeighbor = layout.find(t =>
    Math.abs(t.x - (removed.x + removed.width)) < EPSILON &&
    t.y < removed.y + removed.height + EPSILON &&
    t.y + t.height > removed.y - EPSILON
  )
  if (rightNeighbor) return rightNeighbor

  // Check bottom neighbor
  const bottomNeighbor = layout.find(t =>
    Math.abs(t.y - (removed.y + removed.height)) < EPSILON &&
    t.x < removed.x + removed.width + EPSILON &&
    t.x + t.width > removed.x - EPSILON
  )
  if (bottomNeighbor) return bottomNeighbor

  // Check left neighbor
  const leftNeighbor = layout.find(t =>
    Math.abs(t.x + t.width - removed.x) < EPSILON &&
    t.y < removed.y + removed.height + EPSILON &&
    t.y + t.height > removed.y - EPSILON
  )
  if (leftNeighbor) return leftNeighbor

  // Check top neighbor
  const topNeighbor = layout.find(t =>
    Math.abs(t.y + t.height - removed.y) < EPSILON &&
    t.x < removed.x + removed.width + EPSILON &&
    t.x + t.width > removed.x - EPSILON
  )
  return topNeighbor || null
}

// Expand tile to fill removed tile's space
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

// Remove a tile while preserving the layout structure
function removeTilePreservingStructure(
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

  // Find tiles in the same row (same y and height within tolerance)
  const sameRow = remaining.filter(t =>
    Math.abs(t.y - removed.y) < EPSILON &&
    Math.abs(t.height - removed.height) < EPSILON
  )

  // Find tiles in the same column (same x and width within tolerance)
  const sameColumn = remaining.filter(t =>
    Math.abs(t.x - removed.x) < EPSILON &&
    Math.abs(t.width - removed.width) < EPSILON
  )

  // Try horizontal expansion first (same row tiles expand)
  if (sameRow.length > 0) {
    const extraWidthPerTile = removed.width / sameRow.length
    const sortedRow = [...sameRow].sort((a, b) => a.x - b.x)

    // Calculate the starting x position (either removed tile's x or first tile's x)
    const rowStartX = Math.min(removed.x, sortedRow[0].x)

    // Build a map of new positions based on sorted order
    const newPositions = new Map<string, { x: number; width: number }>()
    let currentX = rowStartX
    for (const tile of sortedRow) {
      const newWidth = tile.width + extraWidthPerTile
      newPositions.set(tile.id, { x: currentX, width: newWidth })
      currentX += newWidth
    }

    return remaining.map(t => {
      const newPos = newPositions.get(t.id)
      if (newPos) {
        return { ...t, x: newPos.x, width: newPos.width }
      }
      return t
    })
  }

  // Try vertical expansion (same column tiles expand)
  if (sameColumn.length > 0) {
    const extraHeightPerTile = removed.height / sameColumn.length
    const sortedCol = [...sameColumn].sort((a, b) => a.y - b.y)

    const colStartY = Math.min(removed.y, sortedCol[0].y)

    // Build a map of new positions based on sorted order
    const newPositions = new Map<string, { y: number; height: number }>()
    let currentY = colStartY
    for (const tile of sortedCol) {
      const newHeight = tile.height + extraHeightPerTile
      newPositions.set(tile.id, { y: currentY, height: newHeight })
      currentY += newHeight
    }

    return remaining.map(t => {
      const newPos = newPositions.get(t.id)
      if (newPos) {
        return { ...t, y: newPos.y, height: newPos.height }
      }
      return t
    })
  }

  // Find adjacent tile to expand into removed space
  const adjacent = findAdjacentTile(remaining, removed)
  if (adjacent) {
    return remaining.map(t => {
      if (t.id === adjacent.id) {
        return expandToFill(t, removed)
      }
      return t
    })
  }

  // Fallback: regenerate layout
  const remainingTabs = tabs.filter(t => t.id !== removedTileId)
  return generateDefaultLayout(remainingTabs, containerWidth, containerHeight)
}

// Split a tile to make room for a new tile
function splitTile(
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

// Add a new tile to the layout
function addTileToLayout(
  layout: TileLayout[],
  newTileId: string,
  activeTabId: string | null,
  containerWidth: number,
  containerHeight: number
): TileLayout[] {
  if (layout.length === 0) {
    return [{ id: newTileId, x: 0, y: 0, width: 100, height: 100 }]
  }

  // Try to split the active tile
  if (activeTabId) {
    const activeTile = layout.find(t => t.id === activeTabId)
    if (activeTile) {
      // Prefer horizontal split if tile is wide, vertical if tall
      const tileAspect = (activeTile.width / 100 * containerWidth) / (activeTile.height / 100 * containerHeight)
      const direction = tileAspect > 1 ? 'right' : 'bottom'
      return splitTile(layout, activeTabId, newTileId, direction)
    }
  }

  // Fallback: find the row with fewest tiles and add there
  const rows = detectRows(layout)
  if (rows.length === 0) {
    return [{ id: newTileId, x: 0, y: 0, width: 100, height: 100 }]
  }

  const shortestRow = rows.reduce((min, row) =>
    row.tiles.length < min.tiles.length ? row : min
  )

  // Add to shortest row by shrinking existing tiles
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

// Compute the active drop zone based on mouse position
function computeDropZone(
  layout: TileLayout[],
  draggedTileId: string,
  mouseX: number,
  mouseY: number
): DropZone | null {
  const EDGE_THRESHOLD = 0.2 // 20% of tile dimension triggers edge zone

  // Find tile under cursor (excluding dragged tile)
  const targetTile = layout.find(t =>
    t.id !== draggedTileId &&
    mouseX >= t.x && mouseX <= t.x + t.width &&
    mouseY >= t.y && mouseY <= t.y + t.height
  )

  if (!targetTile) return null

  // Calculate relative position within tile (0-1)
  const relX = (mouseX - targetTile.x) / targetTile.width
  const relY = (mouseY - targetTile.y) / targetTile.height

  // Determine drop zone type based on position
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

// Find optimal (rows, cols) for tiles closest to square given container aspect ratio
function findOptimalGrid(count: number, containerWidth: number, containerHeight: number): { rows: number; cols: number } {
  if (count <= 0) return { rows: 0, cols: 0 }
  if (count === 1) return { rows: 1, cols: 1 }

  let bestRows = 1
  let bestCols = count
  let bestDeviation = Infinity

  // Try all possible row counts
  for (let rows = 1; rows <= count; rows++) {
    const cols = Math.ceil(count / rows)

    // Calculate tile dimensions
    const tileWidth = containerWidth / cols
    const tileHeight = containerHeight / rows

    // Tile aspect ratio - we want it close to 1 (square)
    const tileAspect = tileWidth / tileHeight

    // Use log to make 2:1 and 1:2 have same deviation from 1:1
    const deviation = Math.abs(Math.log(tileAspect))

    if (deviation < bestDeviation) {
      bestDeviation = deviation
      bestRows = rows
      bestCols = cols
    }
  }

  return { rows: bestRows, cols: bestCols }
}

function generateDefaultLayout(tabs: OpenTab[], containerWidth = 1920, containerHeight = 1080): TileLayout[] {
  const count = tabs.length
  if (count === 0) return []
  if (count === 1) {
    return [{ id: tabs[0].id, x: 0, y: 0, width: 100, height: 100 }]
  }

  // Find optimal grid based on container aspect ratio
  const { rows, cols } = findOptimalGrid(count, containerWidth, containerHeight)

  const layout: TileLayout[] = []
  const colWidth = 100 / cols
  const rowHeight = 100 / rows

  // Calculate how many tiles are in each row
  // Last row may have fewer tiles if count doesn't divide evenly
  const fullRows = Math.floor(count / cols)
  const lastRowCount = count % cols

  let tabIndex = 0

  // Fill full rows
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

  // Fill last partial row (if any) - tiles span wider to fill the row
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

export function TiledTerminalView({
  tabs,
  projects,
  theme,
  onCloseTab,
  onFocusTab,
  layout,
  onLayoutChange
}: TiledTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Track container dimensions for adaptive tile layout (use ref to avoid unnecessary re-renders)
  const containerSizeRef = useRef({ width: 1920, height: 1080 })

  // ResizeObserver to track container dimensions
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          containerSizeRef.current = { width, height }
        }
      }
    })

    resizeObserver.observe(container)
    // Initial measurement
    const rect = container.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      containerSizeRef.current = { width: rect.width, height: rect.height }
    }

    return () => resizeObserver.disconnect()
  }, [])

  const [draggedTile, setDraggedTile] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [currentDropZone, setCurrentDropZone] = useState<DropZone | null>(null)
  const [tileResizing, setTileResizing] = useState<{
    tileId: string
    edge: 'right' | 'bottom' | 'left' | 'top' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    startX: number
    startY: number
    startLayout: TileLayout
    // Store all tiles on each side of each divider (masonry-style)
    tilesLeftOfRightDivider: TileLayout[]
    tilesRightOfRightDivider: TileLayout[]
    tilesLeftOfLeftDivider: TileLayout[]
    tilesRightOfLeftDivider: TileLayout[]
    tilesAboveBottomDivider: TileLayout[]
    tilesBelowBottomDivider: TileLayout[]
    tilesAboveTopDivider: TileLayout[]
    tilesBelowTopDivider: TileLayout[]
    // Original divider positions
    rightDividerPos: number
    leftDividerPos: number
    bottomDividerPos: number
    topDividerPos: number
  } | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<{
    tileId: string
    edge: string
  } | null>(null)

  // Refs to avoid stale closures in event handlers
  const effectiveLayoutRef = useRef<TileLayout[]>([])
  const onLayoutChangeRef = useRef(onLayoutChange)
  onLayoutChangeRef.current = onLayoutChange

  // Generate default layout if none provided, or sync with tabs
  // Track active tab for smart tile insertion
  const activeTabIdRef = useRef<string | null>(tabs.length > 0 ? tabs[tabs.length - 1].id : null)

  const effectiveLayout = React.useMemo(() => {
    const { width, height } = containerSizeRef.current

    if (layout.length === 0) {
      return generateDefaultLayout(tabs, width, height)
    }

    // Check if tab count changed (tabs added or removed)
    const layoutIds = new Set(layout.map(l => l.id))
    const tabIds = new Set(tabs.map(t => t.id))

    // Find added and removed tabs
    const addedTabs = tabs.filter(t => !layoutIds.has(t.id))
    const removedIds = layout.filter(l => !tabIds.has(l.id)).map(l => l.id)

    // No changes
    if (addedTabs.length === 0 && removedIds.length === 0) {
      return validateLayout(layout, tabs, width, height)
    }

    let newLayout = [...layout]

    // Remove tiles for closed tabs (preserving structure)
    for (const removedId of removedIds) {
      newLayout = removeTilePreservingStructure(newLayout, removedId, tabs, width, height)
    }

    // Add tiles for new tabs
    for (const addedTab of addedTabs) {
      // Use the last remaining tab as the active one to split
      const existingIds = newLayout.map(l => l.id)
      const activeId = existingIds.length > 0 ? existingIds[existingIds.length - 1] : null
      newLayout = addTileToLayout(newLayout, addedTab.id, activeId, width, height)
    }

    // Update active tab ref
    if (tabs.length > 0) {
      activeTabIdRef.current = tabs[tabs.length - 1].id
    }

    return validateLayout(newLayout, tabs, width, height)
  }, [layout, tabs])

  // Keep ref in sync with effectiveLayout
  effectiveLayoutRef.current = effectiveLayout

  // Sync effectiveLayout back to parent when it differs (e.g., after tile close/add)
  React.useEffect(() => {
    // Check if layout changed (different length or different IDs)
    const layoutIds = new Set(layout.map(l => l.id))
    const effectiveIds = new Set(effectiveLayout.map(l => l.id))
    const idsMatch = layoutIds.size === effectiveIds.size &&
      [...layoutIds].every(id => effectiveIds.has(id))

    if (!idsMatch) {
      onLayoutChange(effectiveLayout)
    }
  }, [effectiveLayout, layout, onLayoutChange])

  // Compute which edges should be highlighted (shared edges)
  const getHighlightedEdges = useCallback((hovered: { tileId: string; edge: string } | null): Set<string> => {
    const highlighted = new Set<string>()
    if (!hovered) return highlighted

    const tile = effectiveLayout.find(t => t.id === hovered.tileId)
    if (!tile) return highlighted

    // Add the hovered edge itself
    highlighted.add(`${hovered.tileId}-${hovered.edge}`)

    // Find adjacent tiles and their corresponding edges
    const edges = hovered.edge.includes('-') ? hovered.edge.split('-') : [hovered.edge]
    const EPSILON = 0.5

    edges.forEach(edgeDir => {
      effectiveLayout.forEach(other => {
        if (other.id === tile.id) return

        if (edgeDir === 'right') {
          // Our right edge touches their left edge?
          if (Math.abs(other.x - (tile.x + tile.width)) < EPSILON) {
            const overlapY = tile.y < other.y + other.height - EPSILON && tile.y + tile.height > other.y + EPSILON
            if (overlapY) highlighted.add(`${other.id}-left`)
          }
        } else if (edgeDir === 'left') {
          // Our left edge touches their right edge?
          if (Math.abs(other.x + other.width - tile.x) < EPSILON) {
            const overlapY = tile.y < other.y + other.height - EPSILON && tile.y + tile.height > other.y + EPSILON
            if (overlapY) highlighted.add(`${other.id}-right`)
          }
        } else if (edgeDir === 'bottom') {
          // Our bottom edge touches their top edge?
          if (Math.abs(other.y - (tile.y + tile.height)) < EPSILON) {
            const overlapX = tile.x < other.x + other.width - EPSILON && tile.x + tile.width > other.x + EPSILON
            if (overlapX) highlighted.add(`${other.id}-top`)
          }
        } else if (edgeDir === 'top') {
          // Our top edge touches their bottom edge?
          if (Math.abs(other.y + other.height - tile.y) < EPSILON) {
            const overlapX = tile.x < other.x + other.width - EPSILON && tile.x + tile.width > other.x + EPSILON
            if (overlapX) highlighted.add(`${other.id}-bottom`)
          }
        }
      })
    })

    return highlighted
  }, [effectiveLayout])

  const highlightedEdges = getHighlightedEdges(hoveredEdge)

  // Drag and drop handlers for reordering
  const handleDragStart = (e: React.DragEvent, tileId: string) => {
    e.dataTransfer.setData('text/plain', tileId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggedTile(tileId)
  }

  // Compute drop zone based on mouse position within container
  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    if (!draggedTile || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * 100
    const mouseY = ((e.clientY - rect.top) / rect.height) * 100

    const zone = computeDropZone(effectiveLayout, draggedTile, mouseX, mouseY)
    setCurrentDropZone(zone)
    setDropTarget(zone?.targetTileId || null)
  }, [draggedTile, effectiveLayout])

  const handleDragOver = (e: React.DragEvent, tileId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // Let container handle drop zone computation
  }

  const handleDragLeave = () => {
    // Don't clear immediately - let container handle it
  }

  const handleContainerDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the container entirely
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const { clientX, clientY } = e
      if (clientX < rect.left || clientX > rect.right ||
          clientY < rect.top || clientY > rect.bottom) {
        setCurrentDropZone(null)
        setDropTarget(null)
      }
    }
  }

  // Apply drop zone action
  const applyDropZone = useCallback((
    layout: TileLayout[],
    draggedId: string,
    zone: DropZone
  ): TileLayout[] => {
    const { width, height } = containerSizeRef.current

    if (zone.type === 'swap') {
      // Existing swap logic - swap positions AND sizes
      const sourceLayout = layout.find(t => t.id === draggedId)
      const targetLayout = layout.find(t => t.id === zone.targetTileId)

      if (sourceLayout && targetLayout) {
        return layout.map(tile => {
          if (tile.id === draggedId) {
            return { ...tile, x: targetLayout.x, y: targetLayout.y, width: targetLayout.width, height: targetLayout.height }
          }
          if (tile.id === zone.targetTileId) {
            return { ...tile, x: sourceLayout.x, y: sourceLayout.y, width: sourceLayout.width, height: sourceLayout.height }
          }
          return tile
        })
      }
      return layout
    }

    // For split operations: remove dragged tile preserving structure, then split target
    const direction = zone.type.replace('split-', '') as 'top' | 'bottom' | 'left' | 'right'

    // Remove dragged tile from its original position
    const withoutDragged = removeTilePreservingStructure(layout, draggedId, tabs, width, height)

    // Split target tile to make room for dragged tile
    return splitTile(withoutDragged, zone.targetTileId, draggedId, direction)
  }, [tabs])

  const handleContainerDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const sourceTileId = e.dataTransfer.getData('text/plain')

    if (sourceTileId && currentDropZone) {
      const newLayout = applyDropZone(effectiveLayout, sourceTileId, currentDropZone)
      const validatedLayout = validateLayout(newLayout, tabs)
      onLayoutChange(validatedLayout)
    }

    setDraggedTile(null)
    setDropTarget(null)
    setCurrentDropZone(null)
  }, [currentDropZone, effectiveLayout, tabs, onLayoutChange, applyDropZone])

  const handleDrop = (e: React.DragEvent, _targetTileId: string) => {
    // Let container handle the drop with drop zone logic
    handleContainerDrop(e)
  }

  const handleDragEnd = () => {
    setDraggedTile(null)
    setDropTarget(null)
    setCurrentDropZone(null)
  }

  // Find ALL tiles that have an edge at a given position (for divider-line resizing)
  // This enables masonry-like behavior where moving a divider affects all tiles on that line
  const findTilesOnDivider = useCallback((
    position: number,
    isVertical: boolean,
    side: 'before' | 'after',
    layout: TileLayout[]
  ): TileLayout[] => {
    const EPSILON = 1
    return layout.filter(tile => {
      if (isVertical) {
        // Vertical divider (left/right edges)
        if (side === 'before') {
          // Tiles whose right edge is at the divider
          return Math.abs(tile.x + tile.width - position) < EPSILON
        } else {
          // Tiles whose left edge is at the divider
          return Math.abs(tile.x - position) < EPSILON
        }
      } else {
        // Horizontal divider (top/bottom edges)
        if (side === 'before') {
          // Tiles whose bottom edge is at the divider
          return Math.abs(tile.y + tile.height - position) < EPSILON
        } else {
          // Tiles whose top edge is at the divider
          return Math.abs(tile.y - position) < EPSILON
        }
      }
    })
  }, [])

  // Tile edge resize handlers
  const startTileResize = (e: React.MouseEvent, tileId: string, edge: 'right' | 'bottom' | 'left' | 'top' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
    e.preventDefault()
    e.stopPropagation()
    const tile = effectiveLayout.find(t => t.id === tileId)
    if (tile) {
      // Calculate divider positions based on which edge is being dragged
      const rightDivider = tile.x + tile.width
      const leftDivider = tile.x
      const bottomDivider = tile.y + tile.height
      const topDivider = tile.y

      // Find all tiles on each side of each divider (masonry-style)
      setTileResizing({
        tileId,
        edge,
        startX: e.clientX,
        startY: e.clientY,
        startLayout: { ...tile },
        // For right edge: tiles whose right edge matches our right edge (same column)
        // Plus tiles whose left edge is at our right edge (tiles to our right)
        tilesLeftOfRightDivider: findTilesOnDivider(rightDivider, true, 'before', effectiveLayout),
        tilesRightOfRightDivider: findTilesOnDivider(rightDivider, true, 'after', effectiveLayout),
        // For left edge
        tilesLeftOfLeftDivider: findTilesOnDivider(leftDivider, true, 'before', effectiveLayout),
        tilesRightOfLeftDivider: findTilesOnDivider(leftDivider, true, 'after', effectiveLayout),
        // For bottom edge
        tilesAboveBottomDivider: findTilesOnDivider(bottomDivider, false, 'before', effectiveLayout),
        tilesBelowBottomDivider: findTilesOnDivider(bottomDivider, false, 'after', effectiveLayout),
        // For top edge
        tilesAboveTopDivider: findTilesOnDivider(topDivider, false, 'before', effectiveLayout),
        tilesBelowTopDivider: findTilesOnDivider(topDivider, false, 'after', effectiveLayout),
        // Store original divider positions
        rightDividerPos: rightDivider,
        leftDividerPos: leftDivider,
        bottomDividerPos: bottomDivider,
        topDividerPos: topDivider
      })
    }
  }

  // Handle tile edge resize
  useEffect(() => {
    if (!tileResizing || !containerRef.current) return

    const handleTileResizeMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const {
        edge,
        tilesLeftOfRightDivider, tilesRightOfRightDivider,
        tilesLeftOfLeftDivider, tilesRightOfLeftDivider,
        tilesAboveBottomDivider, tilesBelowBottomDivider,
        tilesAboveTopDivider, tilesBelowTopDivider,
        rightDividerPos, leftDividerPos, bottomDividerPos, topDividerPos
      } = tileResizing
      const currentLayout = effectiveLayoutRef.current

      // Convert mouse position to percentage
      const mouseXPercent = ((e.clientX - rect.left) / rect.width) * 100
      const mouseYPercent = ((e.clientY - rect.top) / rect.height) * 100

      // Build a map of tile updates
      const tileUpdates = new Map<string, TileLayout>()

      // Helper to move a vertical divider (affects x and width)
      const moveVerticalDivider = (
        originalPos: number,
        tilesLeft: TileLayout[],
        tilesRight: TileLayout[]
      ) => {
        // Don't move dividers at container edges (0% or 100%)
        if (originalPos < 1 || originalPos > 99) return

        // Calculate constraints
        let minPos = MIN_SIZE // Can't go past left edge
        let maxPos = 100 - MIN_SIZE // Can't go past right edge

        // Tiles on the left must keep MIN_SIZE width
        tilesLeft.forEach(tile => {
          minPos = Math.max(minPos, tile.x + MIN_SIZE)
        })
        // Tiles on the right must keep MIN_SIZE width
        tilesRight.forEach(tile => {
          maxPos = Math.min(maxPos, tile.x + tile.width - MIN_SIZE)
        })

        const newPos = Math.max(minPos, Math.min(maxPos, mouseXPercent))

        // Update all tiles on the left (adjust their width)
        tilesLeft.forEach(tile => {
          const currentTile = currentLayout.find(t => t.id === tile.id) || tile
          const existing = tileUpdates.get(tile.id) || { ...currentTile }
          existing.width = newPos - tile.x // Keep original x, adjust width to new divider
          tileUpdates.set(tile.id, existing)
        })

        // Update all tiles on the right (adjust their x and width)
        tilesRight.forEach(tile => {
          const currentTile = currentLayout.find(t => t.id === tile.id) || tile
          const existing = tileUpdates.get(tile.id) || { ...currentTile }
          const originalRight = tile.x + tile.width
          existing.x = newPos
          existing.width = originalRight - newPos // Keep original right edge
          tileUpdates.set(tile.id, existing)
        })
      }

      // Helper to move a horizontal divider (affects y and height)
      const moveHorizontalDivider = (
        originalPos: number,
        tilesAbove: TileLayout[],
        tilesBelow: TileLayout[]
      ) => {
        // Don't move dividers at container edges (0% or 100%)
        if (originalPos < 1 || originalPos > 99) return

        // Calculate constraints
        let minPos = MIN_SIZE
        let maxPos = 100 - MIN_SIZE

        tilesAbove.forEach(tile => {
          minPos = Math.max(minPos, tile.y + MIN_SIZE)
        })
        tilesBelow.forEach(tile => {
          maxPos = Math.min(maxPos, tile.y + tile.height - MIN_SIZE)
        })

        const newPos = Math.max(minPos, Math.min(maxPos, mouseYPercent))

        // Update all tiles above (adjust their height)
        tilesAbove.forEach(tile => {
          const currentTile = currentLayout.find(t => t.id === tile.id) || tile
          const existing = tileUpdates.get(tile.id) || { ...currentTile }
          existing.height = newPos - tile.y
          tileUpdates.set(tile.id, existing)
        })

        // Update all tiles below (adjust their y and height)
        tilesBelow.forEach(tile => {
          const currentTile = currentLayout.find(t => t.id === tile.id) || tile
          const existing = tileUpdates.get(tile.id) || { ...currentTile }
          const originalBottom = tile.y + tile.height
          existing.y = newPos
          existing.height = originalBottom - newPos
          tileUpdates.set(tile.id, existing)
        })
      }

      // Apply divider movements based on edge type
      if (edge === 'right') {
        moveVerticalDivider(rightDividerPos, tilesLeftOfRightDivider, tilesRightOfRightDivider)
      } else if (edge === 'left') {
        moveVerticalDivider(leftDividerPos, tilesLeftOfLeftDivider, tilesRightOfLeftDivider)
      } else if (edge === 'bottom') {
        moveHorizontalDivider(bottomDividerPos, tilesAboveBottomDivider, tilesBelowBottomDivider)
      } else if (edge === 'top') {
        moveHorizontalDivider(topDividerPos, tilesAboveTopDivider, tilesBelowTopDivider)
      } else if (edge === 'top-left') {
        moveHorizontalDivider(topDividerPos, tilesAboveTopDivider, tilesBelowTopDivider)
        moveVerticalDivider(leftDividerPos, tilesLeftOfLeftDivider, tilesRightOfLeftDivider)
      } else if (edge === 'top-right') {
        moveHorizontalDivider(topDividerPos, tilesAboveTopDivider, tilesBelowTopDivider)
        moveVerticalDivider(rightDividerPos, tilesLeftOfRightDivider, tilesRightOfRightDivider)
      } else if (edge === 'bottom-left') {
        moveHorizontalDivider(bottomDividerPos, tilesAboveBottomDivider, tilesBelowBottomDivider)
        moveVerticalDivider(leftDividerPos, tilesLeftOfLeftDivider, tilesRightOfLeftDivider)
      } else if (edge === 'bottom-right') {
        moveHorizontalDivider(bottomDividerPos, tilesAboveBottomDivider, tilesBelowBottomDivider)
        moveVerticalDivider(rightDividerPos, tilesLeftOfRightDivider, tilesRightOfRightDivider)
      }

      // Apply updates
      const newLayout = currentLayout.map(tile => {
        const updated = tileUpdates.get(tile.id)
        return updated || tile
      })
      onLayoutChangeRef.current(newLayout)
    }

    const handleTileResizeUp = () => {
      setTileResizing(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    let cursor = 'default'
    if (tileResizing.edge === 'right' || tileResizing.edge === 'left') {
      cursor = 'ew-resize'
    } else if (tileResizing.edge === 'top' || tileResizing.edge === 'bottom') {
      cursor = 'ns-resize'
    } else if (tileResizing.edge === 'top-left' || tileResizing.edge === 'bottom-right') {
      cursor = 'nwse-resize'
    } else if (tileResizing.edge === 'top-right' || tileResizing.edge === 'bottom-left') {
      cursor = 'nesw-resize'
    }
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleTileResizeMove)
    window.addEventListener('mouseup', handleTileResizeUp)

    return () => {
      window.removeEventListener('mousemove', handleTileResizeMove)
      window.removeEventListener('mouseup', handleTileResizeUp)
    }
  }, [tileResizing])

  if (tabs.length === 0) {
    return null
  }

  // Gap between tiles in pixels
  const GAP = 4

  // Drop zone labels for UI
  const dropZoneLabels: Record<DropZoneType, string> = {
    'swap': 'Swap',
    'split-top': 'Add Above',
    'split-bottom': 'Add Below',
    'split-left': 'Add Left',
    'split-right': 'Add Right'
  }

  return (
    <div
      ref={containerRef}
      className="terminal-tiled-custom"
      style={{
        flex: 1,
        padding: `${GAP}px`,
        overflow: 'hidden',
        background: 'var(--bg-base)',
        position: 'relative'
      }}
      onDragOver={handleContainerDragOver}
      onDragLeave={handleContainerDragLeave}
      onDrop={handleContainerDrop}
    >
      {effectiveLayout.map((tile) => {
        const tab = tabs.find(t => t.id === tile.id)
        if (!tab) return null

        const project = projects.find(p => p.path === tab.projectPath)
        const projectColor = project?.color

        const isDragging = draggedTile === tile.id
        const isDropTarget = dropTarget === tile.id

        return (
          <div
            key={tile.id}
            className={`terminal-tile ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
            style={{
              position: 'absolute',
              left: `calc(${tile.x}% + ${GAP}px)`,
              top: `calc(${tile.y}% + ${GAP}px)`,
              width: `calc(${tile.width}% - ${GAP}px)`,
              height: `calc(${tile.height}% - ${GAP}px)`,
              display: 'flex',
              flexDirection: 'column',
              background: projectColor
                ? `color-mix(in srgb, ${projectColor} 20%, var(--bg-elevated))`
                : 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              minHeight: 0
            }}
            onDragOver={(e) => handleDragOver(e, tile.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, tile.id)}
          >
            <div
              className="tile-header"
              draggable
              onDragStart={(e) => handleDragStart(e, tile.id)}
              onDragEnd={handleDragEnd}
              style={{
                cursor: 'grab',
                background: projectColor
                  ? `color-mix(in srgb, ${projectColor} 35%, var(--bg-surface))`
                  : undefined
              }}
            >
              <span className="tile-title" title={tab.title}>{tab.title}</span>
              <button
                className="tile-close"
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onCloseTab(tab.id)
                }}
                onMouseDown={(e) => e.stopPropagation()}
                title="Close"
              >
                ×
              </button>
            </div>
            <div className="tile-terminal">
              <div className="terminal-wrapper active">
                <Terminal
                  ptyId={tab.id}
                  isActive={true}
                  theme={theme}
                  onFocus={() => onFocusTab(tab.id)}
                  projectPath={tab.projectPath}
                  backend={tab.backend}
                />
              </div>
            </div>
            {/* Drop overlay - appears when dragging to make dropping easier */}
            {draggedTile && draggedTile !== tile.id && (
              <div
                className="tile-drop-overlay"
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 50,
                  background: isDropTarget ? 'rgba(var(--accent-rgb), 0.3)' : 'transparent',
                  borderRadius: 'var(--radius-sm)',
                  pointerEvents: 'auto'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropTarget(tile.id)
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  setDropTarget(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleDrop(e, tile.id)
                }}
              />
            )}
            {/* Edge resize handles */}
            <div
              className={`tile-edge-resize tile-edge-left ${highlightedEdges.has(`${tile.id}-left`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'left')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'left' })}
              onMouseLeave={() => setHoveredEdge(null)}
              title="Drag to resize"
            />
            <div
              className={`tile-edge-resize tile-edge-right ${highlightedEdges.has(`${tile.id}-right`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'right')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'right' })}
              onMouseLeave={() => setHoveredEdge(null)}
              title="Drag to resize"
            />
            <div
              className={`tile-edge-resize tile-edge-top ${highlightedEdges.has(`${tile.id}-top`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'top')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'top' })}
              onMouseLeave={() => setHoveredEdge(null)}
              title="Drag to resize"
            />
            <div
              className={`tile-edge-resize tile-edge-bottom ${highlightedEdges.has(`${tile.id}-bottom`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'bottom')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'bottom' })}
              onMouseLeave={() => setHoveredEdge(null)}
              title="Drag to resize"
            />
            {/* Corner resize handles */}
            <div
              className={`tile-corner-resize tile-corner-top-left ${highlightedEdges.has(`${tile.id}-top`) || highlightedEdges.has(`${tile.id}-left`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'top-left')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'top-left' })}
              onMouseLeave={() => setHoveredEdge(null)}
              title="Drag to resize"
            />
            <div
              className={`tile-corner-resize tile-corner-top-right ${highlightedEdges.has(`${tile.id}-top`) || highlightedEdges.has(`${tile.id}-right`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'top-right')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'top-right' })}
              onMouseLeave={() => setHoveredEdge(null)}
              title="Drag to resize"
            />
            <div
              className={`tile-corner-resize tile-corner-bottom-left ${highlightedEdges.has(`${tile.id}-bottom`) || highlightedEdges.has(`${tile.id}-left`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'bottom-left')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'bottom-left' })}
              onMouseLeave={() => setHoveredEdge(null)}
              title="Drag to resize"
            />
            <div
              className={`tile-corner-resize tile-corner-bottom-right ${highlightedEdges.has(`${tile.id}-bottom`) || highlightedEdges.has(`${tile.id}-right`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'bottom-right')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'bottom-right' })}
              onMouseLeave={() => setHoveredEdge(null)}
              title="Drag to resize"
            />
          </div>
        )
      })}

      {/* Drop zone overlay */}
      {draggedTile && currentDropZone && (
        <div
          className="drop-zone-overlay"
          style={{
            position: 'absolute',
            left: `calc(${currentDropZone.bounds.x}% + ${GAP}px)`,
            top: `calc(${currentDropZone.bounds.y}% + ${GAP}px)`,
            width: `calc(${currentDropZone.bounds.width}% - ${GAP}px)`,
            height: `calc(${currentDropZone.bounds.height}% - ${GAP}px)`,
            background: currentDropZone.type === 'swap'
              ? 'rgba(var(--accent-rgb), 0.3)'
              : 'rgba(59, 130, 246, 0.35)',
            border: '2px dashed var(--accent)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 1000,
            transition: 'all 100ms ease'
          }}
        >
          <span
            className="drop-zone-label"
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: 'white',
              textShadow: '0 1px 3px rgba(0,0,0,0.6)',
              background: 'rgba(0,0,0,0.5)',
              padding: '4px 10px',
              borderRadius: '4px'
            }}
          >
            {dropZoneLabels[currentDropZone.type]}
          </span>
        </div>
      )}

    </div>
  )
}
