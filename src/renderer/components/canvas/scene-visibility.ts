import { getOverscanWorldRect, getViewportWorldRect, rectsIntersect, type CanvasViewport } from './scene-geometry'
import type { CanvasCamera, CanvasRect, CanvasScene, CanvasTerminalNode } from './scene-model'

export type CanvasNodeDetailLevel = 'full' | 'preview' | 'summary' | 'identity'

export function getNodeDetailLevel(zoom: number): CanvasNodeDetailLevel {
  if (zoom >= 0.85) return 'full'
  if (zoom >= 0.55) return 'preview'
  if (zoom >= 0.3) return 'summary'
  return 'identity'
}

export function isRectVisible(rect: CanvasRect, camera: CanvasCamera, viewport: CanvasViewport): boolean {
  return rectsIntersect(rect, getViewportWorldRect(camera, viewport))
}

function isNodeInCollapsedGroup(node: CanvasTerminalNode, scene: CanvasScene): boolean {
  return node.groupId !== undefined && scene.groups.some(group => group.id === node.groupId && group.collapsed)
}

export function getVisibleCanvasNodes(
  scene: CanvasScene,
  camera: CanvasCamera,
  viewport: CanvasViewport,
  overscanScreenPixels = 0
): CanvasTerminalNode[] {
  const bounds = overscanScreenPixels > 0
    ? getOverscanWorldRect(camera, viewport, overscanScreenPixels)
    : getViewportWorldRect(camera, viewport)
  return scene.nodes.filter(node => !isNodeInCollapsedGroup(node, scene) && rectsIntersect(node.rect, bounds))
}

export interface CanvasMountPlanOptions {
  maxMounted: number
  overscanScreenPixels?: number
}

export interface CanvasMountPlan {
  visibleNodeIds: string[]
  mountNodeIds: string[]
}

function distanceSquaredToCenter(rect: CanvasRect, viewport: CanvasRect): number {
  const x = rect.x + rect.width / 2 - (viewport.x + viewport.width / 2)
  const y = rect.y + rect.height / 2 - (viewport.y + viewport.height / 2)
  return x * x + y * y
}

export function planCanvasNodeMounts(
  scene: CanvasScene,
  camera: CanvasCamera,
  viewport: CanvasViewport,
  options: CanvasMountPlanOptions
): CanvasMountPlan {
  const viewportRect = getViewportWorldRect(camera, viewport)
  const overscan = Math.max(0, options.overscanScreenPixels ?? 240)
  const overscanRect = getOverscanWorldRect(camera, viewport, overscan)
  const candidates = scene.nodes
    .filter(node => !isNodeInCollapsedGroup(node, scene) && rectsIntersect(node.rect, overscanRect))
    .map(node => ({
      node,
      visible: rectsIntersect(node.rect, viewportRect),
      distance: distanceSquaredToCenter(node.rect, viewportRect),
    }))
    .sort((a, b) => Number(b.visible) - Number(a.visible)
      || a.distance - b.distance
      || b.node.zIndex - a.node.zIndex
      || a.node.id.localeCompare(b.node.id))

  const maxMounted = Number.isFinite(options.maxMounted)
    ? Math.max(0, Math.floor(options.maxMounted))
    : 0
  return {
    visibleNodeIds: candidates.filter(candidate => candidate.visible).map(candidate => candidate.node.id),
    mountNodeIds: candidates.slice(0, maxMounted).map(candidate => candidate.node.id),
  }
}
