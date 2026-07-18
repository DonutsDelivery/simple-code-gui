export const CANVAS_SCENE_VERSION = 1 as const

export const DEFAULT_NODE_WIDTH = 680
export const DEFAULT_NODE_HEIGHT = 420

export interface CanvasPoint {
  x: number
  y: number
}

export interface CanvasRect extends CanvasPoint {
  width: number
  height: number
}

export interface CanvasCamera extends CanvasPoint {
  zoom: number
}

export type CanvasTerminalStatus =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'restoring'
  | 'suspended'

export interface CanvasNodePresentation {
  title?: string
  subtitle?: string
  color?: string
  status?: CanvasTerminalStatus
}

export interface CanvasTerminalNode {
  id: string
  tabIds: string[]
  activeTabId: string
  projectPath?: string
  rect: CanvasRect
  zIndex: number
  groupId?: string
  presentation: CanvasNodePresentation
}

export interface CanvasGroup {
  id: string
  title: string
  rect: CanvasRect
  zIndex: number
  collapsed: boolean
  color?: string
}

export interface CanvasSceneSettings {
  showGrid: boolean
  showMinimap: boolean
  snapToGrid: boolean
  gridSize: number
}

export interface CanvasScene {
  version: typeof CANVAS_SCENE_VERSION
  camera: CanvasCamera
  nodes: CanvasTerminalNode[]
  groups: CanvasGroup[]
  settings: CanvasSceneSettings
}

export const DEFAULT_CANVAS_CAMERA: CanvasCamera = { x: 0, y: 0, zoom: 1 }

export const DEFAULT_CANVAS_SCENE_SETTINGS: CanvasSceneSettings = {
  showGrid: true,
  showMinimap: true,
  snapToGrid: false,
  gridSize: 20,
}

export function createEmptyCanvasScene(): CanvasScene {
  return {
    version: CANVAS_SCENE_VERSION,
    camera: { ...DEFAULT_CANVAS_CAMERA },
    nodes: [],
    groups: [],
    settings: { ...DEFAULT_CANVAS_SCENE_SETTINGS },
  }
}
