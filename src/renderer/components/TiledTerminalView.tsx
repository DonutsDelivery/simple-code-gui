import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Terminal } from './Terminal'
import { Theme } from '../themes'

export interface TileLayout {
  id: string
  x: number      // Grid column (0-based)
  y: number      // Grid row (0-based)
  width: number  // Column span
  height: number // Row span
}

interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
}

interface TiledTerminalViewProps {
  tabs: OpenTab[]
  theme: Theme
  onCloseTab: (id: string) => void
  onFocusTab: (id: string) => void
  layout: TileLayout[]
  onLayoutChange: (layout: TileLayout[]) => void
}

function generateDefaultLayout(tabs: OpenTab[]): TileLayout[] {
  const count = tabs.length
  if (count === 0) return []
  if (count === 1) {
    return [{ id: tabs[0].id, x: 0, y: 0, width: 2, height: 2 }]
  }
  if (count === 2) {
    return [
      { id: tabs[0].id, x: 0, y: 0, width: 1, height: 2 },
      { id: tabs[1].id, x: 1, y: 0, width: 1, height: 2 }
    ]
  }
  if (count === 3) {
    return [
      { id: tabs[0].id, x: 0, y: 0, width: 1, height: 2 },
      { id: tabs[1].id, x: 1, y: 0, width: 1, height: 1 },
      { id: tabs[2].id, x: 1, y: 1, width: 1, height: 1 }
    ]
  }
  // 4 or more: 2x2 grid, extras wrap
  return tabs.map((tab, i) => ({
    id: tab.id,
    x: i % 2,
    y: Math.floor(i / 2),
    width: 1,
    height: 1
  }))
}

export function TiledTerminalView({
  tabs,
  theme,
  onCloseTab,
  onFocusTab,
  layout,
  onLayoutChange
}: TiledTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Track column and row sizes as fractions (default equal)
  const [colSizes, setColSizes] = useState<number[]>([1, 1])
  const [rowSizes, setRowSizes] = useState<number[]>([1, 1])

  const [dragging, setDragging] = useState<{
    type: 'col' | 'row'
    index: number  // Which divider (0 = between col 0 and 1)
    startPos: number
    startSizes: number[]
  } | null>(null)

  const [draggedTile, setDraggedTile] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  // Generate default layout if none provided, or sync with tabs
  const effectiveLayout = React.useMemo(() => {
    if (layout.length === 0) {
      return generateDefaultLayout(tabs)
    }

    // Ensure all tabs have a layout entry
    const layoutIds = new Set(layout.map(l => l.id))
    const tabIds = new Set(tabs.map(t => t.id))

    // Remove layouts for closed tabs
    let newLayout = layout.filter(l => tabIds.has(l.id))

    // Add default positions for new tabs
    const newTabs = tabs.filter(t => !layoutIds.has(t.id))
    if (newTabs.length > 0) {
      const maxY = Math.max(0, ...newLayout.map(l => l.y + l.height))
      newTabs.forEach((tab, i) => {
        newLayout.push({
          id: tab.id,
          x: i % 2,
          y: maxY + Math.floor(i / 2),
          width: 1,
          height: 1
        })
      })
    }

    return newLayout
  }, [layout, tabs])

  // Calculate grid dimensions from layout
  const gridCols = Math.max(2, ...effectiveLayout.map(t => t.x + t.width))
  const gridRows = Math.max(2, ...effectiveLayout.map(t => t.y + t.height))

  // Initialize/resize col and row sizes when grid dimensions change
  useEffect(() => {
    setColSizes(prev => {
      if (prev.length === gridCols) return prev
      const newSizes = Array(gridCols).fill(1)
      prev.forEach((size, i) => {
        if (i < gridCols) newSizes[i] = size
      })
      return newSizes
    })
  }, [gridCols])

  useEffect(() => {
    setRowSizes(prev => {
      if (prev.length === gridRows) return prev
      const newSizes = Array(gridRows).fill(1)
      prev.forEach((size, i) => {
        if (i < gridRows) newSizes[i] = size
      })
      return newSizes
    })
  }, [gridRows])

  // Handle mouse move for resize
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const delta = dragging.type === 'col'
      ? (e.clientX - dragging.startPos) / rect.width
      : (e.clientY - dragging.startPos) / rect.height

    const totalBefore = dragging.startSizes.reduce((a, b) => a + b, 0)
    const idx = dragging.index

    // Calculate new sizes - adjust the two adjacent tracks
    const newSizes = [...dragging.startSizes]
    const minSize = 0.15 // Minimum 15% of total

    const sizeChange = delta * totalBefore
    const newSize1 = Math.max(minSize, dragging.startSizes[idx] + sizeChange)
    const newSize2 = Math.max(minSize, dragging.startSizes[idx + 1] - sizeChange)

    // Only apply if both are above minimum
    if (newSize1 >= minSize && newSize2 >= minSize) {
      newSizes[idx] = newSize1
      newSizes[idx + 1] = newSize2

      if (dragging.type === 'col') {
        setColSizes(newSizes)
      } else {
        setRowSizes(newSizes)
      }
    }
  }, [dragging])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = dragging.type === 'col' ? 'ew-resize' : 'ns-resize'
      document.body.style.userSelect = 'none'
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [dragging, handleMouseMove, handleMouseUp])

  const startColResize = (e: React.MouseEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging({
      type: 'col',
      index,
      startPos: e.clientX,
      startSizes: [...colSizes]
    })
  }

  const startRowResize = (e: React.MouseEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging({
      type: 'row',
      index,
      startPos: e.clientY,
      startSizes: [...rowSizes]
    })
  }

  // Drag and drop handlers for reordering
  const handleDragStart = (e: React.DragEvent, tileId: string) => {
    e.dataTransfer.setData('text/plain', tileId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggedTile(tileId)
  }

  const handleDragOver = (e: React.DragEvent, tileId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (tileId !== draggedTile) {
      setDropTarget(tileId)
    }
  }

  const handleDragLeave = () => {
    setDropTarget(null)
  }

  const handleDrop = (e: React.DragEvent, targetTileId: string) => {
    e.preventDefault()
    const sourceTileId = e.dataTransfer.getData('text/plain')

    if (sourceTileId && sourceTileId !== targetTileId) {
      const sourceLayout = effectiveLayout.find(t => t.id === sourceTileId)
      const targetLayout = effectiveLayout.find(t => t.id === targetTileId)

      if (sourceLayout && targetLayout) {
        // Swap positions
        const newLayout = effectiveLayout.map(tile => {
          if (tile.id === sourceTileId) {
            return { ...tile, x: targetLayout.x, y: targetLayout.y }
          }
          if (tile.id === targetTileId) {
            return { ...tile, x: sourceLayout.x, y: sourceLayout.y }
          }
          return tile
        })
        onLayoutChange(newLayout)
      }
    }

    setDraggedTile(null)
    setDropTarget(null)
  }

  const handleDragEnd = () => {
    setDraggedTile(null)
    setDropTarget(null)
  }

  if (tabs.length === 0) {
    return null
  }

  // Generate grid template strings
  const gridTemplateColumns = colSizes.map(s => `${s}fr`).join(' ')
  const gridTemplateRows = rowSizes.map(s => `${s}fr`).join(' ')

  return (
    <div
      ref={containerRef}
      className="terminal-tiled-custom"
      style={{
        display: 'grid',
        gridTemplateColumns,
        gridTemplateRows,
        gap: '4px',
        flex: 1,
        padding: '4px',
        overflow: 'hidden',
        background: 'var(--bg-base)',
        position: 'relative'
      }}
    >
      {effectiveLayout.map((tile) => {
        const tab = tabs.find(t => t.id === tile.id)
        if (!tab) return null

        const isDragging = draggedTile === tile.id
        const isDropTarget = dropTarget === tile.id

        return (
          <div
            key={tile.id}
            className={`terminal-tile ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
            style={{
              gridColumn: `${tile.x + 1} / span ${tile.width}`,
              gridRow: `${tile.y + 1} / span ${tile.height}`,
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
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
              style={{ cursor: 'grab' }}
            >
              <span className="tile-title" title={tab.title}>{tab.title}</span>
              <button
                className="tile-close"
                onClick={() => onCloseTab(tab.id)}
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
                />
              </div>
            </div>
          </div>
        )
      })}

      {/* Column resize handles - between columns */}
      {colSizes.slice(0, -1).map((_, i) => {
        // Calculate position as percentage
        const leftPercent = colSizes.slice(0, i + 1).reduce((a, b) => a + b, 0) / colSizes.reduce((a, b) => a + b, 0) * 100
        return (
          <div
            key={`col-resize-${i}`}
            className="grid-resize-handle grid-resize-col"
            style={{
              position: 'absolute',
              left: `calc(${leftPercent}% - 3px)`,
              top: 0,
              width: '6px',
              height: '100%',
              cursor: 'ew-resize',
              zIndex: 50
            }}
            onMouseDown={(e) => startColResize(e, i)}
          />
        )
      })}

      {/* Row resize handles - between rows */}
      {rowSizes.slice(0, -1).map((_, i) => {
        const topPercent = rowSizes.slice(0, i + 1).reduce((a, b) => a + b, 0) / rowSizes.reduce((a, b) => a + b, 0) * 100
        return (
          <div
            key={`row-resize-${i}`}
            className="grid-resize-handle grid-resize-row"
            style={{
              position: 'absolute',
              top: `calc(${topPercent}% - 3px)`,
              left: 0,
              width: '100%',
              height: '6px',
              cursor: 'ns-resize',
              zIndex: 50
            }}
            onMouseDown={(e) => startRowResize(e, i)}
          />
        )
      })}
    </div>
  )
}
