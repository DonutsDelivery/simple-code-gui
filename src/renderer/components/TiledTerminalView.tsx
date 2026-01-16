import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Terminal } from './Terminal.js'
import { Theme } from '../themes.js'
import {
  TileLayout,
  OpenTab,
  DropZone,
  DropZoneType,
  generateDefaultLayout,
  validateLayout,
  removeTilePreservingStructure,
  splitTile,
  addTileToLayout,
  computeDropZone,
  findTilesOnDivider,
  MIN_SIZE,
} from './tiled-layout-utils.js'

export type { TileLayout } from './tiled-layout-utils.js'

interface Project {
  path: string
  name: string
  color?: string
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
  const containerSizeRef = useRef({ width: 1920, height: 1080 })

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
    tilesLeftOfRightDivider: TileLayout[]
    tilesRightOfRightDivider: TileLayout[]
    tilesLeftOfLeftDivider: TileLayout[]
    tilesRightOfLeftDivider: TileLayout[]
    tilesAboveBottomDivider: TileLayout[]
    tilesBelowBottomDivider: TileLayout[]
    tilesAboveTopDivider: TileLayout[]
    tilesBelowTopDivider: TileLayout[]
    rightDividerPos: number
    leftDividerPos: number
    bottomDividerPos: number
    topDividerPos: number
  } | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<{ tileId: string; edge: string } | null>(null)

  const effectiveLayoutRef = useRef<TileLayout[]>([])
  const onLayoutChangeRef = useRef(onLayoutChange)
  onLayoutChangeRef.current = onLayoutChange

  const activeTabIdRef = useRef<string | null>(tabs.length > 0 ? tabs[tabs.length - 1].id : null)

  const effectiveLayout = useMemo(() => {
    const { width, height } = containerSizeRef.current

    if (layout.length === 0) {
      return generateDefaultLayout(tabs, width, height)
    }

    const layoutIds = new Set(layout.map(l => l.id))
    const tabIds = new Set(tabs.map(t => t.id))
    const addedTabs = tabs.filter(t => !layoutIds.has(t.id))
    const removedIds = layout.filter(l => !tabIds.has(l.id)).map(l => l.id)

    if (addedTabs.length === 0 && removedIds.length === 0) {
      return validateLayout(layout, tabs, width, height)
    }

    let newLayout = [...layout]

    for (const removedId of removedIds) {
      newLayout = removeTilePreservingStructure(newLayout, removedId, tabs, width, height)
    }

    for (const addedTab of addedTabs) {
      const existingIds = newLayout.map(l => l.id)
      const activeId = existingIds.length > 0 ? existingIds[existingIds.length - 1] : null
      newLayout = addTileToLayout(newLayout, addedTab.id, activeId, width, height)
    }

    if (tabs.length > 0) {
      activeTabIdRef.current = tabs[tabs.length - 1].id
    }

    return validateLayout(newLayout, tabs, width, height)
  }, [layout, tabs])

  effectiveLayoutRef.current = effectiveLayout

  useEffect(() => {
    const layoutIds = new Set(layout.map(l => l.id))
    const effectiveIds = new Set(effectiveLayout.map(l => l.id))
    const idsMatch = layoutIds.size === effectiveIds.size && [...layoutIds].every(id => effectiveIds.has(id))

    if (!idsMatch) {
      onLayoutChange(effectiveLayout)
    }
  }, [effectiveLayout, layout, onLayoutChange])

  const getHighlightedEdges = useCallback((hovered: { tileId: string; edge: string } | null): Set<string> => {
    const highlighted = new Set<string>()
    if (!hovered) return highlighted

    const tile = effectiveLayout.find(t => t.id === hovered.tileId)
    if (!tile) return highlighted

    highlighted.add(`${hovered.tileId}-${hovered.edge}`)

    const edges = hovered.edge.includes('-') ? hovered.edge.split('-') : [hovered.edge]
    const EPSILON = 0.5

    function hasVerticalOverlap(a: TileLayout, b: TileLayout): boolean {
      return a.y < b.y + b.height - EPSILON && a.y + a.height > b.y + EPSILON
    }

    function hasHorizontalOverlap(a: TileLayout, b: TileLayout): boolean {
      return a.x < b.x + b.width - EPSILON && a.x + a.width > b.x + EPSILON
    }

    for (const edgeDir of edges) {
      for (const other of effectiveLayout) {
        if (other.id === tile.id) continue

        switch (edgeDir) {
          case 'right':
            if (Math.abs(other.x - (tile.x + tile.width)) < EPSILON && hasVerticalOverlap(tile, other)) {
              highlighted.add(`${other.id}-left`)
            }
            break
          case 'left':
            if (Math.abs(other.x + other.width - tile.x) < EPSILON && hasVerticalOverlap(tile, other)) {
              highlighted.add(`${other.id}-right`)
            }
            break
          case 'bottom':
            if (Math.abs(other.y - (tile.y + tile.height)) < EPSILON && hasHorizontalOverlap(tile, other)) {
              highlighted.add(`${other.id}-top`)
            }
            break
          case 'top':
            if (Math.abs(other.y + other.height - tile.y) < EPSILON && hasHorizontalOverlap(tile, other)) {
              highlighted.add(`${other.id}-bottom`)
            }
            break
        }
      }
    }

    return highlighted
  }, [effectiveLayout])

  const highlightedEdges = getHighlightedEdges(hoveredEdge)

  const handleDragStart = (e: React.DragEvent, tileId: string) => {
    e.dataTransfer.setData('text/plain', tileId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggedTile(tileId)
  }

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

  const handleContainerDragLeave = (e: React.DragEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const { clientX, clientY } = e
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        setCurrentDropZone(null)
        setDropTarget(null)
      }
    }
  }

  const applyDropZone = useCallback((layout: TileLayout[], draggedId: string, zone: DropZone): TileLayout[] => {
    const { width, height } = containerSizeRef.current

    if (zone.type === 'swap') {
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

    const direction = zone.type.replace('split-', '') as 'top' | 'bottom' | 'left' | 'right'
    const withoutDragged = removeTilePreservingStructure(layout, draggedId, tabs, width, height)
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

  const handleDragEnd = () => {
    setDraggedTile(null)
    setDropTarget(null)
    setCurrentDropZone(null)
  }

  const startTileResize = (e: React.MouseEvent, tileId: string, edge: 'right' | 'bottom' | 'left' | 'top' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
    e.preventDefault()
    e.stopPropagation()
    const tile = effectiveLayout.find(t => t.id === tileId)
    if (tile) {
      const rightDivider = tile.x + tile.width
      const leftDivider = tile.x
      const bottomDivider = tile.y + tile.height
      const topDivider = tile.y

      setTileResizing({
        tileId,
        edge,
        startX: e.clientX,
        startY: e.clientY,
        startLayout: { ...tile },
        tilesLeftOfRightDivider: findTilesOnDivider(rightDivider, true, 'before', effectiveLayout),
        tilesRightOfRightDivider: findTilesOnDivider(rightDivider, true, 'after', effectiveLayout),
        tilesLeftOfLeftDivider: findTilesOnDivider(leftDivider, true, 'before', effectiveLayout),
        tilesRightOfLeftDivider: findTilesOnDivider(leftDivider, true, 'after', effectiveLayout),
        tilesAboveBottomDivider: findTilesOnDivider(bottomDivider, false, 'before', effectiveLayout),
        tilesBelowBottomDivider: findTilesOnDivider(bottomDivider, false, 'after', effectiveLayout),
        tilesAboveTopDivider: findTilesOnDivider(topDivider, false, 'before', effectiveLayout),
        tilesBelowTopDivider: findTilesOnDivider(topDivider, false, 'after', effectiveLayout),
        rightDividerPos: rightDivider,
        leftDividerPos: leftDivider,
        bottomDividerPos: bottomDivider,
        topDividerPos: topDivider
      })
    }
  }

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

      const mouseXPercent = ((e.clientX - rect.left) / rect.width) * 100
      const mouseYPercent = ((e.clientY - rect.top) / rect.height) * 100

      const tileUpdates = new Map<string, TileLayout>()

      const moveVerticalDivider = (originalPos: number, tilesLeft: TileLayout[], tilesRight: TileLayout[]) => {
        if (originalPos < 1 || originalPos > 99) return
        let minPos = MIN_SIZE
        let maxPos = 100 - MIN_SIZE
        tilesLeft.forEach(tile => { minPos = Math.max(minPos, tile.x + MIN_SIZE) })
        tilesRight.forEach(tile => { maxPos = Math.min(maxPos, tile.x + tile.width - MIN_SIZE) })
        const newPos = Math.max(minPos, Math.min(maxPos, mouseXPercent))

        tilesLeft.forEach(tile => {
          const currentTile = currentLayout.find(t => t.id === tile.id) || tile
          const existing = tileUpdates.get(tile.id) || { ...currentTile }
          existing.width = newPos - tile.x
          tileUpdates.set(tile.id, existing)
        })
        tilesRight.forEach(tile => {
          const currentTile = currentLayout.find(t => t.id === tile.id) || tile
          const existing = tileUpdates.get(tile.id) || { ...currentTile }
          const originalRight = tile.x + tile.width
          existing.x = newPos
          existing.width = originalRight - newPos
          tileUpdates.set(tile.id, existing)
        })
      }

      const moveHorizontalDivider = (originalPos: number, tilesAbove: TileLayout[], tilesBelow: TileLayout[]) => {
        if (originalPos < 1 || originalPos > 99) return
        let minPos = MIN_SIZE
        let maxPos = 100 - MIN_SIZE
        tilesAbove.forEach(tile => { minPos = Math.max(minPos, tile.y + MIN_SIZE) })
        tilesBelow.forEach(tile => { maxPos = Math.min(maxPos, tile.y + tile.height - MIN_SIZE) })
        const newPos = Math.max(minPos, Math.min(maxPos, mouseYPercent))

        tilesAbove.forEach(tile => {
          const currentTile = currentLayout.find(t => t.id === tile.id) || tile
          const existing = tileUpdates.get(tile.id) || { ...currentTile }
          existing.height = newPos - tile.y
          tileUpdates.set(tile.id, existing)
        })
        tilesBelow.forEach(tile => {
          const currentTile = currentLayout.find(t => t.id === tile.id) || tile
          const existing = tileUpdates.get(tile.id) || { ...currentTile }
          const originalBottom = tile.y + tile.height
          existing.y = newPos
          existing.height = originalBottom - newPos
          tileUpdates.set(tile.id, existing)
        })
      }

      switch (edge) {
        case 'right':
          moveVerticalDivider(rightDividerPos, tilesLeftOfRightDivider, tilesRightOfRightDivider)
          break
        case 'left':
          moveVerticalDivider(leftDividerPos, tilesLeftOfLeftDivider, tilesRightOfLeftDivider)
          break
        case 'bottom':
          moveHorizontalDivider(bottomDividerPos, tilesAboveBottomDivider, tilesBelowBottomDivider)
          break
        case 'top':
          moveHorizontalDivider(topDividerPos, tilesAboveTopDivider, tilesBelowTopDivider)
          break
        case 'top-left':
          moveHorizontalDivider(topDividerPos, tilesAboveTopDivider, tilesBelowTopDivider)
          moveVerticalDivider(leftDividerPos, tilesLeftOfLeftDivider, tilesRightOfLeftDivider)
          break
        case 'top-right':
          moveHorizontalDivider(topDividerPos, tilesAboveTopDivider, tilesBelowTopDivider)
          moveVerticalDivider(rightDividerPos, tilesLeftOfRightDivider, tilesRightOfRightDivider)
          break
        case 'bottom-left':
          moveHorizontalDivider(bottomDividerPos, tilesAboveBottomDivider, tilesBelowBottomDivider)
          moveVerticalDivider(leftDividerPos, tilesLeftOfLeftDivider, tilesRightOfLeftDivider)
          break
        case 'bottom-right':
          moveHorizontalDivider(bottomDividerPos, tilesAboveBottomDivider, tilesBelowBottomDivider)
          moveVerticalDivider(rightDividerPos, tilesLeftOfRightDivider, tilesRightOfRightDivider)
          break
      }

      const newLayout = currentLayout.map(tile => tileUpdates.get(tile.id) || tile)
      onLayoutChangeRef.current(newLayout)
    }

    const handleTileResizeUp = () => {
      setTileResizing(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    function getCursorForEdge(edge: string): string {
      switch (edge) {
        case 'right':
        case 'left':
          return 'ew-resize'
        case 'top':
        case 'bottom':
          return 'ns-resize'
        case 'top-left':
        case 'bottom-right':
          return 'nwse-resize'
        case 'top-right':
        case 'bottom-left':
          return 'nesw-resize'
        default:
          return 'default'
      }
    }

    const cursor = getCursorForEdge(tileResizing.edge)

    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleTileResizeMove)
    window.addEventListener('mouseup', handleTileResizeUp)

    return () => {
      window.removeEventListener('mousemove', handleTileResizeMove)
      window.removeEventListener('mouseup', handleTileResizeUp)
    }
  }, [tileResizing])

  if (tabs.length === 0) return null

  const GAP = 4
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
      style={{ flex: 1, padding: `${GAP}px`, overflow: 'hidden', background: 'var(--bg-base)', position: 'relative' }}
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
              background: projectColor ? `color-mix(in srgb, ${projectColor} 20%, var(--bg-elevated))` : 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              minHeight: 0
            }}
          >
            <div
              className="tile-header"
              draggable
              onDragStart={(e) => handleDragStart(e, tile.id)}
              onDragEnd={handleDragEnd}
              style={{ cursor: 'grab', background: projectColor ? `color-mix(in srgb, ${projectColor} 35%, var(--bg-surface))` : undefined }}
            >
              <span className="tile-title" title={tab.title}>{tab.title}</span>
              <button
                className="tile-close"
                draggable={false}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onCloseTab(tab.id) }}
                onMouseDown={(e) => e.stopPropagation()}
                title="Close"
              >×</button>
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
            {draggedTile && draggedTile !== tile.id && (
              <div
                className="tile-drop-overlay"
                style={{
                  position: 'absolute', inset: 0, zIndex: 50,
                  background: isDropTarget ? 'rgba(var(--accent-rgb), 0.3)' : 'transparent',
                  borderRadius: 'var(--radius-sm)', pointerEvents: 'auto'
                }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget(tile.id) }}
                onDragLeave={(e) => { e.preventDefault(); setDropTarget(null) }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleContainerDrop(e) }}
              />
            )}
            <div className={`tile-edge-resize tile-edge-left ${highlightedEdges.has(`${tile.id}-left`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'left')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'left' })}
              onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
            <div className={`tile-edge-resize tile-edge-right ${highlightedEdges.has(`${tile.id}-right`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'right')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'right' })}
              onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
            <div className={`tile-edge-resize tile-edge-top ${highlightedEdges.has(`${tile.id}-top`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'top')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'top' })}
              onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
            <div className={`tile-edge-resize tile-edge-bottom ${highlightedEdges.has(`${tile.id}-bottom`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'bottom')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'bottom' })}
              onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
            <div className={`tile-corner-resize tile-corner-top-left ${highlightedEdges.has(`${tile.id}-top`) || highlightedEdges.has(`${tile.id}-left`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'top-left')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'top-left' })}
              onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
            <div className={`tile-corner-resize tile-corner-top-right ${highlightedEdges.has(`${tile.id}-top`) || highlightedEdges.has(`${tile.id}-right`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'top-right')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'top-right' })}
              onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
            <div className={`tile-corner-resize tile-corner-bottom-left ${highlightedEdges.has(`${tile.id}-bottom`) || highlightedEdges.has(`${tile.id}-left`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'bottom-left')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'bottom-left' })}
              onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
            <div className={`tile-corner-resize tile-corner-bottom-right ${highlightedEdges.has(`${tile.id}-bottom`) || highlightedEdges.has(`${tile.id}-right`) ? 'highlighted' : ''}`}
              onMouseDown={(e) => startTileResize(e, tile.id, 'bottom-right')}
              onMouseEnter={() => setHoveredEdge({ tileId: tile.id, edge: 'bottom-right' })}
              onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
          </div>
        )
      })}

      {draggedTile && currentDropZone && (
        <div
          className="drop-zone-overlay"
          style={{
            position: 'absolute',
            left: `calc(${currentDropZone.bounds.x}% + ${GAP}px)`,
            top: `calc(${currentDropZone.bounds.y}% + ${GAP}px)`,
            width: `calc(${currentDropZone.bounds.width}% - ${GAP}px)`,
            height: `calc(${currentDropZone.bounds.height}% - ${GAP}px)`,
            background: currentDropZone.type === 'swap' ? 'rgba(var(--accent-rgb), 0.3)' : 'rgba(59, 130, 246, 0.35)',
            border: '2px dashed var(--accent)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', zIndex: 1000, transition: 'all 100ms ease'
          }}
        >
          <span className="drop-zone-label" style={{
            fontSize: '13px', fontWeight: 600, color: 'white',
            textShadow: '0 1px 3px rgba(0,0,0,0.6)', background: 'rgba(0,0,0,0.5)',
            padding: '4px 10px', borderRadius: '4px'
          }}>
            {dropZoneLabels[currentDropZone.type]}
          </span>
        </div>
      )}
    </div>
  )
}
