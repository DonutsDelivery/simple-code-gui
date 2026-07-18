import type { CanvasCamera, CanvasPoint, CanvasRect } from './scene-model'

export interface CanvasViewport {
  width: number
  height: number
}

export interface ZoomLimits {
  min: number
  max: number
}

export const DEFAULT_ZOOM_LIMITS: ZoomLimits = { min: 0.2, max: 2 }

export function worldToScreen(point: CanvasPoint, camera: CanvasCamera): CanvasPoint {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  }
}

export function screenToWorld(point: CanvasPoint, camera: CanvasCamera): CanvasPoint {
  return {
    x: point.x / camera.zoom + camera.x,
    y: point.y / camera.zoom + camera.y,
  }
}

export function zoomAtScreenPoint(
  camera: CanvasCamera,
  zoom: number,
  cursor: CanvasPoint,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS
): CanvasCamera {
  const nextZoom = Math.min(limits.max, Math.max(limits.min, zoom))
  const anchor = screenToWorld(cursor, camera)
  return {
    x: anchor.x - cursor.x / nextZoom,
    y: anchor.y - cursor.y / nextZoom,
    zoom: nextZoom,
  }
}

export function fitBounds(
  bounds: CanvasRect,
  viewport: CanvasViewport,
  padding = 48,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS
): CanvasCamera {
  const availableWidth = Math.max(1, viewport.width - padding * 2)
  const availableHeight = Math.max(1, viewport.height - padding * 2)
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  const zoom = Math.min(limits.max, Math.max(limits.min, Math.min(availableWidth / width, availableHeight / height)))

  return {
    x: bounds.x + bounds.width / 2 - viewport.width / (2 * zoom),
    y: bounds.y + bounds.height / 2 - viewport.height / (2 * zoom),
    zoom,
  }
}

export function rectsIntersect(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function getViewportWorldRect(camera: CanvasCamera, viewport: CanvasViewport): CanvasRect {
  return {
    x: camera.x,
    y: camera.y,
    width: viewport.width / camera.zoom,
    height: viewport.height / camera.zoom,
  }
}

export function expandRect(rect: CanvasRect, amount: number): CanvasRect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  }
}

export function getOverscanWorldRect(
  camera: CanvasCamera,
  viewport: CanvasViewport,
  overscanScreenPixels: number
): CanvasRect {
  return expandRect(getViewportWorldRect(camera, viewport), overscanScreenPixels / camera.zoom)
}

export function getRectBounds(rects: CanvasRect[]): CanvasRect | null {
  if (rects.length === 0) return null

  const left = Math.min(...rects.map(rect => rect.x))
  const top = Math.min(...rects.map(rect => rect.y))
  const right = Math.max(...rects.map(rect => rect.x + rect.width))
  const bottom = Math.max(...rects.map(rect => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
