import { useCallback, MutableRefObject } from 'react'
import type { TileLayout, DropZone } from '../tiled-layout-utils.js'
import {
  computeDropZone,
  validateLayout,
  removeTilePreservingStructure,
  splitTile,
  addTabToExistingTile
} from '../tiled-layout-utils.js'
import type { OpenTab, ClientToCanvasPercent } from './types.js'

interface DragDropState {
  draggedTile: string | null
  draggedSidebarProject: string | null
  dropTarget: string | null
  currentDropZone: DropZone | null
}

interface DragDropActions {
  setDraggedTile: (id: string | null) => void
  setDraggedSidebarProject: (id: string | null) => void
  setDropTarget: (id: string | null) => void
  setCurrentDropZone: (zone: DropZone | null) => void
}

export function useHandleDragStart(
  setDraggedTile: (id: string | null) => void
): (e: React.DragEvent, tileId: string) => void {
  return useCallback((e: React.DragEvent, tileId: string) => {
    e.dataTransfer.setData('text/plain', tileId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggedTile(tileId)
  }, [setDraggedTile])
}

export function useHandleContainerDragOver(
  containerRef: MutableRefObject<HTMLDivElement | null>,
  effectiveLayout: TileLayout[],
  state: Pick<DragDropState, 'draggedTile' | 'draggedSidebarProject'>,
  actions: Pick<DragDropActions, 'setDraggedSidebarProject' | 'setDropTarget' | 'setCurrentDropZone'>,
  clientToCanvasPercentRef?: MutableRefObject<ClientToCanvasPercent>
): (e: React.DragEvent) => void {
  const { draggedTile, draggedSidebarProject } = state
  const { setDraggedSidebarProject, setDropTarget, setCurrentDropZone } = actions

  return useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    if (!containerRef.current) return

    const isSidebarProjectDrag = e.dataTransfer.types.includes('application/x-sidebar-project')

    if (isSidebarProjectDrag) {
      if (!draggedSidebarProject) {
        setDraggedSidebarProject('pending')
      }

      const { x: mouseX, y: mouseY } = clientToCanvasPercentRef?.current
        ? clientToCanvasPercentRef.current(e.clientX, e.clientY)
        : (() => { const rect = containerRef.current!.getBoundingClientRect(); return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 } })()

      const zone = computeDropZone(effectiveLayout, null, mouseX, mouseY)
      setCurrentDropZone(zone)
      setDropTarget(zone?.targetTileId || null)
      return
    }

    if (!draggedTile) return

    const { x: mouseX, y: mouseY } = clientToCanvasPercentRef?.current
      ? clientToCanvasPercentRef.current(e.clientX, e.clientY)
      : (() => { const rect = containerRef.current!.getBoundingClientRect(); return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 } })()

    const zone = computeDropZone(effectiveLayout, draggedTile, mouseX, mouseY)
    setCurrentDropZone(zone)
    setDropTarget(zone?.targetTileId || null)
  }, [containerRef, draggedTile, draggedSidebarProject, effectiveLayout, setDraggedSidebarProject, setDropTarget, setCurrentDropZone, clientToCanvasPercentRef])
}

export function useHandleContainerDragLeave(
  containerRef: MutableRefObject<HTMLDivElement | null>,
  actions: Pick<DragDropActions, 'setDraggedSidebarProject' | 'setDropTarget' | 'setCurrentDropZone'>
): (e: React.DragEvent) => void {
  const { setDraggedSidebarProject, setDropTarget, setCurrentDropZone } = actions

  return useCallback((e: React.DragEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const { clientX, clientY } = e
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        setCurrentDropZone(null)
        setDropTarget(null)
        setDraggedSidebarProject(null)
      }
    }
  }, [containerRef, setDraggedSidebarProject, setDropTarget, setCurrentDropZone])
}

export function useApplyDropZone(
  tabs: OpenTab[],
  containerSizeRef: MutableRefObject<{ width: number; height: number }>
): (layout: TileLayout[], draggedId: string, zone: DropZone) => TileLayout[] {
  return useCallback((layout: TileLayout[], draggedId: string, zone: DropZone): TileLayout[] => {
    const { width, height } = containerSizeRef.current

    if (zone.type === 'swap') {
      const sourceTile = layout.find(t => t.id === draggedId)
      const targetTile = layout.find(t => t.id === zone.targetTileId)

      if (sourceTile && targetTile) {
        // Check if source and target share a project → merge tabs
        const sourceProject = sourceTile.tabIds
          .map(id => tabs.find(t => t.id === id)?.projectPath)
          .find(p => p != null)
        const targetProject = targetTile.tabIds
          .map(id => tabs.find(t => t.id === id)?.projectPath)
          .find(p => p != null)

        if (sourceProject && sourceProject === targetProject) {
          // Merge: add source tabs into target tile, then remove source tile
          let merged = layout
          for (const tabId of sourceTile.tabIds) {
            merged = addTabToExistingTile(merged, targetTile.id, tabId)
          }
          return removeTilePreservingStructure(merged, draggedId, tabs, width, height)
        }

        // Different projects → swap positions
        return layout.map(tile => {
          if (tile.id === draggedId) {
            return { ...tile, x: targetTile.x, y: targetTile.y, width: targetTile.width, height: targetTile.height }
          }
          if (tile.id === zone.targetTileId) {
            return { ...tile, x: sourceTile.x, y: sourceTile.y, width: sourceTile.width, height: sourceTile.height }
          }
          return tile
        })
      }
      return layout
    }

    const direction = zone.type.replace('split-', '') as 'top' | 'bottom' | 'left' | 'right'
    const withoutDragged = removeTilePreservingStructure(layout, draggedId, tabs, width, height)
    return splitTile(withoutDragged, zone.targetTileId, draggedId, direction)
  }, [tabs, containerSizeRef])
}

export function useHandleContainerDrop(
  containerRef: MutableRefObject<HTMLDivElement | null>,
  effectiveLayoutRef: MutableRefObject<TileLayout[]>,
  containerSizeRef: MutableRefObject<{ width: number; height: number }>,
  tabs: OpenTab[],
  onLayoutChange: (layout: TileLayout[]) => void,
  applyDropZone: (layout: TileLayout[], draggedId: string, zone: DropZone) => TileLayout[],
  onOpenSessionAtPosition: ((projectPath: string, dropZone: DropZone | null, containerSize: { width: number, height: number }, currentLayout?: TileLayout[]) => void) | undefined,
  actions: DragDropActions,
  clientToCanvasPercentRef?: MutableRefObject<ClientToCanvasPercent>
): (e: React.DragEvent) => void {
  const { setDraggedTile, setDraggedSidebarProject, setDropTarget, setCurrentDropZone } = actions

  return useCallback((e: React.DragEvent) => {
    e.preventDefault()

    const sidebarProjectPath = e.dataTransfer.getData('application/x-sidebar-project')
    const textPlainData = e.dataTransfer.getData('text/plain')
    const isSidebarDrag = e.dataTransfer.types.includes('application/x-sidebar-project')

    let dropZone: DropZone | null = null
    if (containerRef.current) {
      const { x: mouseX, y: mouseY } = clientToCanvasPercentRef?.current
        ? clientToCanvasPercentRef.current(e.clientX, e.clientY)
        : (() => { const rect = containerRef.current!.getBoundingClientRect(); return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 } })()
      const currentLayout = effectiveLayoutRef.current
      dropZone = computeDropZone(currentLayout, null, mouseX, mouseY)
    }

    console.log('[TiledTerminalView] Drop event:', {
      sidebarProjectPath,
      textPlainData,
      isSidebarDrag,
      hasCallback: !!onOpenSessionAtPosition,
      dropZone,
      dataTypes: Array.from(e.dataTransfer.types)
    })

    const projectPath = sidebarProjectPath || (isSidebarDrag ? textPlainData : null)

    if (projectPath && onOpenSessionAtPosition) {
      // Pass the effective layout so handleOpenSessionAtPosition uses the same layout
      // that computeDropZone used (avoids stale closure / state mismatch)
      const layoutForPosition = effectiveLayoutRef.current
      console.log('[TiledTerminalView] Calling onOpenSessionAtPosition with:', projectPath, dropZone, containerSizeRef.current, 'layoutTiles:', layoutForPosition.length)
      onOpenSessionAtPosition(projectPath, dropZone, containerSizeRef.current, layoutForPosition)
      setDraggedSidebarProject(null)
      setDropTarget(null)
      setCurrentDropZone(null)
      return
    }

    const sourceTileId = e.dataTransfer.getData('text/plain')

    if (sourceTileId && dropZone) {
      const newLayout = applyDropZone(effectiveLayoutRef.current, sourceTileId, dropZone)
      const validatedLayout = validateLayout(newLayout, tabs)
      onLayoutChange(validatedLayout)
    }

    setDraggedTile(null)
    setDropTarget(null)
    setCurrentDropZone(null)
  }, [containerRef, effectiveLayoutRef, containerSizeRef, tabs, onLayoutChange, applyDropZone, onOpenSessionAtPosition, setDraggedTile, setDraggedSidebarProject, setDropTarget, setCurrentDropZone, clientToCanvasPercentRef])
}

export function useHandleDragEnd(
  actions: DragDropActions
): () => void {
  const { setDraggedTile, setDraggedSidebarProject, setDropTarget, setCurrentDropZone } = actions

  return useCallback(() => {
    setDraggedTile(null)
    setDraggedSidebarProject(null)
    setDropTarget(null)
    setCurrentDropZone(null)
  }, [setDraggedTile, setDraggedSidebarProject, setDropTarget, setCurrentDropZone])
}
