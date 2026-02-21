import React, { useCallback } from 'react'
import { Terminal } from '../Terminal.js'
import { ErrorBoundary } from '../ErrorBoundary.js'
import type { TileLayout, DropZone } from '../tiled-layout-utils.js'
import { computeDropZone } from '../tiled-layout-utils.js'
import type { Theme } from '../../themes.js'
import type { Api } from '../../api/types.js'
import type { OpenTab, Project, ResizeEdge } from './types.js'

interface TileTerminalProps {
  tile: TileLayout
  tabs: OpenTab[]
  activeSubTabId: string
  project: Project | undefined
  theme: Theme
  api: Api | undefined
  GAP: number
  isFocused: boolean
  isDragging: boolean
  isDropTarget: boolean
  draggedTile: string | null
  draggedSidebarProject: string | null
  effectiveLayout: TileLayout[]
  containerRef: React.RefObject<HTMLDivElement | null>
  highlightedEdges: Set<string>
  onCloseTab: (id: string) => void
  onFocusTab: (id: string) => void
  onSwitchSubTab: (tileId: string, tabId: string) => void
  onAddTab?: (projectPath: string) => void
  onDragStart: (e: React.DragEvent, tileId: string) => void
  onDragEnd: () => void
  onContainerDrop: (e: React.DragEvent) => void
  startTileResize: (e: React.MouseEvent, tileId: string, edge: ResizeEdge) => void
  setHoveredEdge: (state: { tileId: string; edge: string } | null) => void
  setDraggedSidebarProject: (id: string | null) => void
  setCurrentDropZone: (zone: DropZone | null) => void
  setDropTarget: (id: string | null) => void
}

export function TileTerminal({
  tile,
  tabs,
  activeSubTabId,
  project,
  theme,
  api,
  GAP,
  isFocused,
  isDragging,
  isDropTarget,
  draggedTile,
  draggedSidebarProject,
  effectiveLayout,
  containerRef,
  highlightedEdges,
  onCloseTab,
  onFocusTab,
  onSwitchSubTab,
  onAddTab,
  onDragStart,
  onDragEnd,
  onContainerDrop,
  startTileResize,
  setHoveredEdge,
  setDraggedSidebarProject,
  setCurrentDropZone,
  setDropTarget
}: TileTerminalProps): React.ReactElement {
  const projectColor = project?.color

  const handleSubTabClick = useCallback((tabId: string) => {
    onSwitchSubTab(tile.id, tabId)
    onFocusTab(tabId)
    // Trigger refit for the newly visible terminal
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  }, [tile.id, onSwitchSubTab, onFocusTab])

  const handleSubTabClose = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    e.preventDefault()
    onCloseTab(tabId)
  }, [onCloseTab])

  const handleAddTab = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const projectPath = tabs[0]?.projectPath
    if (projectPath && onAddTab) {
      onAddTab(projectPath)
    }
  }, [tabs, onAddTab])

  function handleTileDragOver(e: React.DragEvent): void {
    const isSidebarDrag = e.dataTransfer.types.includes('application/x-sidebar-project')
    if (isSidebarDrag) {
      e.preventDefault()
      e.stopPropagation()
      if (!draggedSidebarProject) {
        setDraggedSidebarProject('pending')
      }
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const mouseX = ((e.clientX - rect.left) / rect.width) * 100
        const mouseY = ((e.clientY - rect.top) / rect.height) * 100
        const zone = computeDropZone(effectiveLayout, null, mouseX, mouseY)
        setCurrentDropZone(zone)
        setDropTarget(zone?.targetTileId || tile.id)
      }
    }
  }

  function handleTileDrop(e: React.DragEvent): void {
    const sidebarPath = e.dataTransfer.getData('application/x-sidebar-project')
    if (sidebarPath) {
      e.preventDefault()
      e.stopPropagation()
      onContainerDrop(e)
    }
  }

  function handleOverlayDragOver(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    if (!containerRef.current) {
      setDropTarget(tile.id)
      return
    }
    const rect = containerRef.current.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * 100
    const mouseY = ((e.clientY - rect.top) / rect.height) * 100
    const zone = computeDropZone(effectiveLayout, draggedTile, mouseX, mouseY)
    setCurrentDropZone(zone)
    setDropTarget(zone?.targetTileId || tile.id)
  }

  const hasMultipleTabs = tabs.length > 1
  const activeTab = tabs.find(t => t.id === activeSubTabId) || tabs[0]

  return (
    <div
      className={`terminal-tile ${isFocused ? 'focused' : ''} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
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
      onDragOver={handleTileDragOver}
      onDrop={handleTileDrop}
    >
      <div
        className="tile-header"
        draggable
        onDragStart={(e) => onDragStart(e, tile.id)}
        onDragEnd={onDragEnd}
        style={{ cursor: 'grab', background: projectColor ? `color-mix(in srgb, ${projectColor} 35%, var(--bg-surface))` : undefined }}
      >
        {hasMultipleTabs ? (
          <>
            <div className="tile-subtabs">
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  className={`tile-subtab ${tab.id === activeSubTabId ? 'active' : ''}`}
                  onClick={() => handleSubTabClick(tab.id)}
                >
                  <span className="subtab-title" title={tab.title}>{tab.title}</span>
                  <button
                    className="subtab-close"
                    draggable={false}
                    onClick={(e) => handleSubTabClose(e, tab.id)}
                    onMouseDown={(e) => e.stopPropagation()}
                    title="Close"
                  >&times;</button>
                </div>
              ))}
            </div>
            {onAddTab && (
              <button
                className="tile-add-tab"
                draggable={false}
                onClick={handleAddTab}
                onMouseDown={(e) => e.stopPropagation()}
                title="New session"
              >+</button>
            )}
          </>
        ) : (
          <>
            <span className="tile-title" title={activeTab?.title}>{activeTab?.title}</span>
            <div className="tile-header-actions">
              {onAddTab && (
                <button
                  className="tile-add-tab"
                  draggable={false}
                  onClick={handleAddTab}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="New session"
                >+</button>
              )}
              <button
                className="tile-close"
                draggable={false}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onCloseTab(activeTab.id) }}
                onMouseDown={(e) => e.stopPropagation()}
                title="Close"
              >x</button>
            </div>
          </>
        )}
      </div>
      <div className="tile-terminal">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className="terminal-wrapper active"
            style={{ display: tab.id === activeSubTabId ? 'block' : 'none' }}
          >
            <ErrorBoundary componentName={`Terminal (${tab.title || tab.id})`}>
              <Terminal
                ptyId={tab.id}
                isActive={tab.id === activeSubTabId}
                theme={theme}
                onFocus={() => onFocusTab(tab.id)}
                projectPath={tab.projectPath}
                backend={tab.backend}
                api={api}
              />
            </ErrorBoundary>
          </div>
        ))}
      </div>
      {((draggedTile && draggedTile !== tile.id) || draggedSidebarProject) && (
        <div
          className="tile-drop-overlay"
          style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: isDropTarget
              ? (draggedSidebarProject ? 'rgba(34, 197, 94, 0.2)' : 'rgba(var(--accent-rgb), 0.3)')
              : 'transparent',
            borderRadius: 'var(--radius-sm)', pointerEvents: 'auto'
          }}
          onDragOver={handleOverlayDragOver}
          onDragLeave={(e) => { e.preventDefault(); setDropTarget(null) }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onContainerDrop(e) }}
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
}
