import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ErrorBoundary } from '../ErrorBoundary.js'
import type { Api } from '../../api/types.js'
import type { CanvasAssetMetadata } from '../../../common/canvas-assets.js'
import type { Theme } from '../../themes.js'
import { useWorkspaceStore } from '../../stores/workspace.js'
import type { OpenTab, Project } from '../tiled/types.js'
import {
  fitBounds,
  getRectBounds,
  getViewportWorldRect,
  rectsIntersect,
  screenToWorld,
  zoomAtScreenPoint,
  type CanvasViewport,
} from './scene-geometry'
import {
  arrangeCanvasNodes,
  findSpatialNeighbor,
  groupCanvasNodes,
  ungroupCanvasNodes,
  type CanvasArrangeMode,
  type SpatialDirection,
} from './canvas-interactions'
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  type CanvasCamera,
  type CanvasContentObject,
  type CanvasPoint,
  type CanvasRect,
  type CanvasScene,
  type CanvasSpatialItem,
  type CanvasTerminalNode,
} from './scene-model'
import { getNodeDetailLevel, planCanvasNodeMounts, type CanvasNodeDetailLevel } from './scene-visibility'
import { CanvasContentBody } from './CanvasContentBody'
import './canvas.css'

const MIN_NODE_WIDTH = 360
const MIN_NODE_HEIGHT = 220
const MIN_OBJECT_WIDTH = 180
const MIN_OBJECT_HEIGHT = 120
const DEFAULT_MAX_MOUNTED_TERMINALS = 8
const FIT_PADDING = 72
const LazyTerminal = React.lazy(async () => {
  const module = await import('../Terminal.js')
  return { default: module.Terminal }
})

interface CanvasWorkspaceViewProps {
  tabs: OpenTab[]
  projects: Project[]
  theme: Theme
  scene: CanvasScene
  onSceneChange: (scene: CanvasScene) => void
  focusedTabId?: string | null
  onFocusTab: (id: string) => void
  onCloseTab: (id: string) => void
  onResumeTab?: (id: string) => Promise<void>
  onRenameTab: (id: string, title: string) => void
  onDropProject?: (projectPath: string, point: CanvasPoint) => void
  api?: Api
  isWorkspaceActive?: boolean
  maxMountedTerminals?: number
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'
type Gesture =
  | { kind: 'pan'; start: CanvasPoint; camera: CanvasCamera }
  | { kind: 'marquee'; startWorld: CanvasPoint; currentWorld: CanvasPoint; additive: boolean }
  | { kind: 'move'; start: CanvasPoint; scene: CanvasScene; itemIds: string[] }
  | { kind: 'group-move'; start: CanvasPoint; scene: CanvasScene; groupId: string }
  | { kind: 'resize'; start: CanvasPoint; scene: CanvasScene; itemId: string; handle: ResizeHandle }

function eventPoint(event: { clientX: number; clientY: number }, element: HTMLElement): CanvasPoint {
  const rect = element.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function normalizeRect(a: CanvasPoint, b: CanvasPoint): CanvasRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

function sceneItems(scene: CanvasScene): CanvasSpatialItem[] {
  return [...scene.nodes, ...scene.objects]
}

function nextZIndex(scene: CanvasScene): number {
  return Math.max(
    0,
    ...scene.nodes.map(node => node.zIndex),
    ...scene.objects.map(object => object.zIndex),
    ...scene.groups.map(group => group.zIndex),
  ) + 1
}

function updateSpatialItems(
  scene: CanvasScene,
  update: (item: CanvasSpatialItem) => CanvasSpatialItem,
): CanvasScene {
  return {
    ...scene,
    nodes: scene.nodes.map(node => update(node) as CanvasTerminalNode),
    objects: scene.objects.map(object => update(object) as CanvasContentObject),
  }
}

function contentLabel(object: CanvasContentObject): string {
  if (object.title?.trim()) return object.title.trim()
  if (object.kind === 'text') return object.text.trim().split('\n')[0]?.slice(0, 60) || 'Untitled note'
  if (object.kind === 'image') return object.altText?.trim() || 'Image'
  return 'Sketch'
}

function contentId(kind: CanvasContentObject['kind']): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${kind}:${id}`
}

function statusLabel(node: CanvasTerminalNode): string {
  const status = node.presentation.status ?? 'running'
  if (status === 'waiting') return 'Needs input'
  if (status === 'failed') return 'Exited'
  if (status === 'completed') return 'Completed'
  if (status === 'restoring') return 'Restoring'
  if (status === 'suspended') return 'Preview'
  return 'Running'
}

const CanvasTerminalCard = React.memo(function CanvasTerminalCard({
  node,
  tab,
  tabs,
  project,
  detail,
  mounted,
  selected,
  focused,
  workspaceActive,
  theme,
  api,
  onSelect,
  onMoveStart,
  onResizeStart,
  onActivate,
  onCloseTab,
  onResumeTab,
  onRenameTab,
}: {
  node: CanvasTerminalNode
  tab: OpenTab | undefined
  tabs: OpenTab[]
  project: Project | undefined
  detail: CanvasNodeDetailLevel
  mounted: boolean
  selected: boolean
  focused: boolean
  workspaceActive: boolean
  theme: Theme
  api?: Api
  onSelect: (event: React.PointerEvent) => void
  onMoveStart: (event: React.PointerEvent) => void
  onResizeStart: (event: React.PointerEvent, handle: ResizeHandle) => void
  onActivate: (tabId: string) => void
  onCloseTab: (id: string) => void
  onResumeTab?: (id: string) => Promise<void>
  onRenameTab: (id: string, title: string) => void
}): React.ReactElement {
  const attentionByTabId = useWorkspaceStore(useShallow(state => Object.fromEntries(
    tabs.map(candidate => [candidate.id, state.attentionByTabId[candidate.id]]),
  )))
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [resuming, setResuming] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(tab?.title ?? node.presentation.title ?? 'Terminal')

  useEffect(() => setTitle(tab?.title ?? node.presentation.title ?? 'Terminal'), [node.presentation.title, tab?.title])

  const commitTitle = (): void => {
    const value = title.trim()
    if (tab && value && value !== tab.title) onRenameTab(tab.id, value)
    else setTitle(tab?.title ?? node.presentation.title ?? 'Terminal')
    setEditing(false)
  }

  const resume = async (): Promise<void> => {
    if (!tab || !onResumeTab || resuming) return
    setResuming(true)
    try {
      await onResumeTab(tab.id)
      setExitCode(null)
    } finally {
      setResuming(false)
    }
  }

  const cardTitle = tab?.title ?? node.presentation.title ?? 'Terminal'
  const subtitle = node.presentation.subtitle ?? project?.name ?? tab?.projectPath ?? 'Session'
  const status = statusLabel(node)
  const activeAttention = attentionByTabId[node.activeTabId]

  return (
    <article
      data-agent-visible-tab-id={mounted ? node.activeTabId : undefined}
      className={`canvas-node canvas-node--${detail}${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}${mounted ? ' is-mounted' : ' is-suspended'}${activeAttention ? ` has-agent-attention has-agent-attention--${activeAttention}` : ''}`}
      style={{
        left: node.rect.x,
        top: node.rect.y,
        width: node.rect.width,
        height: node.rect.height,
        zIndex: node.zIndex,
        '--canvas-project-color': node.presentation.color ?? project?.color ?? theme.colors.info,
      } as React.CSSProperties}
      role="option"
      aria-label={`${cardTitle}, ${status}`}
      aria-selected={selected}
      data-node-id={node.id}
      onPointerDown={onSelect}
      onDoubleClick={() => tab && onActivate(tab.id)}
    >
      <header className="canvas-node__header" onPointerDown={onMoveStart}>
        <span className="canvas-node__mark" aria-hidden="true" />
        {activeAttention && <span className="agent-attention-dot" aria-hidden="true" />}
        <span className="canvas-node__identity">
          {editing && tab ? (
            <input
              className="canvas-node__title-input"
              value={title}
              aria-label="Terminal title"
              autoFocus
              onChange={event => setTitle(event.target.value)}
              onBlur={commitTitle}
              onPointerDown={event => event.stopPropagation()}
              onKeyDown={event => {
                event.stopPropagation()
                if (event.key === 'Enter') commitTitle()
                if (event.key === 'Escape') {
                  setTitle(tab.title)
                  setEditing(false)
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="canvas-node__title"
              title="Double-click to rename"
              onPointerDown={event => event.stopPropagation()}
              onDoubleClick={event => { event.stopPropagation(); setEditing(true) }}
              onClick={() => tab && onActivate(tab.id)}
            >{cardTitle}</button>
          )}
          {detail !== 'identity' && <span className="canvas-node__subtitle">{subtitle}</span>}
        </span>
        <span className={`canvas-node__status canvas-node__status--${node.presentation.status ?? 'running'}`}>
          <span aria-hidden="true" className="canvas-node__status-glyph" />
          {detail !== 'identity' && status}
        </span>
        {detail === 'full' && tab && (
          <button
            type="button"
            className="canvas-node__close"
            aria-label={`Close ${cardTitle}`}
            title="Close session"
            onPointerDown={event => event.stopPropagation()}
            onClick={() => onCloseTab(tab.id)}
          >×</button>
        )}
      </header>

      {detail === 'identity' ? null : detail === 'summary' ? (
        <div className="canvas-node__summary" aria-hidden="true">
          <span />
          <span />
          <span />
          <small>{tabs.length > 1 ? `${tabs.length} sessions` : 'Recent terminal activity'}</small>
        </div>
      ) : mounted && tab ? (
        <div className="canvas-node__terminal">
          <ErrorBoundary componentName={`Canvas terminal (${cardTitle})`}>
            <React.Suspense fallback={<div className="canvas-node__terminal-loading" aria-label="Loading terminal" />}>
              <LazyTerminal
                ptyId={tab.id}
                isActive={workspaceActive && focused && detail === 'full'}
                theme={theme}
                onFocus={() => onActivate(tab.id)}
                projectPath={tab.projectPath}
                backend={tab.backend}
                api={api}
                onPtyExit={setExitCode}
              />
            </React.Suspense>
          </ErrorBoundary>
          {exitCode !== null && (
            <div className="canvas-node__recovery" role="status">
              <span>Process exited ({exitCode})</span>
              <button type="button" onClick={() => void resume()} disabled={!onResumeTab || resuming}>
                {resuming ? 'Resuming…' : 'Resume'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="canvas-node__preview" aria-label="Suspended terminal preview">
          <span /><span /><span /><span />
          <small>Preview</small>
        </div>
      )}

      {tabs.length > 1 && detail !== 'identity' && (
        <div className="canvas-node__tabs" aria-label="Sessions in this card">
          {tabs.map(candidate => (
            <button
              key={candidate.id}
              type="button"
              className={`${candidate.id === node.activeTabId ? 'is-active' : ''}${attentionByTabId[candidate.id] ? ` has-agent-attention has-agent-attention--${attentionByTabId[candidate.id]}` : ''}`}
              aria-label={`${candidate.title}${attentionByTabId[candidate.id] === 'needs-input' ? ', needs your input' : attentionByTabId[candidate.id] === 'completed' ? ', agent completed' : ''}`}
              onPointerDown={event => event.stopPropagation()}
              onClick={() => onActivate(candidate.id)}
            >
              {candidate.title}
              {attentionByTabId[candidate.id] && <span className="agent-attention-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          {(['nw', 'ne', 'sw', 'se'] as ResizeHandle[]).map(handle => (
            <button
              key={handle}
              type="button"
              className={`canvas-node__resize canvas-node__resize--${handle}`}
              aria-label={`Resize ${cardTitle} from ${handle}`}
              onPointerDown={event => onResizeStart(event, handle)}
            />
          ))}
        </>
      )}
    </article>
  )
}, (previous, next) =>
  previous.node === next.node &&
  previous.tab === next.tab &&
  previous.tabs.length === next.tabs.length &&
  previous.tabs.every((tab, index) => tab === next.tabs[index]) &&
  previous.project === next.project &&
  previous.detail === next.detail &&
  previous.mounted === next.mounted &&
  previous.selected === next.selected &&
  previous.focused === next.focused &&
  previous.workspaceActive === next.workspaceActive &&
  previous.theme === next.theme &&
  previous.api === next.api &&
  previous.onCloseTab === next.onCloseTab &&
  previous.onResumeTab === next.onResumeTab &&
  previous.onRenameTab === next.onRenameTab
)

const CanvasObjectCard = React.memo(function CanvasObjectCard({
  object,
  selected,
  focused,
  api,
  onSelect,
  onMoveStart,
  onResizeStart,
  onChange,
  onRemove,
  onAnnounce,
}: {
  object: CanvasContentObject
  selected: boolean
  focused: boolean
  api?: Api
  onSelect: (event: React.PointerEvent) => void
  onMoveStart: (event: React.PointerEvent) => void
  onResizeStart: (event: React.PointerEvent, handle: ResizeHandle) => void
  onChange: (object: CanvasContentObject) => void
  onRemove: () => void
  onAnnounce: (message: string) => void
}): React.ReactElement {
  const label = contentLabel(object)
  return (
    <article
      className={`canvas-node canvas-content canvas-content--${object.kind}${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}`}
      style={{
        left: object.rect.x,
        top: object.rect.y,
        width: object.rect.width,
        height: object.rect.height,
        zIndex: object.zIndex,
      }}
      role="option"
      aria-label={`${object.kind}, ${label}`}
      aria-selected={selected}
      data-node-id={object.id}
      onPointerDown={onSelect}
    >
      <header className="canvas-node__header canvas-content__header" onPointerDown={onMoveStart}>
        <span className="canvas-node__mark" aria-hidden="true" />
        <span className="canvas-node__identity">
          <strong className="canvas-node__title">{label}</strong>
          <span className="canvas-node__subtitle">{object.kind}</span>
        </span>
        <button
          type="button"
          className="canvas-node__close"
          aria-label={`Remove ${label}`}
          title="Remove from Canvas"
          onPointerDown={event => event.stopPropagation()}
          onClick={onRemove}
        >×</button>
      </header>
      <div className="canvas-content__body">
        <CanvasContentBody
          object={object}
          api={api}
          onChange={onChange}
          onRemove={onRemove}
          onAnnounce={onAnnounce}
        />
      </div>
      {(['nw', 'ne', 'sw', 'se'] as ResizeHandle[]).map(handle => (
        <button
          key={handle}
          type="button"
          className={`canvas-node__resize canvas-node__resize--${handle}`}
          aria-label={`Resize ${label} from ${handle}`}
          onPointerDown={event => onResizeStart(event, handle)}
        />
      ))}
    </article>
  )
})

function CanvasMinimap({
  scene,
  viewport,
  onNavigate,
}: {
  scene: CanvasScene
  viewport: CanvasViewport
  onNavigate: (point: CanvasPoint) => void
}): React.ReactElement | null {
  const content = getRectBounds([
    ...scene.nodes.map(node => node.rect),
    ...scene.objects.map(object => object.rect),
    ...scene.groups.map(group => group.rect),
    getViewportWorldRect(scene.camera, viewport),
  ])
  if (!content) return null
  const padding = 12
  const width = 168
  const height = 108
  const scale = Math.min((width - padding * 2) / Math.max(1, content.width), (height - padding * 2) / Math.max(1, content.height))
  const mapPoint = (x: number, y: number): CanvasPoint => ({
    x: padding + (x - content.x) * scale,
    y: padding + (y - content.y) * scale,
  })
  const view = getViewportWorldRect(scene.camera, viewport)
  const viewPoint = mapPoint(view.x, view.y)
  const groupRects = useMemo(() => scene.groups.map(group => {
    const point = mapPoint(group.rect.x, group.rect.y)
    return <rect key={group.id} className="canvas-minimap__group" x={point.x} y={point.y} width={group.rect.width * scale} height={group.rect.height * scale} />
  }), [content.x, content.y, scale, scene.groups])
  const nodeRects = useMemo(() => scene.nodes.map(node => {
    const point = mapPoint(node.rect.x, node.rect.y)
    return <rect key={node.id} className="canvas-minimap__node" x={point.x} y={point.y} width={Math.max(2, node.rect.width * scale)} height={Math.max(2, node.rect.height * scale)} />
  }), [content.x, content.y, scale, scene.nodes])
  const objectRects = useMemo(() => scene.objects.map(object => {
    const point = mapPoint(object.rect.x, object.rect.y)
    return <rect key={object.id} className={`canvas-minimap__object canvas-minimap__object--${object.kind}`} x={point.x} y={point.y} width={Math.max(2, object.rect.width * scale)} height={Math.max(2, object.rect.height * scale)} />
  }), [content.x, content.y, scale, scene.objects])

  return (
    <button
      type="button"
      className="canvas-minimap"
      aria-label="Canvas minimap. Click to navigate."
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        onNavigate({
          x: content.x + (event.clientX - rect.left - padding) / scale,
          y: content.y + (event.clientY - rect.top - padding) / scale,
        })
      }}
    >
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {groupRects}
        {nodeRects}
        {objectRects}
        <rect className="canvas-minimap__viewport" x={viewPoint.x} y={viewPoint.y} width={view.width * scale} height={view.height * scale} />
      </svg>
    </button>
  )
}

export function CanvasWorkspaceView({
  tabs,
  projects,
  theme,
  scene,
  onSceneChange,
  focusedTabId = null,
  onFocusTab,
  onCloseTab,
  onResumeTab,
  onRenameTab,
  onDropProject,
  api,
  isWorkspaceActive = true,
  maxMountedTerminals = DEFAULT_MAX_MOUNTED_TERMINALS,
}: CanvasWorkspaceViewProps): React.ReactElement {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef(scene)
  const gestureRef = useRef<Gesture | null>(null)
  const spaceHeldRef = useRef(false)
  const pendingSceneRef = useRef<CanvasScene | null>(null)
  const publishFrameRef = useRef<number | null>(null)
  const [draft, setDraft] = useState(scene)
  const [viewport, setViewport] = useState<CanvasViewport>({ width: 1, height: 1 })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupTitle, setEditingGroupTitle] = useState('')
  const [actionAnnouncement, setActionAnnouncement] = useState('')
  const lastPointerWorldRef = useRef<CanvasPoint | null>(null)
  const [, setGestureTick] = useState(0)

  useEffect(() => {
    if (!actionAnnouncement) return
    const timeout = window.setTimeout(() => setActionAnnouncement(''), 1600)
    return () => window.clearTimeout(timeout)
  }, [actionAnnouncement])

  useEffect(() => {
    if (!gestureRef.current) {
      sceneRef.current = scene
      setDraft(scene)
    }
  }, [scene])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const update = (): void => {
      const rect = surface.getBoundingClientRect()
      setViewport({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(surface)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => () => {
    if (publishFrameRef.current !== null) cancelAnimationFrame(publishFrameRef.current)
  }, [])

  const publishScene = useCallback((next: CanvasScene): void => {
    sceneRef.current = next
    setDraft(next)
    pendingSceneRef.current = next
    if (publishFrameRef.current !== null) return
    publishFrameRef.current = requestAnimationFrame(() => {
      publishFrameRef.current = null
      const pending = pendingSceneRef.current
      pendingSceneRef.current = null
      if (pending) onSceneChange(pending)
    })
  }, [onSceneChange])

  const setCamera = useCallback((camera: CanvasCamera): void => {
    publishScene({ ...sceneRef.current, camera })
  }, [publishScene])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const cursor = eventPoint(event, surface)
      const factor = Math.exp(-event.deltaY * 0.002)
      setCamera(zoomAtScreenPoint(sceneRef.current.camera, sceneRef.current.camera.zoom * factor, cursor))
    }
    surface.addEventListener('wheel', handleWheel, { passive: false })
    return () => surface.removeEventListener('wheel', handleWheel)
  }, [setCamera])

  const fitRects = useCallback((rects: CanvasRect[]): void => {
    const bounds = getRectBounds(rects)
    if (bounds) setCamera(fitBounds(bounds, viewport, FIT_PADDING))
  }, [setCamera, viewport])

  const selectItem = useCallback((event: React.PointerEvent, item: CanvasSpatialItem): void => {
    if (event.button !== 0 || spaceHeldRef.current) return
    event.stopPropagation()
    const toggle = event.shiftKey || event.ctrlKey || event.metaKey
    setSelectedIds(current => {
      if (toggle) {
        const next = new Set(current)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      }
      return current.has(item.id) && current.size === 1 ? current : new Set([item.id])
    })
    setFocusedNodeId(item.id)
    publishScene(updateSpatialItems(sceneRef.current, candidate => candidate.id === item.id
      ? { ...candidate, zIndex: nextZIndex(sceneRef.current) }
      : candidate))
  }, [publishScene])

  const startMove = useCallback((event: React.PointerEvent, item: CanvasSpatialItem): void => {
    if (event.button !== 0 || spaceHeldRef.current) return
    event.preventDefault()
    event.stopPropagation()
    const ids = selectedIds.has(item.id) ? [...selectedIds] : [item.id]
    if (!selectedIds.has(item.id)) setSelectedIds(new Set([item.id]))
    setFocusedNodeId(item.id)
    const raisedScene = updateSpatialItems(sceneRef.current, candidate => candidate.id === item.id
      ? { ...candidate, zIndex: nextZIndex(sceneRef.current) }
      : candidate)
    publishScene(raisedScene)
    gestureRef.current = { kind: 'move', start: { x: event.clientX, y: event.clientY }, scene: raisedScene, itemIds: ids }
    setGestureTick(value => value + 1)
  }, [publishScene, selectedIds])

  const startResize = useCallback((event: React.PointerEvent, item: CanvasSpatialItem, handle: ResizeHandle): void => {
    if (event.button !== 0 || selectedIds.size !== 1) return
    event.preventDefault()
    event.stopPropagation()
    gestureRef.current = { kind: 'resize', start: { x: event.clientX, y: event.clientY }, scene: sceneRef.current, itemId: item.id, handle }
    setGestureTick(value => value + 1)
  }, [selectedIds.size])

  const startGroupMove = useCallback((event: React.PointerEvent, groupId: string): void => {
    if (event.button !== 0 || spaceHeldRef.current) return
    event.preventDefault()
    event.stopPropagation()
    gestureRef.current = { kind: 'group-move', start: { x: event.clientX, y: event.clientY }, scene: sceneRef.current, groupId }
    setGestureTick(value => value + 1)
  }, [])

  const commitGroupRename = useCallback((): void => {
    if (!editingGroupId) return
    const title = editingGroupTitle.trim()
    if (title) {
      publishScene({
        ...sceneRef.current,
        groups: sceneRef.current.groups.map(group => group.id === editingGroupId ? { ...group, title } : group),
      })
    }
    setEditingGroupId(null)
  }, [editingGroupId, editingGroupTitle, publishScene])

  const viewportCenter = useCallback((): CanvasPoint => screenToWorld(
    { x: viewport.width / 2, y: viewport.height / 2 },
    sceneRef.current.camera,
  ), [viewport])

  const addObject = useCallback((object: CanvasContentObject): void => {
    publishScene({ ...sceneRef.current, objects: [...sceneRef.current.objects, object] })
    setSelectedIds(new Set([object.id]))
    setFocusedNodeId(object.id)
  }, [publishScene])

  const addImageObject = useCallback((asset: CanvasAssetMetadata, point = viewportCenter()): void => {
    const width = Math.min(520, Math.max(MIN_OBJECT_WIDTH, asset.width))
    const height = Math.max(MIN_OBJECT_HEIGHT, width * asset.height / asset.width)
    const object: CanvasContentObject = {
      id: contentId('image'),
      kind: 'image',
      assetId: asset.id,
      intrinsicWidth: asset.width,
      intrinsicHeight: asset.height,
      rect: { x: point.x - width / 2, y: point.y - height / 2, width, height },
      zIndex: nextZIndex(sceneRef.current),
    }
    addObject(object)
    setActionAnnouncement('Image added to Canvas.')
  }, [addObject, viewportCenter])

  const addNote = useCallback((): void => {
    const point = viewportCenter()
    addObject({
      id: contentId('text'),
      kind: 'text',
      text: '',
      rect: { x: point.x - 160, y: point.y - 110, width: 320, height: 220 },
      zIndex: nextZIndex(sceneRef.current),
    })
    setActionAnnouncement('Note added to Canvas.')
  }, [addObject, viewportCenter])

  const addSketch = useCallback((): void => {
    const point = viewportCenter()
    addObject({
      id: contentId('sketch'),
      kind: 'sketch',
      documentSize: { width: 960, height: 600 },
      strokes: [],
      revision: 0,
      rect: { x: point.x - 260, y: point.y - 180, width: 520, height: 360 },
      zIndex: nextZIndex(sceneRef.current),
    })
    setActionAnnouncement('Sketch pad added to Canvas.')
  }, [addObject, viewportCenter])

  const pickImage = useCallback(async (): Promise<void> => {
    const result = await api?.pickCanvasAsset?.()
    if (!result?.ok || !result.value) {
      if (result && !result.ok) setActionAnnouncement(`Image import failed: ${result.error}.`)
      return
    }
    addImageObject(result.value, viewportCenter())
  }, [addImageObject, api, viewportCenter])

  const importImageFile = useCallback(async (file: File, point: CanvasPoint): Promise<void> => {
    const result = await api?.importCanvasAssetBytes?.(new Uint8Array(await file.arrayBuffer()))
    if (!result?.ok) {
      setActionAnnouncement(`Image import failed${result ? `: ${result.error}.` : '.'}`)
      return
    }
    addImageObject(result.value, point)
  }, [addImageObject, api])

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const gesture = gestureRef.current
      const surface = surfaceRef.current
      if (!gesture || !surface) return
      if (gesture.kind === 'pan') {
        const dx = (event.clientX - gesture.start.x) / gesture.camera.zoom
        const dy = (event.clientY - gesture.start.y) / gesture.camera.zoom
        setCamera({ ...gesture.camera, x: gesture.camera.x - dx, y: gesture.camera.y - dy })
        return
      }
      if (gesture.kind === 'marquee') {
        gestureRef.current = { ...gesture, currentWorld: screenToWorld(eventPoint(event, surface), sceneRef.current.camera) }
        setGestureTick(value => value + 1)
        return
      }
      const dx = (event.clientX - gesture.start.x) / gesture.scene.camera.zoom
      const dy = (event.clientY - gesture.start.y) / gesture.scene.camera.zoom
      if (gesture.kind === 'move') {
        const ids = new Set(gesture.itemIds)
        publishScene(updateSpatialItems(gesture.scene, item => ids.has(item.id)
          ? { ...item, rect: { ...item.rect, x: item.rect.x + dx, y: item.rect.y + dy } }
          : item))
        return
      }
      if (gesture.kind === 'group-move') {
        const moved = updateSpatialItems(gesture.scene, item => item.groupId === gesture.groupId
          ? { ...item, rect: { ...item.rect, x: item.rect.x + dx, y: item.rect.y + dy } }
          : item)
        publishScene({
          ...moved,
          groups: gesture.scene.groups.map(group => group.id === gesture.groupId
            ? { ...group, rect: { ...group.rect, x: group.rect.x + dx, y: group.rect.y + dy } }
            : group),
        })
        return
      }
      const terminal = gesture.scene.nodes.some(node => node.id === gesture.itemId)
      const minWidth = terminal ? MIN_NODE_WIDTH : MIN_OBJECT_WIDTH
      const minHeight = terminal ? MIN_NODE_HEIGHT : MIN_OBJECT_HEIGHT
      publishScene(updateSpatialItems(gesture.scene, item => {
        if (item.id !== gesture.itemId) return item
        const left = gesture.handle.includes('w') ? Math.min(item.rect.x + dx, item.rect.x + item.rect.width - minWidth) : item.rect.x
        const top = gesture.handle.includes('n') ? Math.min(item.rect.y + dy, item.rect.y + item.rect.height - minHeight) : item.rect.y
        const right = gesture.handle.includes('e') ? Math.max(item.rect.x + item.rect.width + dx, item.rect.x + minWidth) : item.rect.x + item.rect.width
        const bottom = gesture.handle.includes('s') ? Math.max(item.rect.y + item.rect.height + dy, item.rect.y + minHeight) : item.rect.y + item.rect.height
        return { ...item, rect: { x: left, y: top, width: right - left, height: bottom - top } }
      }))
    }
    const end = (): void => {
      const gesture = gestureRef.current
      if (gesture?.kind === 'marquee') {
        const marquee = normalizeRect(gesture.startWorld, gesture.currentWorld)
        const hits = sceneItems(sceneRef.current).filter(item => rectsIntersect(item.rect, marquee)).map(item => item.id)
        setSelectedIds(current => gesture.additive ? new Set([...current, ...hits]) : new Set(hits))
      }
      if (gesture) {
        gestureRef.current = null
        setGestureTick(value => value + 1)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [publishScene, setCamera])

  const handleSurfacePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button === 1 || (event.button === 0 && spaceHeldRef.current)) {
      event.preventDefault()
      gestureRef.current = { kind: 'pan', start: { x: event.clientX, y: event.clientY }, camera: sceneRef.current.camera }
      setGestureTick(value => value + 1)
      return
    }
    if (event.button !== 0 || event.target !== event.currentTarget) return
    const point = screenToWorld(eventPoint(event, event.currentTarget), sceneRef.current.camera)
    lastPointerWorldRef.current = point
    gestureRef.current = {
      kind: 'marquee',
      startWorld: point,
      currentWorld: point,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
    }
    if (!(event.shiftKey || event.ctrlKey || event.metaKey)) setSelectedIds(new Set())
    setGestureTick(value => value + 1)
  }

  const handleSurfaceMouseDownCapture = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 1) return
    event.preventDefault()
    event.stopPropagation()
  }

  const handleSurfaceAuxClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 1) return
    event.preventDefault()
    event.stopPropagation()
  }

  const handleCanvasDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    const types = event.dataTransfer.types
    if (types.includes('application/x-sidebar-project') ||
      types.includes('application/x-subtab') ||
      types.includes('application/x-sidebar-session') ||
      types.includes('application/x-canvas-tab') ||
      types.includes('Files')) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
  }

  const handleCanvasDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    const surface = surfaceRef.current
    if (!surface) return
    const projectPath = event.dataTransfer.getData('application/x-sidebar-project')
    const point = screenToWorld(eventPoint(event, surface), sceneRef.current.camera)
    if (projectPath) {
      event.preventDefault()
      onDropProject?.(projectPath, point)
      return
    }

    const imageFile = Array.from(event.dataTransfer.files ?? []).find(file => file.type.startsWith('image/'))
    if (imageFile) {
      event.preventDefault()
      void importImageFile(imageFile, point)
      return
    }

    const rawSession = event.dataTransfer.getData('application/x-subtab') ||
      event.dataTransfer.getData('application/x-sidebar-session') ||
      event.dataTransfer.getData('application/x-canvas-tab')
    if (!rawSession) return
    event.preventDefault()
    let tabId = rawSession
    try {
      const payload = JSON.parse(rawSession) as { tabId?: string; id?: string }
      tabId = payload.tabId ?? payload.id ?? rawSession
    } catch {
      // Raw session ids are also accepted.
    }
    const tab = tabs.find(candidate => candidate.id === tabId)
    if (!tab) return
    const source = sceneRef.current.nodes.find(node => node.tabIds.includes(tabId))
    const rect = { x: point.x, y: point.y, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT }
    if (source?.tabIds.length === 1) {
      publishScene({
        ...sceneRef.current,
        nodes: sceneRef.current.nodes.map(node => node.id === source.id
          ? { ...node, rect: { ...node.rect, x: point.x, y: point.y }, zIndex: nextZIndex(sceneRef.current), groupId: undefined }
          : node),
      })
      return
    }

    const project = projects.find(candidate => candidate.path === tab.projectPath)
    const newNode: CanvasTerminalNode = {
      id: `tab:${tab.id}`,
      tabIds: [tab.id],
      activeTabId: tab.id,
      projectPath: tab.projectPath,
      rect,
      zIndex: nextZIndex(sceneRef.current),
      presentation: { title: tab.title, subtitle: project?.name, color: project?.color },
    }
    publishScene({
      ...sceneRef.current,
      nodes: [
        ...sceneRef.current.nodes.flatMap(node => {
          if (node.id !== source?.id) return [node]
          const tabIds = node.tabIds.filter(id => id !== tabId)
          return [{ ...node, tabIds, activeTabId: node.activeTabId === tabId ? tabIds[0] : node.activeTabId }]
        }),
        newNode,
      ],
    })
  }

  const handleCanvasPaste = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    const point = lastPointerWorldRef.current ?? viewportCenter()
    const imageFile = Array.from(event.clipboardData.files ?? []).find(file => file.type.startsWith('image/'))
    if (imageFile) {
      event.preventDefault()
      void importImageFile(imageFile, point)
      return
    }
    if (!api?.importCanvasClipboardAsset) return
    event.preventDefault()
    void api.importCanvasClipboardAsset().then(result => {
      if (result.ok && result.value) addImageObject(result.value, point)
      else if (!result.ok) setActionAnnouncement(`Image paste failed: ${result.error}.`)
    })
  }

  const activateNode = useCallback((node: CanvasTerminalNode, tabId = node.activeTabId): void => {
    if (tabId !== node.activeTabId) {
      publishScene({
        ...sceneRef.current,
        nodes: sceneRef.current.nodes.map(item => item.id === node.id ? { ...item, activeTabId: tabId } : item),
      })
    }
    onFocusTab(tabId)
    setFocusedNodeId(node.id)
    setSelectedIds(new Set([node.id]))
    requestAnimationFrame(() => surfaceRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"] .xterm-helper-textarea`)?.focus())
  }, [onFocusTab, publishScene])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.code === 'Space') {
      spaceHeldRef.current = true
      event.preventDefault()
      return
    }
    const directionByKey: Record<string, SpatialDirection | undefined> = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    }
    const direction = directionByKey[event.key]
    if (direction) {
      event.preventDefault()
      if (event.shiftKey && selectedIds.size > 0) {
        const step = draft.settings.gridSize
        const offset = {
          x: direction === 'left' ? -step : direction === 'right' ? step : 0,
          y: direction === 'up' ? -step : direction === 'down' ? step : 0,
        }
        publishScene(updateSpatialItems(draft, item => selectedIds.has(item.id)
          ? { ...item, rect: { ...item.rect, x: item.rect.x + offset.x, y: item.rect.y + offset.y } }
          : item))
        return
      }
      const visibleNodes = sceneItems(draft).filter(item => !item.groupId || !draft.groups.some(group => group.id === item.groupId && group.collapsed))
      const next = findSpatialNeighbor(visibleNodes, focusedNodeId, direction)
      if (next) {
        setFocusedNodeId(next)
        setSelectedIds(new Set([next]))
      }
      return
    }
    const node = draft.nodes.find(item => item.id === focusedNodeId)
    const object = draft.objects.find(item => item.id === focusedNodeId)
    const zoomIn = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd'
    const zoomOut = event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract'
    if (zoomIn || zoomOut) {
      event.preventDefault()
      zoomAroundCenter(zoomIn ? 1.25 : 0.8)
    } else if (event.key === 'Enter' && node) {
      event.preventDefault()
      activateNode(node)
    } else if (event.key === 'Enter' && object) {
      event.preventDefault()
      surfaceRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(object.id)}"] [data-canvas-editor="true"]`)?.focus()
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.size > 0) {
      const removableIds = new Set(draft.objects.filter(item => selectedIds.has(item.id)).map(item => item.id))
      if (removableIds.size > 0) {
        event.preventDefault()
        publishScene({ ...draft, objects: draft.objects.filter(item => !removableIds.has(item.id)) })
        setSelectedIds(current => new Set([...current].filter(id => !removableIds.has(id))))
        if (focusedNodeId && removableIds.has(focusedNodeId)) setFocusedNodeId(null)
        setActionAnnouncement(`${removableIds.size} Canvas ${removableIds.size === 1 ? 'item' : 'items'} removed.`)
      }
    } else if (event.key === '0') {
      event.preventDefault()
      if (event.shiftKey) setCamera({ x: 0, y: 0, zoom: 1 })
      else fitRects([...sceneItems(draft).map(item => item.rect), ...draft.groups.map(group => group.rect)])
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault()
      fitRects(sceneItems(draft).filter(item => selectedIds.has(item.id)).map(item => item.rect))
    } else if (event.key.toLowerCase() === 'g') {
      event.preventDefault()
      if (event.shiftKey) publishScene(ungroupCanvasNodes(draft, selectedIds))
      else publishScene(groupCanvasNodes(draft, selectedIds, `group-${Date.now()}`))
    }
  }

  const arrange = (mode: CanvasArrangeMode): void => publishScene(arrangeCanvasNodes(sceneRef.current, selectedIds, mode))
  const zoomAroundCenter = (factor: number): void => setCamera(zoomAtScreenPoint(
    sceneRef.current.camera,
    sceneRef.current.camera.zoom * factor,
    { x: viewport.width / 2, y: viewport.height / 2 }
  ))

  const detail = getNodeDetailLevel(draft.camera.zoom)
  const plan = useMemo(() => planCanvasNodeMounts(draft, draft.camera, viewport, {
    maxMounted: maxMountedTerminals,
    overscanScreenPixels: 280,
  }), [draft, maxMountedTerminals, viewport])
  const mountedIds = useMemo(() => new Set(plan.mountNodeIds), [plan.mountNodeIds])
  const tabById = useMemo(() => new Map(tabs.map(tab => [tab.id, tab])), [tabs])
  const projectByPath = useMemo(() => new Map(projects.map(project => [project.path, project])), [projects])
  const marquee = gestureRef.current?.kind === 'marquee'
    ? normalizeRect(gestureRef.current.startWorld, gestureRef.current.currentWorld)
    : null
  const moving = gestureRef.current?.kind === 'pan' || gestureRef.current?.kind === 'move' || gestureRef.current?.kind === 'group-move' || gestureRef.current?.kind === 'resize'
  const focusedNode = draft.nodes.find(node => node.id === focusedNodeId)
  const focusedObject = draft.objects.find(object => object.id === focusedNodeId)
  const focusedItemTitle = focusedNode
    ? focusedNode.presentation.title ?? tabById.get(focusedNode.activeTabId)?.title ?? 'Terminal'
    : focusedObject ? contentLabel(focusedObject) : null
  const selectionAnnouncement = actionAnnouncement || (focusedItemTitle
    ? `${focusedItemTitle} focused. ${selectedIds.size} ${selectedIds.size === 1 ? 'item' : 'items'} selected.`
    : selectedIds.size > 0
      ? `${selectedIds.size} items selected.`
      : 'No items selected.')
  const worldStyle = {
    transform: `translate(${-draft.camera.x * draft.camera.zoom}px, ${-draft.camera.y * draft.camera.zoom}px) scale(${draft.camera.zoom})`,
  }
  const gridStyle = draft.settings.showGrid ? {
    '--canvas-grid-size': `${draft.settings.gridSize * draft.camera.zoom}px`,
    '--canvas-grid-major-size': `${draft.settings.gridSize * 5 * draft.camera.zoom}px`,
    '--canvas-grid-x': `${-draft.camera.x * draft.camera.zoom}px`,
    '--canvas-grid-y': `${-draft.camera.y * draft.camera.zoom}px`,
  } as React.CSSProperties : undefined

  return (
    <section
      className={`canvas-workspace${moving ? ' is-manipulating' : ''}`}
      style={{
        '--canvas-theme-accent': theme.colors.accent,
        '--canvas-theme-text': theme.colors.textPrimary,
        '--canvas-theme-muted': theme.colors.textSecondary,
      } as React.CSSProperties}
      aria-label="Workspace canvas"
    >
      <div
        ref={surfaceRef}
        className="canvas-surface"
        style={gridStyle}
        role="application"
        aria-label="Spatial terminal canvas with content objects. Use arrow keys to move between items."
        tabIndex={0}
        onPointerDown={handleSurfacePointerDown}
        onMouseDownCapture={handleSurfaceMouseDownCapture}
        onAuxClickCapture={handleSurfaceAuxClick}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
        onPaste={handleCanvasPaste}
        onKeyDownCapture={handleKeyDown}
        onKeyUp={event => { if (event.code === 'Space') spaceHeldRef.current = false }}
        onBlur={() => { spaceHeldRef.current = false }}
      >
        <div className="canvas-live-region" role="status" aria-live="polite" aria-atomic="true">
          {selectionAnnouncement}
        </div>
        <div
          className="canvas-world"
          style={worldStyle}
          role="listbox"
          aria-label="Canvas items"
          aria-multiselectable="true"
        >
          <span className="canvas-origin" aria-hidden="true" />
          {draft.groups.map(group => (
            <section
              key={group.id}
              className={`canvas-group${group.collapsed ? ' is-collapsed' : ''}`}
              style={{ left: group.rect.x, top: group.rect.y, width: group.rect.width, height: group.collapsed ? 62 : group.rect.height, zIndex: group.zIndex }}
              aria-label={`${group.title} group, ${group.collapsed ? 'collapsed' : 'expanded'}`}
            >
              <header onPointerDown={event => startGroupMove(event, group.id)}>
                {editingGroupId === group.id ? (
                  <input
                    className="canvas-group__title-input"
                    value={editingGroupTitle}
                    aria-label="Group title"
                    autoFocus
                    onChange={event => setEditingGroupTitle(event.target.value)}
                    onPointerDown={event => event.stopPropagation()}
                    onBlur={commitGroupRename}
                    onKeyDown={event => {
                      event.stopPropagation()
                      if (event.key === 'Enter') commitGroupRename()
                      if (event.key === 'Escape') setEditingGroupId(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="canvas-group__title"
                    title="Double-click to rename group"
                    onPointerDown={event => event.stopPropagation()}
                    onDoubleClick={() => {
                      setEditingGroupId(group.id)
                      setEditingGroupTitle(group.title)
                    }}
                  >{group.title}</button>
                )}
                <small>{sceneItems(draft).filter(item => item.groupId === group.id).length} items</small>
                <button
                  type="button"
                  aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.title}`}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={() => publishScene({ ...draft, groups: draft.groups.map(item => item.id === group.id ? { ...item, collapsed: !item.collapsed } : item) })}
                >{group.collapsed ? '+' : '−'}</button>
              </header>
            </section>
          ))}
          {draft.nodes.map(node => {
            const nodeTabs = node.tabIds.map(id => tabById.get(id)).filter((tab): tab is OpenTab => Boolean(tab))
            const activeTab = tabById.get(node.activeTabId) ?? nodeTabs[0]
            const project = projectByPath.get(node.projectPath ?? activeTab?.projectPath ?? '')
            const hidden = node.groupId && draft.groups.some(group => group.id === node.groupId && group.collapsed)
            if (hidden) return null
            return (
              <CanvasTerminalCard
                key={node.id}
                node={node}
                tab={activeTab}
                tabs={nodeTabs}
                project={project}
                detail={detail}
                mounted={mountedIds.has(node.id) && (detail === 'full' || detail === 'preview')}
                selected={selectedIds.has(node.id)}
                focused={focusedNodeId === node.id || Boolean(focusedTabId && node.tabIds.includes(focusedTabId))}
                workspaceActive={isWorkspaceActive}
                theme={theme}
                api={api}
                onSelect={event => selectItem(event, node)}
                onMoveStart={event => startMove(event, node)}
                onResizeStart={(event, handle) => startResize(event, node, handle)}
                onActivate={tabId => activateNode(node, tabId)}
                onCloseTab={onCloseTab}
                onResumeTab={onResumeTab}
                onRenameTab={onRenameTab}
              />
            )
          })}
          {draft.objects.map(object => {
            const hidden = object.groupId && draft.groups.some(group => group.id === object.groupId && group.collapsed)
            if (hidden) return null
            return (
              <CanvasObjectCard
                key={object.id}
                object={object}
                selected={selectedIds.has(object.id)}
                focused={focusedNodeId === object.id}
                api={api}
                onSelect={event => selectItem(event, object)}
                onMoveStart={event => startMove(event, object)}
                onResizeStart={(event, handle) => startResize(event, object, handle)}
                onChange={next => publishScene({
                  ...sceneRef.current,
                  objects: sceneRef.current.objects.map(item => item.id === next.id ? next : item),
                })}
                onRemove={() => {
                  publishScene({
                    ...sceneRef.current,
                    objects: sceneRef.current.objects.filter(item => item.id !== object.id),
                  })
                  setSelectedIds(current => new Set([...current].filter(id => id !== object.id)))
                  if (focusedNodeId === object.id) setFocusedNodeId(null)
                  setActionAnnouncement(`${contentLabel(object)} removed.`)
                }}
                onAnnounce={setActionAnnouncement}
              />
            )
          })}
          {marquee && <div className="canvas-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} aria-hidden="true" />}
        </div>

        {draft.nodes.length === 0 && draft.objects.length === 0 && (
          <div className="canvas-empty">
            <strong>Drop a project, image, or start a note</strong>
            <span><kbd>Space</kbd> drag to pan</span>
            <span>Scroll or <kbd>+</kbd>/<kbd>−</kbd> to zoom</span>
          </div>
        )}

        <div className="canvas-add-toolbar" role="toolbar" aria-label="Add Canvas content">
          <button type="button" onClick={addNote}>Note</button>
          <button type="button" onClick={() => void pickImage()} disabled={!api?.pickCanvasAsset}>Image</button>
          <button type="button" onClick={addSketch}>Sketch</button>
        </div>

        <div className="canvas-toolbar" role="toolbar" aria-label="Canvas controls">
          <button type="button" aria-label="Zoom out (minus)" title="Zoom out (−)" onClick={() => zoomAroundCenter(0.8)}>−</button>
          <output aria-label="Canvas zoom">{Math.round(draft.camera.zoom * 100)}%</output>
          <button type="button" aria-label="Zoom in (plus)" title="Zoom in (+)" onClick={() => zoomAroundCenter(1.25)}>+</button>
          <span className="canvas-toolbar__divider" />
          <button type="button" onClick={() => fitRects([...sceneItems(draft).map(item => item.rect), ...draft.groups.map(group => group.rect)])}>Fit all</button>
          <button type="button" onClick={() => fitRects(sceneItems(draft).filter(item => selectedIds.has(item.id)).map(item => item.rect))} disabled={selectedIds.size === 0}>Fit selected</button>
          <button type="button" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}>Reset</button>
        </div>

        {selectedIds.size > 1 && (
          <div className="canvas-arrange" role="toolbar" aria-label="Arrange selected Canvas items">
            <span>{selectedIds.size} selected</span>
            <button type="button" onClick={() => arrange('row')}>Row</button>
            <button type="button" onClick={() => arrange('column')}>Column</button>
            <button type="button" onClick={() => arrange('grid')}>Grid</button>
            <button type="button" onClick={() => arrange('stack')}>Stack</button>
            <button type="button" onClick={() => publishScene(groupCanvasNodes(draft, selectedIds, `group-${Date.now()}`))}>Group</button>
            <button type="button" onClick={() => publishScene(ungroupCanvasNodes(draft, selectedIds))}>Ungroup</button>
          </div>
        )}

        {draft.settings.showMinimap && (draft.nodes.length > 0 || draft.objects.length > 0) && (
          <CanvasMinimap
            scene={draft}
            viewport={viewport}
            onNavigate={point => setCamera({ ...draft.camera, x: point.x - viewport.width / draft.camera.zoom / 2, y: point.y - viewport.height / draft.camera.zoom / 2 })}
          />
        )}

        <div className="canvas-outline" aria-label="Canvas contents">
          {draft.groups.map(group => (
            <section key={group.id} aria-label={`${group.title} group`}>
              <strong>{group.title}</strong>
              {draft.nodes.filter(node => node.groupId === group.id).map(node => <span key={node.id}>{node.presentation.title ?? tabById.get(node.activeTabId)?.title ?? 'Terminal'}</span>)}
              {draft.objects.filter(object => object.groupId === group.id).map(object => <span key={object.id}>{object.kind}: {contentLabel(object)}</span>)}
            </section>
          ))}
          {draft.nodes.filter(node => !node.groupId).map(node => <span key={node.id}>{node.presentation.title ?? tabById.get(node.activeTabId)?.title ?? 'Terminal'}</span>)}
          {draft.objects.filter(object => !object.groupId).map(object => <span key={object.id}>{object.kind}: {contentLabel(object)}</span>)}
        </div>
      </div>
    </section>
  )
}

export type { CanvasWorkspaceViewProps }
