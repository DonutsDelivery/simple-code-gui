import { useEffect, useCallback, MutableRefObject } from 'react'
import type { TileLayout } from '../tiled-layout-utils.js'
import { findTilesOnDivider, MIN_SIZE } from '../tiled-layout-utils.js'
import type { TileResizeState, ResizeEdge } from './types.js'

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

export function useStartTileResize(
  effectiveLayout: TileLayout[],
  setTileResizing: (state: TileResizeState | null) => void,
  setHoveredEdge: (state: { tileId: string; edge: string } | null) => void
): (e: React.MouseEvent, tileId: string, edge: ResizeEdge) => void {
  return useCallback((e: React.MouseEvent, tileId: string, edge: ResizeEdge) => {
    e.preventDefault()
    e.stopPropagation()
    setHoveredEdge(null)
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
  }, [effectiveLayout, setTileResizing, setHoveredEdge])
}

export function useTileResizeEffect(
  tileResizing: TileResizeState | null,
  containerRef: MutableRefObject<HTMLDivElement | null>,
  effectiveLayoutRef: MutableRefObject<TileLayout[]>,
  onLayoutChangeRef: MutableRefObject<(layout: TileLayout[]) => void>,
  setTileResizing: (state: TileResizeState | null) => void
): void {
  useEffect(() => {
    if (!tileResizing || !containerRef.current) return

    let rafId: number | null = null
    const handleTileResizeMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
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
      })
    }

    const handleTileResizeUp = () => {
      setTileResizing(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    const cursor = getCursorForEdge(tileResizing.edge)

    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleTileResizeMove)
    window.addEventListener('mouseup', handleTileResizeUp)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('mousemove', handleTileResizeMove)
      window.removeEventListener('mouseup', handleTileResizeUp)
    }
  }, [tileResizing, containerRef, effectiveLayoutRef, onLayoutChangeRef, setTileResizing])
}
