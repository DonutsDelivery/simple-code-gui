import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { TileLayout, DropZone } from '../tiled-layout-utils.js'
import type { TiledTerminalViewProps, TileResizeState } from './types.js'
import { useEffectiveLayout } from './useEffectiveLayout.js'
import { useStartTileResize, useTileResizeEffect } from './useTileResizing.js'
import {
  useHandleDragStart,
  useHandleContainerDragOver,
  useHandleContainerDragLeave,
  useApplyDropZone,
  useHandleContainerDrop,
  useHandleDragEnd
} from './useTileDragDrop.js'
import { useGetHighlightedEdges, useHighlightedEdges } from './useHighlightedEdges.js'
import { usePanning } from './usePanning.js'
import { TileTerminal } from './TileTerminal.js'
import { DropZoneOverlay } from './DropZoneOverlay.js'

export type { TileLayout, DropZone } from '../tiled-layout-utils.js'
export { splitTile, addTileToLayout, addTabToExistingTile } from '../tiled-layout-utils.js'

const GAP = 4

export function TiledTerminalView({
  tabs,
  projects,
  theme,
  focusedTabId,
  onCloseTab,
  onFocusTab,
  layout,
  onLayoutChange,
  onOpenSessionAtPosition,
  onAddTab,
  onUndoCloseTab,
  api
}: TiledTerminalViewProps): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null)
  const containerSizeRef = useRef({ width: 1920, height: 1080 })
  const [viewportSize, setViewportSize] = useState({ width: 1920, height: 1080 })
  const onLayoutChangeRef = useRef(onLayoutChange)
  onLayoutChangeRef.current = onLayoutChange

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          containerSizeRef.current = { width, height }
          setViewportSize({ width, height })
        }
      }
    })

    resizeObserver.observe(container)
    const rect = container.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      containerSizeRef.current = { width: rect.width, height: rect.height }
      setViewportSize({ width: rect.width, height: rect.height })
    }

    return () => resizeObserver.disconnect()
  }, [])

  const [draggedTile, setDraggedTile] = useState<string | null>(null)
  const [draggedSidebarProject, setDraggedSidebarProject] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [currentDropZone, setCurrentDropZone] = useState<DropZone | null>(null)
  const [tileResizing, setTileResizing] = useState<TileResizeState | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<{ tileId: string; edge: string } | null>(null)

  const { effectiveLayout, effectiveLayoutRef } = useEffectiveLayout(
    layout, tabs, containerSizeRef, onLayoutChange
  )

  // Compute canvas width from tile positions
  const canvasWidth = useMemo(() => {
    if (effectiveLayout.length === 0) return viewportSize.width
    const rightmostEdge = Math.max(...effectiveLayout.map(t => t.x + t.width))
    const rightmostPx = rightmostEdge / 100 * viewportSize.width
    return Math.max(viewportSize.width, rightmostPx)
  }, [effectiveLayout, viewportSize.width])

  const { panX, isPanning, handlePanStart, clientToCanvasPercent, clientToCanvasPercentRef } = usePanning(
    containerRef, canvasWidth, viewportSize.width, viewportSize.height
  )

  // Whether tiles extend beyond the viewport
  const hasOffscreenLeft = panX > 0
  const hasOffscreenRight = canvasWidth > viewportSize.width && panX < canvasWidth - viewportSize.width

  // Ctrl+Shift+T to undo close tab
  useEffect(() => {
    if (!onUndoCloseTab) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        onUndoCloseTab()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onUndoCloseTab])

  // Force terminals to refit when tiled view mounts
  useEffect(() => {
    const triggerRefit = () => {
      window.dispatchEvent(new Event('resize'))
    }
    const timers = [
      setTimeout(triggerRefit, 100),
      setTimeout(triggerRefit, 300),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  const handleSwitchSubTab = useCallback((tileId: string, tabId: string) => {
    const newLayout = effectiveLayoutRef.current.map(tile => {
      if (tile.id === tileId) {
        return { ...tile, activeTabId: tabId }
      }
      return tile
    })
    onLayoutChange(newLayout)
  }, [effectiveLayoutRef, onLayoutChange])

  const startTileResize = useStartTileResize(effectiveLayout, setTileResizing, setHoveredEdge)
  useTileResizeEffect(tileResizing, containerRef, effectiveLayoutRef, onLayoutChangeRef, setTileResizing, clientToCanvasPercentRef)

  const dragDropActions = {
    setDraggedTile,
    setDraggedSidebarProject,
    setDropTarget,
    setCurrentDropZone
  }

  const handleDragStart = useHandleDragStart(setDraggedTile)
  const handleContainerDragOver = useHandleContainerDragOver(
    containerRef, effectiveLayout,
    { draggedTile, draggedSidebarProject },
    dragDropActions,
    clientToCanvasPercentRef
  )
  const handleContainerDragLeave = useHandleContainerDragLeave(containerRef, dragDropActions)
  const applyDropZone = useApplyDropZone(tabs, containerSizeRef)
  const handleContainerDrop = useHandleContainerDrop(
    containerRef, effectiveLayoutRef, containerSizeRef,
    tabs, onLayoutChange, applyDropZone, onOpenSessionAtPosition,
    dragDropActions,
    clientToCanvasPercentRef
  )
  const handleDragEnd = useHandleDragEnd(dragDropActions)

  const getHighlightedEdges = useGetHighlightedEdges(effectiveLayout)
  const highlightedEdges = useHighlightedEdges(hoveredEdge, tileResizing, getHighlightedEdges)

  if (tabs.length === 0) return null

  return (
    <div
      ref={containerRef}
      className={`terminal-tiled-custom${tileResizing ? ' is-resizing' : ''}${isPanning ? ' is-panning' : ''}`}
      style={{ flex: 1, padding: `${GAP}px`, overflow: 'hidden', background: 'var(--bg-base)', position: 'relative' }}
      onDragOver={handleContainerDragOver}
      onDragLeave={handleContainerDragLeave}
      onDrop={handleContainerDrop}
      onMouseDown={handlePanStart}
    >
      {tileResizing && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 200, cursor: 'inherit' }} />
      )}

      <div
        className="tile-canvas"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${canvasWidth}px`,
          height: '100%',
          transform: `translate(${-panX}px, 0)`
        }}
      >
        {effectiveLayout.map((tile) => {
          const tileTabs = tile.tabIds
            .map(id => tabs.find(t => t.id === id))
            .filter((t): t is typeof tabs[number] => t != null)

          if (tileTabs.length === 0) return null

          const activeSubTabId = tile.activeTabId && tileTabs.some(t => t.id === tile.activeTabId)
            ? tile.activeTabId
            : tileTabs[0].id

          const project = projects.find(p => p.path === tileTabs[0].projectPath)
          const isFocused = focusedTabId != null && tile.tabIds.includes(focusedTabId)

          return (
            <TileTerminal
              key={tile.id}
              tile={tile}
              tabs={tileTabs}
              activeSubTabId={activeSubTabId}
              project={project}
              theme={theme}
              api={api}
              GAP={GAP}
              isFocused={isFocused}
              isDragging={draggedTile === tile.id}
              isDropTarget={dropTarget === tile.id}
              draggedTile={draggedTile}
              draggedSidebarProject={draggedSidebarProject}
              effectiveLayout={effectiveLayout}
              containerRef={containerRef}
              highlightedEdges={highlightedEdges}
              viewportSize={viewportSize}
              clientToCanvasPercent={clientToCanvasPercent}
              onCloseTab={onCloseTab}
              onFocusTab={onFocusTab}
              onSwitchSubTab={handleSwitchSubTab}
              onAddTab={onAddTab}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onContainerDrop={handleContainerDrop}
              startTileResize={startTileResize}
              setHoveredEdge={setHoveredEdge}
              setDraggedSidebarProject={setDraggedSidebarProject}
              setCurrentDropZone={setCurrentDropZone}
              setDropTarget={setDropTarget}
            />
          )
        })}

        {(draggedTile || draggedSidebarProject) && currentDropZone && (() => {
          // Compute contextual swap label based on whether this would merge or swap
          let swapLabel: string | undefined
          if (currentDropZone.type === 'swap') {
            if (draggedSidebarProject) {
              swapLabel = 'Add as Tab'
            } else if (draggedTile) {
              const sourceTile = effectiveLayout.find(t => t.id === draggedTile)
              const targetTile = effectiveLayout.find(t => t.id === currentDropZone.targetTileId)
              if (sourceTile && targetTile) {
                const sourceProject = sourceTile.tabIds
                  .map(id => tabs.find(t => t.id === id)?.projectPath)
                  .find(p => p != null)
                const targetProject = targetTile.tabIds
                  .map(id => tabs.find(t => t.id === id)?.projectPath)
                  .find(p => p != null)
                swapLabel = sourceProject && sourceProject === targetProject ? 'Add as Tab' : 'Swap'
              }
            }
          }
          return (
            <DropZoneOverlay
              currentDropZone={currentDropZone}
              draggedSidebarProject={draggedSidebarProject}
              swapLabel={swapLabel}
              GAP={GAP}
              viewportSize={viewportSize}
            />
          )
        })()}
      </div>

      {hasOffscreenLeft && <div className="pan-indicator-left" />}
      {hasOffscreenRight && <div className="pan-indicator-right" />}

      {onUndoCloseTab && (
        <button
          className="tile-undo-close"
          onClick={onUndoCloseTab}
          title="Reopen closed tab (Ctrl+Shift+T)"
        >
          Undo close
        </button>
      )}
    </div>
  )
}

export default TiledTerminalView
