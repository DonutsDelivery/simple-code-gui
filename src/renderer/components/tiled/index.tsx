import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { TiledTerminalViewProps, TileResizeState } from './types.js'
import type { DropZone } from '../tiled-layout-utils.js'
import type { TileNode, ComputedRect, TileLeaf } from '../tile-tree.js'
import {
  computeRects,
  getAllLeaves,
  findLeafAtPoint,
  findLeafById,
  findBranchById,
  findDividerForEdge,
  resizeChildren,
  setActiveTabInLeaf,
  computeDividers,
  moveLeaf,
  swapLeaves,
  addTabToLeaf,
  removeLeaf,
  createLeaf,
  generateTileId,
  splitLeaf,
  removeTabFromLeaf,
  splitRoot,
  reorderTabInLeaf,
  equalizeRatios,
  findAdjacentLeaf
} from '../tile-tree.js'
import { computeDropZone, computeFallbackDropZone } from '../tiled-layout-utils.js'
import { usePanning } from './usePanning.js'
import { TileTerminal } from './TileTerminal.js'
import { DropZoneOverlay } from './DropZoneOverlay.js'

export type { TileNode } from '../tile-tree.js'
export type { DropZone } from '../tiled-layout-utils.js'

const GAP = 4

export function TiledTerminalView({
  tabs,
  projects,
  theme,
  focusedTabId,
  onCloseTab,
  onRenameTab,
  onFocusTab,
  tileTree,
  onTreeChange,
  onOpenSessionAtPosition,
  onAddTab,
  onUndoCloseTab,
  api
}: TiledTerminalViewProps): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null)
  const containerSizeRef = useRef({ width: 1920, height: 1080 })
  const [viewportSize, setViewportSize] = useState({ width: 1920, height: 1080 })
  const onTreeChangeRef = useRef(onTreeChange)
  onTreeChangeRef.current = onTreeChange
  const tileTreeRef = useRef(tileTree)
  tileTreeRef.current = tileTree

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
  const [draggedSubTab, setDraggedSubTab] = useState<{ tabId: string; tileId: string } | null>(null)
  const [draggedSidebarProject, setDraggedSidebarProject] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [currentDropZone, setCurrentDropZone] = useState<DropZone | null>(null)
  const [tileResizing, setTileResizing] = useState<TileResizeState | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<{ tileId: string; edge: string } | null>(null)
  const [maximizedLeafId, setMaximizedLeafId] = useState<string | null>(null)

  // Drop the maximized state whenever its leaf leaves the tree (tab closed, tile removed, workspace switched).
  useEffect(() => {
    if (maximizedLeafId && (!tileTree || !findLeafById(tileTree, maximizedLeafId))) {
      setMaximizedLeafId(null)
    }
  }, [tileTree, maximizedLeafId])

  const toggleMaximize = useCallback((leafId: string) => {
    setMaximizedLeafId(prev => (prev === leafId ? null : leafId))
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  }, [])

  // Compute rects from tree
  const bounds: ComputedRect = useMemo(() => ({ x: 0, y: 0, width: 100, height: 100 }), [])

  const leafRects = useMemo(() => {
    if (!tileTree) return new Map<string, ComputedRect>()
    return computeRects(tileTree, bounds)
  }, [tileTree, bounds])

  const leaves = useMemo(() => {
    if (!tileTree) return []
    return getAllLeaves(tileTree)
  }, [tileTree])

  const leafRectsRef = useRef(leafRects)
  leafRectsRef.current = leafRects

  // ── Keyboard shortcuts for tile management (capture phase so they beat xterm) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tree = tileTreeRef.current
      if (!tree) return
      const allLeaves = getAllLeaves(tree)
      const focused = (focusedTabId ? allLeaves.find(l => l.tabIds.includes(focusedTabId)) : null) || allLeaves[0]
      if (!focused) return
      // In this view the tab id IS the pty id (TileTerminal passes ptyId={tab.id}).
      const focusTab = (tabId: string) => {
        onFocusTab(tabId)
        window.dispatchEvent(new CustomEvent('ct-focus-terminal', { detail: { ptyId: tabId } }))
      }

      // Ctrl+Shift+D / Ctrl+Shift+E — split focused tile right / down
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.code === 'KeyD' || e.code === 'KeyE')) {
        const activeTab = tabs.find(t => t.id === focused.activeTabId)
        const rect = leafRectsRef.current.get(focused.id)
        if (activeTab && rect && onOpenSessionAtPosition) {
          e.preventDefault(); e.stopPropagation()
          const type = e.code === 'KeyD' ? 'split-right' : 'split-bottom'
          onOpenSessionAtPosition(activeTab.projectPath, { type, targetTileId: focused.id, bounds: rect }, containerSizeRef.current, tree)
        }
        return
      }
      // Ctrl+Shift+W — close active tab in focused tile
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyW') {
        e.preventDefault(); e.stopPropagation()
        onCloseTab(focused.activeTabId)
        return
      }
      // Ctrl+Shift+Z — toggle maximize focused tile
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyZ') {
        e.preventDefault(); e.stopPropagation()
        toggleMaximize(focused.id)
        return
      }
      // Ctrl+PageUp / Ctrl+PageDown — cycle sub-tabs in focused tile
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === 'PageUp' || e.code === 'PageDown') && focused.tabIds.length > 1) {
        e.preventDefault(); e.stopPropagation()
        const i = focused.tabIds.indexOf(focused.activeTabId)
        const n = focused.tabIds.length
        const next = focused.tabIds[(i + (e.code === 'PageDown' ? 1 : n - 1)) % n]
        onTreeChange(setActiveTabInLeaf(tree, focused.id, next))
        focusTab(next)
        return
      }
      // Ctrl+Alt+Arrows — move focus between tiles directionally
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.code.startsWith('Arrow')) {
        const dir = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const)[e.code as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown']
        if (!dir) return
        const target = findAdjacentLeaf(tree, bounds, focused.id, dir)
        if (target) {
          e.preventDefault(); e.stopPropagation()
          focusTab(target.activeTabId)
        }
        return
      }
      // Ctrl+Alt+= — equalize layout
      if (e.ctrlKey && e.altKey && !e.shiftKey && (e.code === 'Equal' || e.key === '=')) {
        e.preventDefault(); e.stopPropagation()
        onTreeChange(equalizeRatios(tree))
        return
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [focusedTabId, tabs, bounds, onFocusTab, onCloseTab, onTreeChange, onOpenSessionAtPosition, toggleMaximize])

  // Build a "flat layout" from the tree for computeDropZone compatibility
  const flatLayoutForDropZone = useMemo(() => {
    return leaves.map(leaf => {
      const rect = leafRects.get(leaf.id)
      return {
        id: leaf.id,
        tabIds: leaf.tabIds,
        activeTabId: leaf.activeTabId,
        x: rect?.x ?? 0,
        y: rect?.y ?? 0,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0
      }
    })
  }, [leaves, leafRects])

  // Canvas width for panning
  const CANVAS_PADDING = 180
  const canvasWidth = useMemo(() => {
    if (leaves.length === 0) return viewportSize.width
    let rightmostEdge = 0
    for (const leaf of leaves) {
      const rect = leafRects.get(leaf.id)
      if (rect) rightmostEdge = Math.max(rightmostEdge, rect.x + rect.width)
    }
    const rightmostPx = rightmostEdge / 100 * viewportSize.width
    if (rightmostPx <= viewportSize.width) return viewportSize.width
    return rightmostPx + CANVAS_PADDING
  }, [leaves, leafRects, viewportSize.width])

  const { panX, isPanning, handlePanStart, clientToCanvasPercent, clientToCanvasPercentRef } = usePanning(
    containerRef, canvasWidth, viewportSize.width, viewportSize.height
  )

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
    const triggerRefit = () => window.dispatchEvent(new Event('resize'))
    const timers = [setTimeout(triggerRefit, 100), setTimeout(triggerRefit, 300)]
    return () => timers.forEach(clearTimeout)
  }, [])

  // ── Sub-tab switching ──
  const handleSwitchSubTab = useCallback((leafId: string, tabId: string) => {
    const tree = tileTreeRef.current
    if (!tree) return
    const newTree = setActiveTabInLeaf(tree, leafId, tabId)
    onTreeChange(newTree)
  }, [onTreeChange])

  // ── Reorder a sub-tab within its own tile ──
  const handleReorderSubTab = useCallback((leafId: string, tabId: string, toIndex: number) => {
    if (!tileTreeRef.current) return
    onTreeChange(reorderTabInLeaf(tileTreeRef.current, leafId, tabId, toIndex))
  }, [onTreeChange])

  // ── Drag start ──
  const handleDragStart = useCallback((e: React.DragEvent, tileId: string) => {
    e.dataTransfer.setData('text/plain', tileId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggedTile(tileId)
  }, [])

  // ── Sub-tab drag start ──
  const handleSubTabDragStart = useCallback((e: React.DragEvent, tabId: string, tileId: string) => {
    console.log('[TiledDrop] sub-tab drag start:', { tabId, tileId })
    e.dataTransfer.setData('application/x-subtab', JSON.stringify({ tabId, tileId }))
    e.dataTransfer.setData('text/plain', tileId)
    e.dataTransfer.effectAllowed = 'move'
    // Defer the state updates: mutating React state synchronously inside
    // dragstart re-renders and disturbs the dragged sub-tab node, which makes
    // Chromium abort the drag immediately (dragstart → dragend, no dragover).
    requestAnimationFrame(() => {
      setDraggedSubTab({ tabId, tileId })
      setDraggedTile(tileId)
    })
  }, [])

  // ── Drag over ──
  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!containerRef.current) return

    const isSidebarProjectDrag = e.dataTransfer.types.includes('application/x-sidebar-project')

    if (isSidebarProjectDrag && !draggedSidebarProject) {
      setDraggedSidebarProject('pending')
    }

    const { x: mouseX, y: mouseY } = clientToCanvasPercentRef.current(e.clientX, e.clientY)
    // For sub-tab drags, pass null so the source tile is a valid drop target (enables splitting)
    const isSubTabDrag = e.dataTransfer.types.includes('application/x-subtab')
    const sourceTileId = isSidebarProjectDrag || isSubTabDrag ? null : draggedTile
    const zone = computeDropZone(flatLayoutForDropZone, sourceTileId, mouseX, mouseY)
      ?? computeFallbackDropZone(flatLayoutForDropZone, mouseX, mouseY)
    setCurrentDropZone(zone)
    setDropTarget(zone?.targetTileId || null)
  }, [draggedTile, draggedSidebarProject, flatLayoutForDropZone, clientToCanvasPercentRef])

  // ── Drag leave ──
  const handleContainerDragLeave = useCallback((e: React.DragEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const { clientX, clientY } = e
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        setCurrentDropZone(null)
        setDropTarget(null)
        setDraggedSidebarProject(null)
      }
    }
  }, [])

  // ── Drop ──
  const handleContainerDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()

    const sidebarProjectPath = e.dataTransfer.getData('application/x-sidebar-project')
    const isSidebarDrag = e.dataTransfer.types.includes('application/x-sidebar-project')
    const isSubTabDrag = e.dataTransfer.types.includes('application/x-subtab')
    const textPlainData = e.dataTransfer.getData('text/plain')

    const { x: mouseX, y: mouseY } = clientToCanvasPercentRef.current(e.clientX, e.clientY)
    // For sub-tab drags, pass null so source tile is a valid target (enables splitting within same tile)
    // For tile drags, exclude the source tile to prevent self-drop which destroys the tile
    const dragSourceForExclusion = isSubTabDrag ? null : textPlainData
    const dropZone = computeDropZone(flatLayoutForDropZone, dragSourceForExclusion, mouseX, mouseY)
      ?? computeFallbackDropZone(flatLayoutForDropZone, mouseX, mouseY)

    console.log('[TiledDrop] drop event:', {
      isSidebarDrag, isSubTabDrag, sidebarProjectPath,
      textPlainData, mouseX, mouseY,
      dropZone: dropZone ? { type: dropZone.type, target: dropZone.targetTileId } : null,
      dataTypes: Array.from(e.dataTransfer.types)
    })

    const projectPath = sidebarProjectPath || (isSidebarDrag ? textPlainData : null)

    if (projectPath && onOpenSessionAtPosition) {
      console.log('[TiledDrop] sidebar drop → onOpenSessionAtPosition, zone:', dropZone?.type)
      onOpenSessionAtPosition(projectPath, dropZone, containerSizeRef.current, tileTreeRef.current)
      setDraggedSidebarProject(null)
      setDropTarget(null)
      setCurrentDropZone(null)
      return
    }

    // Sub-tab drag: pull a single tab out of its tile into a new split
    console.log('[TiledDrop] isSubTabDrag:', isSubTabDrag, 'dropZone:', dropZone?.type, 'hasTree:', !!tileTreeRef.current)
    if (isSubTabDrag && dropZone && tileTreeRef.current) {
      try {
        const subTabData = JSON.parse(e.dataTransfer.getData('application/x-subtab'))
        const { tabId, tileId: sourceTileId } = subTabData as { tabId: string; tileId: string }
        const tree = tileTreeRef.current
        const sourceLeaf = findLeafById(tree, sourceTileId)

        if (sourceLeaf && sourceLeaf.tabIds.length > 1) {
          if (dropZone.type === 'swap' && dropZone.targetTileId === sourceTileId) {
            // Dropping on center of same tile — no-op
          } else if (dropZone.type === 'swap' && dropZone.targetTileId !== sourceTileId) {
            // Swap: move tab to the target tile
            let newTree = removeTabFromLeaf(tree, tabId) || tree
            newTree = addTabToLeaf(newTree, dropZone.targetTileId, tabId)
            onTreeChange(newTree)
          } else {
            // Split: remove tab from source, create new leaf, split target
            const newLeafId = generateTileId()
            const newLeaf = createLeaf(newLeafId, [tabId], tabId)
            let newTree = removeTabFromLeaf(tree, tabId) || tree
            if (dropZone.type === 'root-right' || dropZone.type === 'root-bottom') {
              newTree = splitRoot(newTree, dropZone.type === 'root-right' ? 'horizontal' : 'vertical', newLeaf, 'after')
            } else {
              const dirMap: Record<string, { dir: 'horizontal' | 'vertical'; pos: 'before' | 'after' }> = {
                'split-left': { dir: 'horizontal', pos: 'before' },
                'split-right': { dir: 'horizontal', pos: 'after' },
                'split-top': { dir: 'vertical', pos: 'before' },
                'split-bottom': { dir: 'vertical', pos: 'after' }
              }
              const { dir, pos } = dirMap[dropZone.type]
              newTree = splitLeaf(newTree, dropZone.targetTileId, dir, newLeaf, pos)
            }
            onTreeChange(newTree)
          }
        } else if (sourceLeaf && sourceLeaf.tabIds.length === 1) {
          // Only one tab — fall through to normal tile-to-tile drag behavior
          handleTileDrop(sourceTileId)
        }
      } catch (err) {
        console.error('[TiledDrop] sub-tab drop error:', err)
      }

      setDraggedTile(null)
      setDraggedSubTab(null)
      setDropTarget(null)
      setCurrentDropZone(null)
      return
    }

    // Tile-to-tile drag
    const sourceTileId = textPlainData
    if (sourceTileId && dropZone && tileTreeRef.current) {
      handleTileDrop(sourceTileId)
    }

    setDraggedTile(null)
    setDraggedSubTab(null)
    setDropTarget(null)
    setCurrentDropZone(null)

    function handleTileDrop(sourceTileId: string) {
      const tree = tileTreeRef.current!
      // Self-drop: no-op (prevents tile destruction)
      if (sourceTileId === dropZone!.targetTileId) return
      let newTree: TileNode
      if (dropZone!.type === 'swap') {
        // Check if same project → merge tabs; different → swap positions
        const sourceLeaf = findLeafById(tree, sourceTileId)
        const targetLeaf = findLeafById(tree, dropZone!.targetTileId)
        if (sourceLeaf && targetLeaf) {
          const sourceProject = sourceLeaf.tabIds
            .map(id => tabs.find(t => t.id === id)?.projectPath)
            .find(p => p != null)
          const targetProject = targetLeaf.tabIds
            .map(id => tabs.find(t => t.id === id)?.projectPath)
            .find(p => p != null)

          if (sourceProject && sourceProject === targetProject) {
            // Merge: add all source tabs to target, then remove source
            let merged = tree
            for (const tabId of sourceLeaf.tabIds) {
              merged = addTabToLeaf(merged, targetLeaf.id, tabId)
            }
            newTree = removeLeaf(merged, sourceTileId) || merged
          } else {
            newTree = swapLeaves(tree, sourceTileId, dropZone!.targetTileId)
          }
        } else {
          newTree = tree
        }
      } else if (dropZone!.type === 'root-right' || dropZone!.type === 'root-bottom') {
        // Move the whole source leaf to a new root-level column/row
        const sourceLeaf = findLeafById(tree, sourceTileId)
        if (!sourceLeaf) { newTree = tree }
        else {
          const detached = removeLeaf(tree, sourceTileId)
          if (!detached) { newTree = tree }
          else {
            const movedLeaf = createLeaf(generateTileId(), [...sourceLeaf.tabIds], sourceLeaf.activeTabId)
            newTree = splitRoot(detached, dropZone!.type === 'root-right' ? 'horizontal' : 'vertical', movedLeaf, 'after')
          }
        }
      } else {
        const dirMap: Record<string, { dir: 'horizontal' | 'vertical'; pos: 'before' | 'after' }> = {
          'split-left': { dir: 'horizontal', pos: 'before' },
          'split-right': { dir: 'horizontal', pos: 'after' },
          'split-top': { dir: 'vertical', pos: 'before' },
          'split-bottom': { dir: 'vertical', pos: 'after' }
        }
        const { dir, pos } = dirMap[dropZone!.type]
        newTree = moveLeaf(tree, sourceTileId, dropZone!.targetTileId, dir, pos)
      }

      onTreeChange(newTree)
    }
  }, [flatLayoutForDropZone, tabs, onOpenSessionAtPosition, onTreeChange, clientToCanvasPercentRef])

  const handleDragEnd = useCallback(() => {
    setDraggedTile(null)
    setDraggedSubTab(null)
    setDraggedSidebarProject(null)
    setDropTarget(null)
    setCurrentDropZone(null)
  }, [])

  // ── Resize ──
  // For compound edges (top-left, etc.), we track two dividers
  const secondResizeRef = useRef<TileResizeState | null>(null)

  const handleStartResize = useCallback((e: React.MouseEvent, leafId: string, edge: string) => {
    e.preventDefault()
    e.stopPropagation()
    setHoveredEdge(null)

    const tree = tileTreeRef.current
    if (!tree) return

    const simpleEdges = edge.includes('-') ? edge.split('-') : [edge]
    const primaryEdge = simpleEdges[0] as 'left' | 'right' | 'top' | 'bottom'

    const divider = findDividerForEdge(tree, bounds, leafId, primaryEdge)
    if (!divider) return

    const startMouse = divider.direction === 'horizontal' ? e.clientX : e.clientY

    setTileResizing({
      branchId: divider.branchId,
      childIndex: divider.childIndex,
      direction: divider.direction,
      startMouse
    })

    // Handle second edge for compound resize
    if (simpleEdges.length > 1) {
      const secondEdge = simpleEdges[1] as 'left' | 'right' | 'top' | 'bottom'
      const secondDivider = findDividerForEdge(tree, bounds, leafId, secondEdge)
      if (secondDivider) {
        secondResizeRef.current = {
          branchId: secondDivider.branchId,
          childIndex: secondDivider.childIndex,
          direction: secondDivider.direction,
          startMouse: secondDivider.direction === 'horizontal' ? e.clientX : e.clientY
        }
      } else {
        secondResizeRef.current = null
      }
    } else {
      secondResizeRef.current = null
    }
  }, [bounds])

  // Resize mouse tracking
  useEffect(() => {
    if (!tileResizing || !containerRef.current) return

    let rafId: number | null = null

    const computeDelta = (tree: TileNode, resize: TileResizeState, canvasCoords: { x: number; y: number }): number | null => {
      const dividers = computeDividers(tree, bounds)
      const div = dividers.find(d => d.branchId === resize.branchId && d.childIndex === resize.childIndex)
      if (!div) return null

      const isHoriz = resize.direction === 'horizontal'
      const mousePct = isHoriz ? canvasCoords.x : canvasCoords.y
      const deltaPct = mousePct - div.position

      const branch = findBranchById(tree, resize.branchId)
      if (!branch) return null

      const rects = computeRects(tree, bounds)
      let branchMin = Infinity, branchMax = -Infinity
      for (const child of branch.children) {
        const childLeaves = child.type === 'leaf' ? [child] : getAllLeaves(child)
        for (const leaf of childLeaves) {
          const r = rects.get(leaf.id)
          if (r) {
            const val = isHoriz ? r.x : r.y
            const size = isHoriz ? r.width : r.height
            branchMin = Math.min(branchMin, val)
            branchMax = Math.max(branchMax, val + size)
          }
        }
      }
      const span = branchMax - branchMin
      return span > 0 ? deltaPct / span : null
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (!containerRef.current) return

        let tree = tileTreeRef.current
        if (!tree) return

        const canvasCoords = clientToCanvasPercentRef.current(e.clientX, e.clientY)

        // Apply primary resize
        const delta1 = computeDelta(tree, tileResizing, canvasCoords)
        if (delta1 !== null && Math.abs(delta1) >= 0.001) {
          const newTree = resizeChildren(tree, tileResizing.branchId, tileResizing.childIndex, delta1)
          if (newTree !== tree) tree = newTree
        }

        // Apply secondary resize (for compound edges like top-left)
        const secondResize = secondResizeRef.current
        if (secondResize) {
          const delta2 = computeDelta(tree, secondResize, canvasCoords)
          if (delta2 !== null && Math.abs(delta2) >= 0.001) {
            const newTree = resizeChildren(tree, secondResize.branchId, secondResize.childIndex, delta2)
            if (newTree !== tree) tree = newTree
          }
        }

        if (tree !== tileTreeRef.current) {
          onTreeChangeRef.current(tree)
        }
      })
    }

    const handleMouseUp = () => {
      setTileResizing(null)
      secondResizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    // Set cursor based on compound direction
    const hasSecond = secondResizeRef.current
    let cursor: string
    if (hasSecond) {
      const dirs = [tileResizing.direction, hasSecond.direction].sort()
      cursor = dirs[0] === dirs[1] ? (dirs[0] === 'horizontal' ? 'ew-resize' : 'ns-resize') : 'nwse-resize'
    } else {
      cursor = tileResizing.direction === 'horizontal' ? 'ew-resize' : 'ns-resize'
    }
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [tileResizing, bounds, clientToCanvasPercentRef])

  // ── Edge highlighting ──
  const highlightedEdges = useMemo(() => {
    const edges = new Set<string>()
    if (!tileTree || !hoveredEdge) return edges

    const { tileId, edge } = hoveredEdge
    edges.add(`${tileId}-${edge}`)

    // Find adjacent leaves that share this edge
    const leafRect = leafRects.get(tileId)
    if (!leafRect) return edges

    const EPSILON = 0.5
    const simpleEdges = edge.includes('-') ? edge.split('-') : [edge]

    for (const edgeDir of simpleEdges) {
      for (const leaf of leaves) {
        if (leaf.id === tileId) continue
        const otherRect = leafRects.get(leaf.id)
        if (!otherRect) continue

        const hasVerticalOverlap = leafRect.y < otherRect.y + otherRect.height - EPSILON &&
          leafRect.y + leafRect.height > otherRect.y + EPSILON
        const hasHorizontalOverlap = leafRect.x < otherRect.x + otherRect.width - EPSILON &&
          leafRect.x + leafRect.width > otherRect.x + EPSILON

        switch (edgeDir) {
          case 'right':
            if (Math.abs(otherRect.x - (leafRect.x + leafRect.width)) < EPSILON && hasVerticalOverlap)
              edges.add(`${leaf.id}-left`)
            break
          case 'left':
            if (Math.abs(otherRect.x + otherRect.width - leafRect.x) < EPSILON && hasVerticalOverlap)
              edges.add(`${leaf.id}-right`)
            break
          case 'bottom':
            if (Math.abs(otherRect.y - (leafRect.y + leafRect.height)) < EPSILON && hasHorizontalOverlap)
              edges.add(`${leaf.id}-top`)
            break
          case 'top':
            if (Math.abs(otherRect.y + otherRect.height - leafRect.y) < EPSILON && hasHorizontalOverlap)
              edges.add(`${leaf.id}-bottom`)
            break
        }
      }
    }

    return edges
  }, [tileTree, hoveredEdge, leaves, leafRects])

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
        {leaves.map((leaf) => {
          const baseRect = leafRects.get(leaf.id)
          if (!baseRect) return null

          const isMaximized = maximizedLeafId === leaf.id
          const isHidden = maximizedLeafId != null && !isMaximized
          const rect = isMaximized ? { x: 0, y: 0, width: bounds.width, height: bounds.height } : baseRect

          const tileTabs = leaf.tabIds
            .map(id => tabs.find(t => t.id === id))
            .filter((t): t is typeof tabs[number] => t != null)

          if (tileTabs.length === 0) return null

          const activeSubTabId = leaf.activeTabId && tileTabs.some(t => t.id === leaf.activeTabId)
            ? leaf.activeTabId
            : tileTabs[0].id

          const project = projects.find(p => p.path === tileTabs[0].projectPath)
          const isFocused = focusedTabId != null && leaf.tabIds.includes(focusedTabId)

          return (
            <TileTerminal
              key={leaf.id}
              leafId={leaf.id}
              rect={rect}
              hidden={isHidden}
              isMaximized={isMaximized}
              onToggleMaximize={toggleMaximize}
              tabIds={leaf.tabIds}
              activeTabId={leaf.activeTabId}
              tabs={tileTabs}
              activeSubTabId={activeSubTabId}
              project={project}
              theme={theme}
              api={api}
              GAP={GAP}
              isFocused={isFocused}
              isDragging={draggedTile === leaf.id && !draggedSubTab}
              isDropTarget={dropTarget === leaf.id}
              draggedTile={draggedTile}
              draggedSubTab={draggedSubTab}
              draggedSidebarProject={draggedSidebarProject}
              flatLayout={flatLayoutForDropZone}
              highlightedEdges={highlightedEdges}
              viewportSize={viewportSize}
              clientToCanvasPercent={clientToCanvasPercent}
              onCloseTab={onCloseTab}
              onRenameTab={onRenameTab}
              onFocusTab={onFocusTab}
              onSwitchSubTab={handleSwitchSubTab}
              onReorderSubTab={handleReorderSubTab}
              onAddTab={onAddTab}
              onDragStart={handleDragStart}
              onSubTabDragStart={handleSubTabDragStart}
              onDragEnd={handleDragEnd}
              onContainerDrop={handleContainerDrop}
              startTileResize={handleStartResize}
              setHoveredEdge={setHoveredEdge}
              setDraggedSidebarProject={setDraggedSidebarProject}
              setCurrentDropZone={setCurrentDropZone}
              setDropTarget={setDropTarget}
            />
          )
        })}

        {(draggedTile || draggedSubTab || draggedSidebarProject) && currentDropZone && (() => {
          let swapLabel: string | undefined
          if (currentDropZone.type === 'swap') {
            if (draggedSidebarProject) {
              swapLabel = 'Add as Tab'
            } else if (draggedSubTab && currentDropZone.targetTileId !== draggedSubTab.tileId) {
              swapLabel = 'Add as Tab'
            } else if (draggedSubTab && currentDropZone.targetTileId === draggedSubTab.tileId) {
              // Dropping sub-tab on center of same tile — no-op, hide overlay
              return null
            } else if (draggedTile) {
              const sourceLeaf = tileTree ? findLeafById(tileTree, draggedTile) : null
              const targetLeaf = tileTree ? findLeafById(tileTree, currentDropZone.targetTileId) : null
              if (sourceLeaf && targetLeaf) {
                const sourceProject = sourceLeaf.tabIds
                  .map(id => tabs.find(t => t.id === id)?.projectPath)
                  .find(p => p != null)
                const targetProject = targetLeaf.tabIds
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
