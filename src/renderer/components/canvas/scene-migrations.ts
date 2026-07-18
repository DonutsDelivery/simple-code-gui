import {
  CANVAS_SCENE_VERSION,
  DEFAULT_CANVAS_SCENE_SETTINGS,
  MAX_CANVAS_OBJECTS,
  MAX_CANVAS_TEXT_BYTES,
  MAX_SKETCH_DOCUMENT_EDGE,
  MAX_SKETCH_POINTS,
  MAX_SKETCH_STROKES,
  MAX_SKETCH_STROKE_WIDTH,
  createEmptyCanvasScene,
  type CanvasContentObject,
  type CanvasGroup,
  type CanvasNodePresentation,
  type CanvasRect,
  type CanvasScene,
  type CanvasSceneSettings,
  type CanvasSketchStroke,
  type CanvasTerminalNode,
} from './scene-model'

export type CanvasSceneLoadResult =
  | { status: 'ok'; scene: CanvasScene; migrated: boolean }
  | { status: 'future-version'; version: number; data: unknown }
  | { status: 'recoverable-error'; reason: string; data: unknown; scene: CanvasScene }

const STATUSES = new Set(['running', 'waiting', 'completed', 'failed', 'restoring', 'suspended'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRect(value: unknown): value is CanvasRect {
  return isRecord(value)
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.width)
    && value.width > 0
    && isFiniteNumber(value.height)
    && value.height > 0
}

function isPresentation(value: unknown): value is CanvasNodePresentation {
  if (!isRecord(value)) return false
  return (value.title === undefined || typeof value.title === 'string')
    && (value.subtitle === undefined || typeof value.subtitle === 'string')
    && (value.color === undefined || typeof value.color === 'string')
    && (value.status === undefined || (typeof value.status === 'string' && STATUSES.has(value.status)))
}

function isNode(value: unknown): value is CanvasTerminalNode {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !Array.isArray(value.tabIds)
    || value.tabIds.length === 0
    || !value.tabIds.every(id => typeof id === 'string')
    || new Set(value.tabIds).size !== value.tabIds.length
    || typeof value.activeTabId !== 'string'
    || !value.tabIds.includes(value.activeTabId)
    || !isRect(value.rect)
    || !isFiniteNumber(value.zIndex)
    || !isPresentation(value.presentation)) return false

  return (value.projectPath === undefined || typeof value.projectPath === 'string')
    && (value.groupId === undefined || typeof value.groupId === 'string')
}

function isGroup(value: unknown): value is CanvasGroup {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && isRect(value.rect)
    && isFiniteNumber(value.zIndex)
    && typeof value.collapsed === 'boolean'
    && (value.color === undefined || typeof value.color === 'string')
}

function isSketchStroke(value: unknown): value is CanvasSketchStroke {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || (value.tool !== 'pen' && value.tool !== 'eraser')
    || typeof value.color !== 'string'
    || !isFiniteNumber(value.width)
    || value.width <= 0
    || value.width > MAX_SKETCH_STROKE_WIDTH
    || !Array.isArray(value.points)) return false

  return value.points.every(point => isRecord(point)
    && isFiniteNumber(point.x)
    && isFiniteNumber(point.y)
    && (point.pressure === undefined
      || (isFiniteNumber(point.pressure) && point.pressure >= 0 && point.pressure <= 1)))
}

function isSketchDocumentSize(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.width)
    && value.width > 0
    && value.width <= MAX_SKETCH_DOCUMENT_EDGE
    && isFiniteNumber(value.height)
    && value.height > 0
    && value.height <= MAX_SKETCH_DOCUMENT_EDGE
}

function isRevision(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isContentObject(value: unknown): value is CanvasContentObject {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !isRect(value.rect)
    || !isFiniteNumber(value.zIndex)
    || (value.groupId !== undefined && typeof value.groupId !== 'string')
    || (value.title !== undefined && typeof value.title !== 'string')) return false

  if (value.kind === 'text') {
    return typeof value.text === 'string' && utf8ByteLength(value.text) <= MAX_CANVAS_TEXT_BYTES
  }
  if (value.kind === 'image') {
    return typeof value.assetId === 'string'
      && (value.altText === undefined || typeof value.altText === 'string')
      && isFiniteNumber(value.intrinsicWidth)
      && value.intrinsicWidth > 0
      && isFiniteNumber(value.intrinsicHeight)
      && value.intrinsicHeight > 0
  }
  if (value.kind === 'sketch') {
    if (!isSketchDocumentSize(value.documentSize)
      || !isRevision(value.revision)
      || !Array.isArray(value.strokes)
      || value.strokes.length > MAX_SKETCH_STROKES
      || !value.strokes.every(isSketchStroke)) return false

    const strokes = value.strokes as CanvasSketchStroke[]
    if (new Set(strokes.map(stroke => stroke.id)).size !== strokes.length
      || strokes.reduce((count, stroke) => count + stroke.points.length, 0) > MAX_SKETCH_POINTS) return false

    return value.export === undefined
      || (isRecord(value.export)
        && typeof value.export.assetId === 'string'
        && isRevision(value.export.revision))
  }
  return false
}

function isSettings(value: unknown): value is CanvasSceneSettings {
  return isRecord(value)
    && typeof value.showGrid === 'boolean'
    && typeof value.showMinimap === 'boolean'
    && typeof value.snapToGrid === 'boolean'
    && isFiniteNumber(value.gridSize)
    && value.gridSize > 0
}

export function isCanvasScene(value: unknown): value is CanvasScene {
  if (!isRecord(value)
    || value.version !== CANVAS_SCENE_VERSION
    || !isRecord(value.camera)
    || !isFiniteNumber(value.camera.x)
    || !isFiniteNumber(value.camera.y)
    || !isFiniteNumber(value.camera.zoom)
    || value.camera.zoom <= 0
    || !Array.isArray(value.nodes)
    || !value.nodes.every(isNode)
    || !Array.isArray(value.objects)
    || value.objects.length > MAX_CANVAS_OBJECTS
    || !value.objects.every(isContentObject)
    || !Array.isArray(value.groups)
    || !value.groups.every(isGroup)
    || !isSettings(value.settings)) return false

  const nodeIds = value.nodes.map(node => node.id)
  const objectIds = value.objects.map(object => object.id)
  const itemIds = [...nodeIds, ...objectIds]
  const tabIds = value.nodes.flatMap(node => node.tabIds)
  const groupIds = value.groups.map(group => group.id)
  if (new Set(itemIds).size !== itemIds.length
    || new Set(tabIds).size !== tabIds.length
    || new Set(groupIds).size !== groupIds.length) return false
  const groupIdSet = new Set(groupIds)
  return value.nodes.every(node => node.groupId === undefined || groupIdSet.has(node.groupId))
    && value.objects.every(object => object.groupId === undefined || groupIdSet.has(object.groupId))
}

function migrateVersionOne(value: Record<string, unknown>): CanvasScene | null {
  const migrated = { ...value, version: CANVAS_SCENE_VERSION, objects: [] }
  return isCanvasScene(migrated) ? migrated : null
}

function migrateVersionZero(value: Record<string, unknown>): CanvasScene | null {
  if (!isRecord(value.camera) || !Array.isArray(value.nodes)) return null

  const versionOne = {
    version: 1,
    camera: value.camera,
    nodes: value.nodes.map(node => isRecord(node) ? { ...node, presentation: node.presentation ?? {} } : node),
    groups: value.groups ?? [],
    settings: { ...DEFAULT_CANVAS_SCENE_SETTINGS, ...(isRecord(value.settings) ? value.settings : {}) },
  }
  return migrateVersionOne(versionOne)
}

export function loadCanvasScene(data: unknown): CanvasSceneLoadResult {
  try {
    if (!isRecord(data) || !Number.isInteger(data.version)) {
      return { status: 'recoverable-error', reason: 'Canvas scene is missing a valid version', data, scene: createEmptyCanvasScene() }
    }

    const version = data.version as number
    if (version > CANVAS_SCENE_VERSION) return { status: 'future-version', version, data }
    if (version === CANVAS_SCENE_VERSION) {
      return isCanvasScene(data)
        ? { status: 'ok', scene: data, migrated: false }
        : { status: 'recoverable-error', reason: 'Canvas scene data is malformed', data, scene: createEmptyCanvasScene() }
    }
    if (version === 1) {
      const scene = migrateVersionOne(data)
      return scene
        ? { status: 'ok', scene, migrated: true }
        : { status: 'recoverable-error', reason: 'Legacy Canvas scene data is malformed', data, scene: createEmptyCanvasScene() }
    }
    if (version === 0) {
      const scene = migrateVersionZero(data)
      return scene
        ? { status: 'ok', scene, migrated: true }
        : { status: 'recoverable-error', reason: 'Legacy Canvas scene data is malformed', data, scene: createEmptyCanvasScene() }
    }
    return { status: 'recoverable-error', reason: `Unsupported Canvas scene version ${version}`, data, scene: createEmptyCanvasScene() }
  } catch {
    return { status: 'recoverable-error', reason: 'Canvas scene data could not be read', data, scene: createEmptyCanvasScene() }
  }
}
