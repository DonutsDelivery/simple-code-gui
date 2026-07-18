import { computeRects, getAllLeaves, type ComputedRect, type TileNode } from '../tile-tree'
import { getRectBounds } from './scene-geometry'
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  createEmptyCanvasScene,
  type CanvasNodePresentation,
  type CanvasRect,
  type CanvasScene,
  type CanvasTerminalNode,
} from './scene-model'

export interface CanvasTabDescriptor {
  id: string
  projectPath?: string
  title?: string
  subtitle?: string
  color?: string
}

export interface GenerateSceneOptions {
  tileTree?: TileNode | null
  tileBounds?: ComputedRect
  columns?: number
  gap?: number
}

function presentationFor(tab: CanvasTabDescriptor | undefined): CanvasNodePresentation {
  return {
    ...(tab?.title ? { title: tab.title } : {}),
    ...(tab?.subtitle ? { subtitle: tab.subtitle } : {}),
    ...(tab?.color ? { color: tab.color } : {}),
  }
}

function commonProjectPath(tabIds: string[], tabsById: Map<string, CanvasTabDescriptor>): string | undefined {
  const paths = new Set(tabIds.map(id => tabsById.get(id)?.projectPath).filter((path): path is string => Boolean(path)))
  return paths.size === 1 ? [...paths][0] : undefined
}

export function generateCanvasScene(tabs: CanvasTabDescriptor[], options: GenerateSceneOptions = {}): CanvasScene {
  const scene = createEmptyCanvasScene()
  const tabsById = new Map(tabs.map(tab => [tab.id, tab]))
  const liveTabIds = new Set(tabsById.keys())

  if (options.tileTree) {
    const leaves = getAllLeaves(options.tileTree)
    const bounds = options.tileBounds ?? { x: 0, y: 0, width: 1360, height: 840 }
    const rects = computeRects(options.tileTree, bounds)
    scene.nodes = leaves.flatMap((leaf, index) => {
      const tabIds = leaf.tabIds.filter(id => liveTabIds.has(id))
      const rect = rects.get(leaf.id)
      if (tabIds.length === 0 || !rect) return []
      const activeTabId = tabIds.includes(leaf.activeTabId) ? leaf.activeTabId : tabIds[0]
      return [{
        id: `tile:${leaf.id}`,
        tabIds,
        activeTabId,
        projectPath: commonProjectPath(tabIds, tabsById),
        rect: { ...rect },
        zIndex: index,
        presentation: presentationFor(tabsById.get(activeTabId)),
      }]
    })

    const placed = new Set(scene.nodes.flatMap(node => node.tabIds))
    return placeOrphanTabs(scene, tabs.filter(tab => !placed.has(tab.id)), options)
  }

  return placeOrphanTabs(scene, tabs, options)
}

function remapId(id: string, remap: Readonly<Record<string, string>>): string {
  return Object.prototype.hasOwnProperty.call(remap, id) ? remap[id] : id
}

export function remapSceneTabIds(scene: CanvasScene, remap: Readonly<Record<string, string>>): CanvasScene {
  const claimedTabIds = new Set<string>()
  return {
    ...scene,
    nodes: scene.nodes.flatMap(node => {
      const tabIds = [...new Set(node.tabIds.map(id => remapId(id, remap)))]
        .filter(id => !claimedTabIds.has(id))
      if (tabIds.length === 0) return []
      tabIds.forEach(id => claimedTabIds.add(id))
      const remappedActive = remapId(node.activeTabId, remap)
      return [{ ...node, tabIds, activeTabId: tabIds.includes(remappedActive) ? remappedActive : tabIds[0] }]
    }),
  }
}

export function filterStaleSceneTabs(scene: CanvasScene, liveTabIds: ReadonlySet<string>): CanvasScene {
  return {
    ...scene,
    nodes: scene.nodes.flatMap(node => {
      const tabIds = node.tabIds.filter(id => liveTabIds.has(id))
      if (tabIds.length === 0) return []
      return [{ ...node, tabIds, activeTabId: tabIds.includes(node.activeTabId) ? node.activeTabId : tabIds[0] }]
    }),
  }
}

export function placeOrphanTabs(
  scene: CanvasScene,
  tabs: CanvasTabDescriptor[],
  options: Pick<GenerateSceneOptions, 'columns' | 'gap'> = {}
): CanvasScene {
  const existingTabIds = new Set(scene.nodes.flatMap(node => node.tabIds))
  const orphans = tabs.filter(tab => !existingTabIds.has(tab.id))
  if (orphans.length === 0) return scene

  const gap = options.gap ?? 48
  const columns = Math.max(1, options.columns ?? Math.ceil(Math.sqrt(orphans.length)))
  const bounds = getRectBounds([
    ...scene.nodes.map(node => node.rect),
    ...scene.objects.map(object => object.rect),
  ])
  const originX = bounds ? bounds.x + bounds.width + gap : 0
  const originY = bounds?.y ?? 0
  const zStart = [
    ...scene.nodes.map(node => node.zIndex),
    ...scene.objects.map(object => object.zIndex),
    ...scene.groups.map(group => group.zIndex),
  ].reduce((max, zIndex) => Math.max(max, zIndex), -1) + 1
  const nodes: CanvasTerminalNode[] = orphans.map((tab, index) => ({
    id: `tab:${tab.id}`,
    tabIds: [tab.id],
    activeTabId: tab.id,
    ...(tab.projectPath ? { projectPath: tab.projectPath } : {}),
    rect: {
      x: originX + (index % columns) * (DEFAULT_NODE_WIDTH + gap),
      y: originY + Math.floor(index / columns) * (DEFAULT_NODE_HEIGHT + gap),
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT,
    },
    zIndex: zStart + index,
    presentation: presentationFor(tab),
  }))
  return { ...scene, nodes: [...scene.nodes, ...nodes] }
}

export interface ReconcileSceneOptions {
  tabIdRemap?: Readonly<Record<string, string>>
  columns?: number
  gap?: number
}

export function reconcileCanvasScene(
  scene: CanvasScene,
  tabs: CanvasTabDescriptor[],
  options: ReconcileSceneOptions = {}
): CanvasScene {
  const remapped = options.tabIdRemap ? remapSceneTabIds(scene, options.tabIdRemap) : scene
  const liveTabIds = new Set(tabs.map(tab => tab.id))
  const filtered = filterStaleSceneTabs(remapped, liveTabIds)
  return placeOrphanTabs(filtered, tabs, options)
}

export function getSceneBounds(scene: CanvasScene): CanvasRect | null {
  return getRectBounds([
    ...scene.nodes.map(node => node.rect),
    ...scene.objects.map(object => object.rect),
    ...scene.groups.map(group => group.rect),
  ])
}
