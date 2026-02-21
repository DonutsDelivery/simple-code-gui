import { useCallback, useMemo } from 'react'
import type { TileLayout } from '../tiled-layout-utils.js'
import type { TileResizeState } from './types.js'

const EPSILON = 0.5

function hasVerticalOverlap(a: TileLayout, b: TileLayout): boolean {
  return a.y < b.y + b.height - EPSILON && a.y + a.height > b.y + EPSILON
}

function hasHorizontalOverlap(a: TileLayout, b: TileLayout): boolean {
  return a.x < b.x + b.width - EPSILON && a.x + a.width > b.x + EPSILON
}

export function useGetHighlightedEdges(
  effectiveLayout: TileLayout[]
): (hovered: { tileId: string; edge: string } | null) => Set<string> {
  return useCallback((hovered: { tileId: string; edge: string } | null): Set<string> => {
    const highlighted = new Set<string>()
    if (!hovered) return highlighted

    const tile = effectiveLayout.find(t => t.id === hovered.tileId)
    if (!tile) return highlighted

    highlighted.add(`${hovered.tileId}-${hovered.edge}`)

    const edges = hovered.edge.includes('-') ? hovered.edge.split('-') : [hovered.edge]

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
}

export function useHighlightedEdges(
  hoveredEdge: { tileId: string; edge: string } | null,
  tileResizing: TileResizeState | null,
  getHighlightedEdges: (hovered: { tileId: string; edge: string } | null) => Set<string>
): Set<string> {
  return useMemo(() => {
    if (tileResizing) {
      const edges = new Set<string>()
      const { edge, tilesLeftOfRightDivider, tilesRightOfRightDivider,
        tilesLeftOfLeftDivider, tilesRightOfLeftDivider,
        tilesAboveBottomDivider, tilesBelowBottomDivider,
        tilesAboveTopDivider, tilesBelowTopDivider } = tileResizing
      const subEdges = edge.includes('-') ? edge.split('-') : [edge]
      for (const sub of subEdges) {
        if (sub === 'right') {
          tilesLeftOfRightDivider.forEach(t => edges.add(`${t.id}-right`))
          tilesRightOfRightDivider.forEach(t => edges.add(`${t.id}-left`))
        }
        if (sub === 'left') {
          tilesLeftOfLeftDivider.forEach(t => edges.add(`${t.id}-right`))
          tilesRightOfLeftDivider.forEach(t => edges.add(`${t.id}-left`))
        }
        if (sub === 'bottom') {
          tilesAboveBottomDivider.forEach(t => edges.add(`${t.id}-bottom`))
          tilesBelowBottomDivider.forEach(t => edges.add(`${t.id}-top`))
        }
        if (sub === 'top') {
          tilesAboveTopDivider.forEach(t => edges.add(`${t.id}-bottom`))
          tilesBelowTopDivider.forEach(t => edges.add(`${t.id}-top`))
        }
      }
      return edges
    }
    return getHighlightedEdges(hoveredEdge)
  }, [hoveredEdge, tileResizing, getHighlightedEdges])
}
