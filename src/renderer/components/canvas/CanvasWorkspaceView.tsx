import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from '../ErrorBoundary.js'
import type { Api } from '../../api/types.js'
import type { Theme } from '../../themes.js'
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
  type CanvasPoint,
  type CanvasRect,
  type CanvasScene,
  type CanvasTerminalNode,
} from './scene-model'
import { getNodeDetailLevel, planCanvasNodeMounts, type CanvasNodeDetailLevel } from './scene-visibility'
import './canvas.css'

const MIN_NODE_WIDTH = 360
const MIN_NODE_HEIGHT = 220
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
  | { kind: 'move'; start: CanvasPoint; scene: CanvasScene; nodeIds: string[] }
  | { kind: 'group-move'; start: CanvasPoint; scene: CanvasScene; groupId: string }
  | { kind: 'resize'; start: CanvasPoint; scene: CanvasScene; nodeId: string; handle: ResizeHandle }

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

function nextZIndex(scene: CanvasScene): number {
  return Math.max(0, ...scene.nodes.map(node => node.zIndex), ...scene.groups.map(group => group.zIndex)) + 1
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

  return (
    <article
      className={`canvas-node canvas-node--${detail}${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}${mounted ? ' is-mounted' : ' is-suspended'}`}
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
              className={candidate.id === node.activeTabId ? 'is-active' : ''}
              onPointerDown={event => event.stopPropagation()}
              onClick={() => onActivate(candidate.id)}
            >{candidate.title}</button>
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
  const [, setGestureTick] = useState(0)

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
      if (event.ctrlKey || event.metaKey) {
        const cursor = eventPoint(event, surface)
        const factor = Math.exp(-event.deltaY * 0.002)
        setCamera(zoomAtScreenPoint(sceneRef.current.camera, sceneRef.current.camera.zoom * factor, cursor))
        return
      }
      const camera = sceneRef.current.camera
      setCamera({
        ...camera,
        x: camera.x + event.deltaX / camera.zoom,
        y: camera.y + event.deltaY / camera.zoom,
      })
    }
    surface.addEventListener('wheel', handleWheel, { passive: false })
    return () => surface.removeEventListener('wheel', handleWheel)
  }, [setCamera])

  const fitRects = useCallback((rects: CanvasRect[]): void => {
    const bounds = getRectBounds(rects)
    if (bounds) setCamera(fitBounds(bounds, viewport, FIT_PADDING))
  }, [setCamera, viewport])

  const selectNode = useCallback((event: React.PointerEvent, node: CanvasTerminalNode): void => {
    if (event.button !== 0 || spaceHeldRef.current) return
    event.stopPropagation()
    const toggle = event.shiftKey || event.ctrlKey || event.metaKey
    setSelectedIds(current => {
      if (toggle) {
        const next = new Set(current)
        if (next.has(node.id)) next.delete(node.id)
        else next.add(node.id)
        return next
      }
      return current.has(node.id) && current.size === 1 ? current : new Set([node.id])
    })
    setFocusedNodeId(node.id)
    const raised = { ...node, zIndex: nextZIndex(sceneRef.current) }
    publishScene({ ...sceneRef.current, nodes: sceneRef.current.nodes.map(item => item.id === node.id ? raised : item) })
  }, [publishScene])

  const startMove = useCallback((event: React.PointerEvent, node: CanvasTerminalNode): void => {
    if (event.button !== 0 || spaceHeldRef.current) return
    event.preventDefault()
    event.stopPropagation()
    const ids = selectedIds.has(node.id) ? [...selectedIds] : [node.id]
    if (!selectedIds.has(node.id)) setSelectedIds(new Set([node.id]))
    setFocusedNodeId(node.id)
    const raisedScene = {
      ...sceneRef.current,
      nodes: sceneRef.current.nodes.map(item => item.id === node.id ? { ...item, zIndex: nextZIndex(sceneRef.current) } : item),
    }
    publishScene(raisedScene)
    gestureRef.current = { kind: 'move', start: { x: event.clientX, y: event.clientY }, scene: raisedScene, nodeIds: ids }
    setGestureTick(value => value + 1)
  }, [publishScene, selectedIds])

  const startResize = useCallback((event: React.PointerEvent, node: CanvasTerminalNode, handle: ResizeHandle): void => {
    if (event.button !== 0 || selectedIds.size !== 1) return
    event.preventDefault()
    event.stopPropagation()
    gestureRef.current = { kind: 'resize', start: { x: event.clientX, y: event.clientY }, scene: sceneRef.current, nodeId: node.id, handle }
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
        const ids = new Set(gesture.nodeIds)
        publishScene({
          ...gesture.scene,
          nodes: gesture.scene.nodes.map(node => ids.has(node.id)
            ? { ...node, rect: { ...node.rect, x: node.rect.x + dx, y: node.rect.y + dy } }
            : node),
        })
        return
      }
      if (gesture.kind === 'group-move') {
        publishScene({
          ...gesture.scene,
          groups: gesture.scene.groups.map(group => group.id === gesture.groupId
            ? { ...group, rect: { ...group.rect, x: group.rect.x + dx, y: group.rect.y + dy } }
            : group),
          nodes: gesture.scene.nodes.map(node => node.groupId === gesture.groupId
            ? { ...node, rect: { ...node.rect, x: node.rect.x + dx, y: node.rect.y + dy } }
            : node),
        })
        return
      }
      publishScene({
        ...gesture.scene,
        nodes: gesture.scene.nodes.map(node => {
          if (node.id !== gesture.nodeId) return node
          const left = gesture.handle.includes('w') ? Math.min(node.rect.x + dx, node.rect.x + node.rect.width - MIN_NODE_WIDTH) : node.rect.x
          const top = gesture.handle.includes('n') ? Math.min(node.rect.y + dy, node.rect.y + node.rect.height - MIN_NODE_HEIGHT) : node.rect.y
          const right = gesture.handle.includes('e') ? Math.max(node.rect.x + node.rect.width + dx, node.rect.x + MIN_NODE_WIDTH) : node.rect.x + node.rect.width
          const bottom = gesture.handle.includes('s') ? Math.max(node.rect.y + node.rect.height + dy, node.rect.y + MIN_NODE_HEIGHT) : node.rect.y + node.rect.height
          return { ...node, rect: { x: left, y: top, width: right - left, height: bottom - top } }
        }),
      })
    }
    const end = (): void => {
      const gesture = gestureRef.current
      if (gesture?.kind === 'marquee') {
        const marquee = normalizeRect(gesture.startWorld, gesture.currentWorld)
        const hits = sceneRef.current.nodes.filter(node => rectsIntersect(node.rect, marquee)).map(node => node.id)
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
    gestureRef.current = {
      kind: 'marquee',
      startWorld: point,
      currentWorld: point,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
    }
    if (!(event.shiftKey || event.ctrlKey || event.metaKey)) setSelectedIds(new Set())
    setGestureTick(value => value + 1)
  }

  const handleCanvasDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    const types = event.dataTransfer.types
    if (types.includes('application/x-sidebar-project') ||
      types.includes('application/x-subtab') ||
      types.includes('application/x-sidebar-session') ||
      types.includes('application/x-canvas-tab')) {
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
    const target = event.target as HTMLElement
    if (event.key === 'Escape' && target !== event.currentTarget) {
      event.preventDefault()
      event.stopPropagation()
      surfaceRef.current?.focus()
      return
    }
    if (target !== event.currentTarget) return
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
        publishScene({
          ...draft,
          nodes: draft.nodes.map(item => selectedIds.has(item.id)
            ? { ...item, rect: { ...item.rect, x: item.rect.x + offset.x, y: item.rect.y + offset.y } }
            : item),
        })
        return
      }
      const visibleNodes = draft.nodes.filter(node => !node.groupId || !draft.groups.some(group => group.id === node.groupId && group.collapsed))
      const next = findSpatialNeighbor(visibleNodes, focusedNodeId, direction)
      if (next) {
        setFocusedNodeId(next)
        setSelectedIds(new Set([next]))
      }
      return
    }
    const node = draft.nodes.find(item => item.id === focusedNodeId)
    if (event.key === 'Enter' && node) {
      event.preventDefault()
      activateNode(node)
    } else if (event.key === '0') {
      event.preventDefault()
      if (event.shiftKey) setCamera({ x: 0, y: 0, zoom: 1 })
      else fitRects([...draft.nodes.map(item => item.rect), ...draft.groups.map(group => group.rect)])
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault()
      fitRects(draft.nodes.filter(item => selectedIds.has(item.id)).map(item => item.rect))
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
  const focusedNodeTitle = focusedNode
    ? focusedNode.presentation.title ?? tabById.get(focusedNode.activeTabId)?.title ?? 'Terminal'
    : null
  const selectionAnnouncement = focusedNodeTitle
    ? `${focusedNodeTitle} focused. ${selectedIds.size} ${selectedIds.size === 1 ? 'terminal' : 'terminals'} selected.`
    : selectedIds.size > 0
      ? `${selectedIds.size} terminals selected.`
      : 'No terminals selected.'
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
        aria-label="Spatial terminal canvas. Use arrow keys to move between terminals."
        tabIndex={0}
        onPointerDown={handleSurfacePointerDown}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
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
          aria-label="Terminal nodes"
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
                <small>{draft.nodes.filter(node => node.groupId === group.id).length} sessions</small>
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
                onSelect={event => selectNode(event, node)}
                onMoveStart={event => startMove(event, node)}
                onResizeStart={(event, handle) => startResize(event, node, handle)}
                onActivate={tabId => activateNode(node, tabId)}
                onCloseTab={onCloseTab}
                onResumeTab={onResumeTab}
                onRenameTab={onRenameTab}
              />
            )
          })}
          {marquee && <div className="canvas-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} aria-hidden="true" />}
        </div>

        {draft.nodes.length === 0 && (
          <div className="canvas-empty">
            <strong>Drop a project or start a session</strong>
            <span><kbd>N</kbd> New session</span>
            <span><kbd>Space</kbd> drag to pan</span>
            <span><kbd>Ctrl</kbd> scroll to zoom</span>
          </div>
        )}

        <div className="canvas-toolbar" role="toolbar" aria-label="Canvas controls">
          <button type="button" aria-label="Zoom out" onClick={() => zoomAroundCenter(0.8)}>−</button>
          <output aria-label="Canvas zoom">{Math.round(draft.camera.zoom * 100)}%</output>
          <button type="button" aria-label="Zoom in" onClick={() => zoomAroundCenter(1.25)}>+</button>
          <span className="canvas-toolbar__divider" />
          <button type="button" onClick={() => fitRects([...draft.nodes.map(node => node.rect), ...draft.groups.map(group => group.rect)])}>Fit all</button>
          <button type="button" onClick={() => fitRects(draft.nodes.filter(node => selectedIds.has(node.id)).map(node => node.rect))} disabled={selectedIds.size === 0}>Fit selected</button>
          <button type="button" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}>Reset</button>
        </div>

        {selectedIds.size > 1 && (
          <div className="canvas-arrange" role="toolbar" aria-label="Arrange selected terminals">
            <span>{selectedIds.size} selected</span>
            <button type="button" onClick={() => arrange('row')}>Row</button>
            <button type="button" onClick={() => arrange('column')}>Column</button>
            <button type="button" onClick={() => arrange('grid')}>Grid</button>
            <button type="button" onClick={() => arrange('stack')}>Stack</button>
            <button type="button" onClick={() => publishScene(groupCanvasNodes(draft, selectedIds, `group-${Date.now()}`))}>Group</button>
            <button type="button" onClick={() => publishScene(ungroupCanvasNodes(draft, selectedIds))}>Ungroup</button>
          </div>
        )}

        {draft.settings.showMinimap && draft.nodes.length > 0 && (
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
            </section>
          ))}
          {draft.nodes.filter(node => !node.groupId).map(node => <span key={node.id}>{node.presentation.title ?? tabById.get(node.activeTabId)?.title ?? 'Terminal'}</span>)}
        </div>
      </div>
    </section>
  )
}

export type { CanvasWorkspaceViewProps }
