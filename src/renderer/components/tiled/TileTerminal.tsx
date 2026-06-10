import React, { useCallback, useState, useRef } from 'react'
import { Terminal } from '../Terminal.js'
import { ErrorBoundary } from '../ErrorBoundary.js'
import type { ComputedRect } from '../tile-tree.js'
import type { DropZone } from '../tiled-layout-utils.js'
import { computeDropZone } from '../tiled-layout-utils.js'
import type { Theme } from '../../themes.js'
import type { Api } from '../../api/types.js'
import type { OpenTab, Project, ResizeEdge, ClientToCanvasPercent } from './types.js'

interface TileTerminalProps {
  leafId: string
  rect: ComputedRect
  hidden?: boolean
  isMaximized?: boolean
  onToggleMaximize?: (leafId: string) => void
  tabIds: string[]
  activeTabId: string
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
  draggedSubTab: { tabId: string; tileId: string } | null
  draggedSidebarProject: string | null
  flatLayout: { id: string; x: number; y: number; width: number; height: number }[]
  highlightedEdges: Set<string>
  viewportSize: { width: number; height: number }
  clientToCanvasPercent: ClientToCanvasPercent
  onCloseTab: (id: string) => void
  onRenameTab: (id: string, title: string) => void
  onFocusTab: (id: string) => void
  onSwitchSubTab: (leafId: string, tabId: string) => void
  onReorderSubTab: (leafId: string, tabId: string, toIndex: number) => void
  onAddTab?: (projectPath: string, tileId: string) => void
  onDragStart: (e: React.DragEvent, tileId: string) => void
  onSubTabDragStart: (e: React.DragEvent, tabId: string, tileId: string) => void
  onDragEnd: () => void
  onContainerDrop: (e: React.DragEvent) => void
  startTileResize: (e: React.MouseEvent, tileId: string, edge: ResizeEdge) => void
  setHoveredEdge: (state: { tileId: string; edge: string } | null) => void
  setDraggedSidebarProject: (id: string | null) => void
  setCurrentDropZone: (zone: DropZone | null) => void
  setDropTarget: (id: string | null) => void
}

export function TileTerminal({
  leafId,
  rect,
  tabIds,
  activeTabId: _activeTabId,
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
  draggedSubTab,
  draggedSidebarProject,
  flatLayout,
  highlightedEdges,
  viewportSize,
  clientToCanvasPercent,
  onCloseTab,
  onRenameTab,
  onFocusTab,
  hidden,
  isMaximized,
  onToggleMaximize,
  onSwitchSubTab,
  onReorderSubTab,
  onAddTab,
  onDragStart,
  onSubTabDragStart,
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
    onSwitchSubTab(leafId, tabId)
    onFocusTab(tabId)
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  }, [leafId, onSwitchSubTab, onFocusTab])

  // Insertion marker index while dragging a sub-tab over this tile's strip.
  const [subTabInsert, setSubTabInsert] = useState<number | null>(null)

  const parseSubTab = useCallback((e: React.DragEvent): { tabId: string; tileId: string } | null => {
    try {
      const raw = e.dataTransfer.getData('application/x-subtab')
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }, [])

  const handleSubTabDragOver = useCallback((e: React.DragEvent, tabIndex: number) => {
    if (!e.dataTransfer.types.includes('application/x-subtab')) return
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const before = e.clientX < rect.left + rect.width / 2
    setSubTabInsert(tabIndex + (before ? 0 : 1))
    setCurrentDropZone(null)
  }, [setCurrentDropZone])

  const handleSubTabDrop = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-subtab')) return
    const payload = parseSubTab(e)
    const insertAt = subTabInsert
    setSubTabInsert(null)
    // Same-tile reorder; cross-tile moves fall through to the container handler.
    if (payload && payload.tileId === leafId && insertAt !== null) {
      e.preventDefault()
      e.stopPropagation()
      onReorderSubTab(leafId, payload.tabId, insertAt)
    }
  }, [parseSubTab, subTabInsert, leafId, onReorderSubTab])

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
      onAddTab(projectPath, leafId)
    }
  }, [tabs, onAddTab, leafId])

  function handleTileDragOver(e: React.DragEvent): void {
    const isSidebarDrag = e.dataTransfer.types.includes('application/x-sidebar-project')
    const isSubTabDrag = e.dataTransfer.types.includes('application/x-subtab')
    if (isSidebarDrag || isSubTabDrag) {
      e.preventDefault()
      e.stopPropagation()
      if (isSidebarDrag && !draggedSidebarProject) {
        setDraggedSidebarProject('pending')
      }
      const { x: mouseX, y: mouseY } = clientToCanvasPercent(e.clientX, e.clientY)
      const zone = computeDropZone(flatLayout, null, mouseX, mouseY)
      setCurrentDropZone(zone)
      setDropTarget(zone?.targetTileId || leafId)
    }
  }

  function handleTileDrop(e: React.DragEvent): void {
    const sidebarPath = e.dataTransfer.getData('application/x-sidebar-project')
    const isSubTabDrag = e.dataTransfer.types.includes('application/x-subtab')
    if (sidebarPath || isSubTabDrag) {
      e.preventDefault()
      e.stopPropagation()
      onContainerDrop(e)
    }
  }

  function handleOverlayDragOver(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    const { x: mouseX, y: mouseY } = clientToCanvasPercent(e.clientX, e.clientY)
    // For sub-tab drags, pass null so the source tile is a valid target
    const isSubTabDrag = e.dataTransfer.types.includes('application/x-subtab')
    const excludeTileId = isSubTabDrag ? null : draggedTile
    const zone = computeDropZone(flatLayout, excludeTileId, mouseX, mouseY)
    setCurrentDropZone(zone)
    setDropTarget(zone?.targetTileId || leafId)
  }

  // ── Inline rename ──
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const renameCancelledRef = useRef(false)

  const startRename = useCallback((tabId: string, currentTitle: string) => {
    setEditingTabId(tabId)
    setEditValue(currentTitle)
    renameCancelledRef.current = false
    setTimeout(() => editInputRef.current?.select(), 0)
  }, [])

  const commitRename = useCallback(() => {
    if (renameCancelledRef.current) return
    if (editingTabId && editValue.trim()) {
      onRenameTab(editingTabId, editValue.trim())
    }
    setEditingTabId(null)
  }, [editingTabId, editValue, onRenameTab])

  const cancelRename = useCallback(() => {
    renameCancelledRef.current = true
    setEditingTabId(null)
  }, [])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRename()
    }
    e.stopPropagation()
  }, [commitRename, cancelRename])

  const hasMultipleTabs = tabs.length > 1
  const activeTab = tabs.find(t => t.id === activeSubTabId) || tabs[0]

  return (
    <div
      className={`terminal-tile ${isFocused ? 'focused' : ''} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
      style={{
        position: 'absolute',
        left: `${rect.x / 100 * viewportSize.width + GAP}px`,
        top: `${rect.y / 100 * viewportSize.height + GAP}px`,
        width: `${rect.width / 100 * viewportSize.width - GAP}px`,
        height: `${rect.height / 100 * viewportSize.height - GAP}px`,
        display: hidden ? 'none' : 'flex',
        zIndex: isMaximized ? 20 : undefined,
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
        onDragStart={(e) => onDragStart(e, leafId)}
        onDragEnd={onDragEnd}
        onDoubleClick={() => onToggleMaximize?.(leafId)}
        style={{ cursor: 'grab', background: projectColor ? `color-mix(in srgb, ${projectColor} 35%, var(--bg-surface))` : undefined }}
      >
        {hasMultipleTabs ? (
          <>
            <div
              className="tile-subtabs"
              onDragLeave={() => setSubTabInsert(null)}
              onDrop={handleSubTabDrop}
            >
              {tabs.map((tab, tabIndex) => (
                <div
                  key={tab.id}
                  className={`tile-subtab ${tab.id === activeSubTabId ? 'active' : ''}${draggedSubTab?.tabId === tab.id ? ' subtab-dragging' : ''}${subTabInsert === tabIndex ? ' subtab-insert-before' : ''}${subTabInsert === tabIndex + 1 && tabIndex === tabs.length - 1 ? ' subtab-insert-after' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation()
                    onSubTabDragStart(e, tab.id, leafId)
                  }}
                  onDragOver={(e) => handleSubTabDragOver(e, tabIndex)}
                  onDragEnd={onDragEnd}
                  onClick={() => handleSubTabClick(tab.id)}
                >
                  {editingTabId === tab.id ? (
                    <input
                      ref={editInputRef}
                      className="subtab-title-input"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={handleRenameKeyDown}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span
                      className="subtab-title"
                      title={tab.title}
                      onDoubleClick={(e) => { e.stopPropagation(); startRename(tab.id, tab.title) }}
                    >{tab.title}</span>
                  )}
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
                className="tile-maximize"
                draggable={false}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleMaximize?.(leafId) }}
                onMouseDown={(e) => e.stopPropagation()}
                title={isMaximized ? 'Restore' : 'Maximize'}
              >{isMaximized ? '❐' : '▢'}</button>
              <button
                className="tile-close"
                draggable={false}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onCloseTab(activeSubTabId) }}
                onMouseDown={(e) => e.stopPropagation()}
                title="Close current tab"
              >x</button>
            </div>
          </>
        ) : (
          <>
            {editingTabId === activeTab?.id ? (
              <input
                ref={editInputRef}
                className="tile-title-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={handleRenameKeyDown}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span
                className="tile-title"
                title={activeTab?.title}
                onDoubleClick={(e) => { e.stopPropagation(); if (activeTab) startRename(activeTab.id, activeTab.title) }}
              >{activeTab?.title}</span>
            )}
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
                className="tile-maximize"
                draggable={false}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleMaximize?.(leafId) }}
                onMouseDown={(e) => e.stopPropagation()}
                title={isMaximized ? 'Restore' : 'Maximize'}
              >{isMaximized ? '❐' : '▢'}</button>
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
      {((draggedTile && draggedTile !== leafId) || (draggedSubTab && hasMultipleTabs) || draggedSidebarProject) && (
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
      <div className={`tile-edge-resize tile-edge-left ${highlightedEdges.has(`${leafId}-left`) ? 'highlighted' : ''}`}
        onMouseDown={(e) => startTileResize(e, leafId, 'left')}
        onMouseEnter={() => setHoveredEdge({ tileId: leafId, edge: 'left' })}
        onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
      <div className={`tile-edge-resize tile-edge-right ${highlightedEdges.has(`${leafId}-right`) ? 'highlighted' : ''}`}
        onMouseDown={(e) => startTileResize(e, leafId, 'right')}
        onMouseEnter={() => setHoveredEdge({ tileId: leafId, edge: 'right' })}
        onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
      <div className={`tile-edge-resize tile-edge-top ${highlightedEdges.has(`${leafId}-top`) ? 'highlighted' : ''}`}
        onMouseDown={(e) => startTileResize(e, leafId, 'top')}
        onMouseEnter={() => setHoveredEdge({ tileId: leafId, edge: 'top' })}
        onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
      <div className={`tile-edge-resize tile-edge-bottom ${highlightedEdges.has(`${leafId}-bottom`) ? 'highlighted' : ''}`}
        onMouseDown={(e) => startTileResize(e, leafId, 'bottom')}
        onMouseEnter={() => setHoveredEdge({ tileId: leafId, edge: 'bottom' })}
        onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
      <div className={`tile-corner-resize tile-corner-top-left ${highlightedEdges.has(`${leafId}-top`) || highlightedEdges.has(`${leafId}-left`) ? 'highlighted' : ''}`}
        onMouseDown={(e) => startTileResize(e, leafId, 'top-left')}
        onMouseEnter={() => setHoveredEdge({ tileId: leafId, edge: 'top-left' })}
        onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
      <div className={`tile-corner-resize tile-corner-top-right ${highlightedEdges.has(`${leafId}-top`) || highlightedEdges.has(`${leafId}-right`) ? 'highlighted' : ''}`}
        onMouseDown={(e) => startTileResize(e, leafId, 'top-right')}
        onMouseEnter={() => setHoveredEdge({ tileId: leafId, edge: 'top-right' })}
        onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
      <div className={`tile-corner-resize tile-corner-bottom-left ${highlightedEdges.has(`${leafId}-bottom`) || highlightedEdges.has(`${leafId}-left`) ? 'highlighted' : ''}`}
        onMouseDown={(e) => startTileResize(e, leafId, 'bottom-left')}
        onMouseEnter={() => setHoveredEdge({ tileId: leafId, edge: 'bottom-left' })}
        onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
      <div className={`tile-corner-resize tile-corner-bottom-right ${highlightedEdges.has(`${leafId}-bottom`) || highlightedEdges.has(`${leafId}-right`) ? 'highlighted' : ''}`}
        onMouseDown={(e) => startTileResize(e, leafId, 'bottom-right')}
        onMouseEnter={() => setHoveredEdge({ tileId: leafId, edge: 'bottom-right' })}
        onMouseLeave={() => setHoveredEdge(null)} title="Drag to resize" />
    </div>
  )
}
