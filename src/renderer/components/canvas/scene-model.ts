export const CANVAS_SCENE_VERSION = 2 as const

export const MAX_CANVAS_OBJECTS = 500
export const MAX_CANVAS_TEXT_BYTES = 100 * 1024
export const MAX_SKETCH_STROKES = 5_000
export const MAX_SKETCH_POINTS = 200_000
export const MAX_SKETCH_DOCUMENT_EDGE = 4_096
export const MAX_SKETCH_STROKE_WIDTH = 512

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

export interface CanvasSpatialItem {
  id: string
  rect: CanvasRect
  zIndex: number
  groupId?: string
}

export interface CanvasTerminalNode extends CanvasSpatialItem {
  tabIds: string[]
  activeTabId: string
  projectPath?: string
  presentation: CanvasNodePresentation
}

export interface CanvasContentObjectBase extends CanvasSpatialItem {
  kind: 'text' | 'image' | 'sketch'
  title?: string
}

export interface CanvasTextObject extends CanvasContentObjectBase {
  kind: 'text'
  text: string
}

export interface CanvasImageObject extends CanvasContentObjectBase {
  kind: 'image'
  assetId: string
  altText?: string
  intrinsicWidth: number
  intrinsicHeight: number
}

export interface CanvasSketchPoint extends CanvasPoint {
  pressure?: number
}

export interface CanvasSketchStroke {
  id: string
  tool: 'pen' | 'eraser'
  color: string
  width: number
  points: CanvasSketchPoint[]
}

export interface CanvasSize {
  width: number
  height: number
}

export interface CanvasSketchExport {
  assetId: string
  revision: number
}

export interface CanvasSketchObject extends CanvasContentObjectBase {
  kind: 'sketch'
  documentSize: CanvasSize
  strokes: CanvasSketchStroke[]
  revision: number
  export?: CanvasSketchExport
}

export type CanvasContentObject = CanvasTextObject | CanvasImageObject | CanvasSketchObject

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
  objects: CanvasContentObject[]
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
    objects: [],
    groups: [],
    settings: { ...DEFAULT_CANVAS_SCENE_SETTINGS },
  }
}
