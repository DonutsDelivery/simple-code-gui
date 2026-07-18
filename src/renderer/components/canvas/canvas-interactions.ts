import { getRectBounds } from './scene-geometry'
import type { CanvasGroup, CanvasRect, CanvasScene, CanvasSpatialItem } from './scene-model'

export type CanvasArrangeMode = 'row' | 'column' | 'grid' | 'stack'
export type SpatialDirection = 'left' | 'right' | 'up' | 'down'

const ARRANGE_GAP = 36
const GROUP_PADDING = 44

function center(rect: CanvasRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function sceneItems(scene: CanvasScene): CanvasSpatialItem[] {
  return [...scene.nodes, ...scene.objects]
}

export function findSpatialNeighbor(
  nodes: CanvasSpatialItem[],
  currentId: string | null,
  direction: SpatialDirection
): string | null {
  if (nodes.length === 0) return null
  const current = nodes.find(node => node.id === currentId)
  if (!current) return [...nodes].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)[0].id

  const origin = center(current.rect)
  const candidates = nodes.filter(node => {
    if (node.id === current.id) return false
    const point = center(node.rect)
    if (direction === 'left') return point.x < origin.x
    if (direction === 'right') return point.x > origin.x
    if (direction === 'up') return point.y < origin.y
    return point.y > origin.y
  })

  candidates.sort((a, b) => {
    const score = (node: CanvasSpatialItem): number => {
      const point = center(node.rect)
      const primary = direction === 'left' || direction === 'right'
        ? Math.abs(point.x - origin.x)
        : Math.abs(point.y - origin.y)
      const cross = direction === 'left' || direction === 'right'
        ? Math.abs(point.y - origin.y)
        : Math.abs(point.x - origin.x)
      return primary + cross * 2
    }
    return score(a) - score(b) || b.zIndex - a.zIndex
  })
  return candidates[0]?.id ?? current.id
}

export function arrangeCanvasNodes(
  scene: CanvasScene,
  selectedIds: ReadonlySet<string>,
  mode: CanvasArrangeMode
): CanvasScene {
  const selected = sceneItems(scene).filter(node => selectedIds.has(node.id))
  if (selected.length < 2) return scene
  const bounds = getRectBounds(selected.map(node => node.rect))
  if (!bounds) return scene

  const ordered = [...selected].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
  const maxWidth = Math.max(...ordered.map(node => node.rect.width))
  const maxHeight = Math.max(...ordered.map(node => node.rect.height))
  const columns = mode === 'grid' ? Math.ceil(Math.sqrt(ordered.length)) : ordered.length
  const positions = new Map<string, { x: number; y: number }>()

  ordered.forEach((node, index) => {
    let column = index
    let row = 0
    if (mode === 'column') {
      column = 0
      row = index
    } else if (mode === 'grid') {
      column = index % columns
      row = Math.floor(index / columns)
    } else if (mode === 'stack') {
      column = 0
      row = 0
      positions.set(node.id, { x: bounds.x + index * 28, y: bounds.y + index * 28 })
      return
    }
    positions.set(node.id, {
      x: bounds.x + column * (maxWidth + ARRANGE_GAP),
      y: bounds.y + row * (maxHeight + ARRANGE_GAP),
    })
  })

  return {
    ...scene,
    nodes: scene.nodes.map(node => {
      const position = positions.get(node.id)
      return position ? { ...node, rect: { ...node.rect, ...position } } : node
    }),
    objects: scene.objects.map(object => {
      const position = positions.get(object.id)
      return position ? { ...object, rect: { ...object.rect, ...position } } : object
    }),
  }
}

export function groupCanvasNodes(
  scene: CanvasScene,
  selectedIds: ReadonlySet<string>,
  groupId: string,
  title = 'Group'
): CanvasScene {
  const selected = sceneItems(scene).filter(node => selectedIds.has(node.id))
  const bounds = getRectBounds(selected.map(node => node.rect))
  if (selected.length < 2 || !bounds) return scene
  const frameZ = Math.min(0, ...selected.map(node => node.zIndex)) - 1
  const group: CanvasGroup = {
    id: groupId,
    title,
    rect: {
      x: bounds.x - GROUP_PADDING,
      y: bounds.y - GROUP_PADDING,
      width: bounds.width + GROUP_PADDING * 2,
      height: bounds.height + GROUP_PADDING * 2,
    },
    zIndex: frameZ,
    collapsed: false,
  }
  return {
    ...scene,
    groups: [...scene.groups, group],
    nodes: scene.nodes.map(node => selectedIds.has(node.id) ? { ...node, groupId } : node),
    objects: scene.objects.map(object => selectedIds.has(object.id) ? { ...object, groupId } : object),
  }
}

export function ungroupCanvasNodes(scene: CanvasScene, selectedIds: ReadonlySet<string>): CanvasScene {
  const groupIds = new Set(sceneItems(scene).filter(item => selectedIds.has(item.id)).map(item => item.groupId).filter(Boolean))
  if (groupIds.size === 0) return scene
  return {
    ...scene,
    groups: scene.groups.filter(group => !groupIds.has(group.id)),
    nodes: scene.nodes.map(node => node.groupId && groupIds.has(node.groupId) ? { ...node, groupId: undefined } : node),
    objects: scene.objects.map(object => object.groupId && groupIds.has(object.groupId) ? { ...object, groupId: undefined } : object),
  }
}
