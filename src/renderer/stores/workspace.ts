import { create } from 'zustand'
import { debugTrace } from '../debug/debugBridge'
import { removeTabFromLeaf, remapTabIds, splitRoot, createLeaf, generateTileId, type TileNode } from '../components/tile-tree'
import {
  createEmptyCanvasScene,
  generateCanvasScene,
  loadCanvasScene,
  reconcileCanvasScene,
  remapSceneTabIds,
  type CanvasScene,
  type CanvasTabDescriptor,
} from '../components/canvas'
import type { HarnessSelection, Workspace as AuthoritativeWorkspace } from '../api/types'

// Only sessions created locally and not yet acknowledged by an authoritative
// snapshot may survive a snapshot omission. Inferring "unsaved" from absence
// resurrected sessions deleted by another frontend and caused save loops.
const pendingCreatedSessionIds = new Set<string>()
const pendingRuntimeRebinds = new Map<string, string>()

export function markPendingRuntimeRebind(serverId: string, authorityTabId: string, ptyId: string): void {
  if (authorityTabId !== ptyId) pendingRuntimeRebinds.set(serverResourceKey(serverId, authorityTabId), ptyId)
}

export interface ProjectCategory {
  serverId: string
  id: string
  name: string
  collapsed: boolean
  order: number
}

export interface Project {
  serverId: string
  path: string
  name: string
  executable?: string
  apiPort?: number
  apiAutoStart?: boolean
  apiSessionMode?: 'existing' | 'new-keep' | 'new-close'
  apiModel?: 'default' | 'opus' | 'sonnet' | 'haiku'
  autoAcceptTools?: string[]
  permissionMode?: string
  icon?: string
  color?: string
  ttsVoice?: string
  ttsEngine?: 'piper' | 'xtts'
  harnessId?: HarnessSelection
  /** @deprecated Schema v1 compatibility only. */
  backend?: HarnessSelection
  categoryId?: string
  order?: number
}

export interface OpenTab {
  serverId: string
  authorityTabId?: string
  id: string
  projectPath: string
  agentSessionId?: string
  sessionId?: string
  title: string
  customTitle?: boolean
  ptyId: string
  harnessId?: HarnessSelection
  /** @deprecated Schema v1 compatibility only. */
  backend?: HarnessSelection
}

export type WorkspaceView = 'tiles' | 'canvas'
export type AgentAttentionKind = 'completed' | 'needs-input'

export interface WorkspaceSavedData {
  openTabs: any[]
  tileTree: unknown
  canvasScene?: unknown
  activeView?: WorkspaceView
  activeTabId: string | null
}

export interface WorkspaceSession {
  serverId: string
  authoritySessionId: string
  id: string
  name: string
  openTabs: OpenTab[]
  activeTabId: string | null
  activeTileTree: TileNode | null
  canvasScene: CanvasScene | null
  preservedCanvasScene?: unknown
  activeView: WorkspaceView
  // Raw saved data for lazy PTY restoration
  savedData?: WorkspaceSavedData
  isRestored: boolean
}

const generateSessionId = (): string =>
  `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

const generateCategoryId = (): string =>
  `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

function toCanvasTabs(tabs: OpenTab[]): CanvasTabDescriptor[] {
  return tabs.map(tab => ({
    id: tab.id,
    projectPath: tab.projectPath,
    title: tab.title,
  }))
}

function reconcileSessionScene(
  scene: CanvasScene | null,
  tabs: OpenTab[],
  tileTree?: TileNode | null
): CanvasScene {
  const descriptors = toCanvasTabs(tabs)
  return scene
    ? reconcileCanvasScene(scene, descriptors)
    : generateCanvasScene(descriptors, { tileTree })
}

interface WorkspaceState {
  projects: Project[]
  categories: ProjectCategory[]
  sessions: WorkspaceSession[]
  activeSessionId: string | null

  // Mirrors of the active session (kept in sync for backward compat)
  openTabs: OpenTab[]
  activeTabId: string | null
  activeTileTree: TileNode | null
  activeCanvasScene: CanvasScene | null
  activeView: WorkspaceView
  attentionByTabId: Record<string, AgentAttentionKind>
  applyAuthoritativeWorkspace: (serverId: string, workspace: AuthoritativeWorkspace) => void
  removeServerProjection: (serverId: string) => void

  // Session management
  initSessions: (sessions: WorkspaceSession[], activeId: string | null) => void
  addSession: (serverId: string, name?: string) => string
  ensureSessionForServer: (serverId: string) => string
  removeSession: (id: string) => void
  renameSession: (id: string, name: string) => void
  reorderSessions: (id: string, toIndex: number) => void
  switchSession: (id: string) => void
  moveTabsToSession: (tabIds: string[], toSessionId: string) => void
  setSessionSavedData: (id: string, data: WorkspaceSavedData) => void
  setSessionLiveData: (
    id: string,
    openTabs: OpenTab[],
    tileTree: TileNode | null,
    canvasScene: CanvasScene,
    activeTabId: string | null,
    activeView: WorkspaceView,
    preservedCanvasScene?: unknown
  ) => void
  rebindSessionRuntime: (sessionId: string, authorityTabId: string, ptyId: string) => void
  markSessionRestored: (id: string) => void
  getAllOpenTabs: () => OpenTab[]

  // Active session tab ops
  addTab: (tab: OpenTab) => void
  removeTab: (id: string) => void
  updateTab: (id: string, updates: Partial<OpenTab>) => void
  setActiveTab: (id: string) => void
  clearTabs: () => void
  clearAllTabs: () => void
  setActiveTileTree: (tree: TileNode | null) => void
  setActiveCanvasScene: (scene: CanvasScene) => void
  setActiveView: (view: WorkspaceView) => void
  markTabAttention: (id: string, kind: AgentAttentionKind) => void
  clearTabAttention: (id: string) => void
  clearTabAttentionMany: (ids: string[]) => void

  // Project ops
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  removeProject: (path: string) => void
  updateProject: (path: string, updates: Partial<Project>) => void

  // Category ops
  setCategories: (categories: ProjectCategory[]) => void
  addCategory: (serverId: string, name: string) => string
  updateCategory: (id: string, updates: Partial<ProjectCategory>) => void
  removeCategory: (id: string) => void
  reorderCategories: (ids: string[]) => void
  moveProjectToCategory: (projectPath: string, categoryId: string | null) => void
  reorderProjects: (categoryId: string | null, projectPaths: string[]) => void
}

interface ActiveSessionUpdates {
  openTabs?: OpenTab[]
  activeTabId?: string | null
  activeTileTree?: TileNode | null
  activeCanvasScene?: CanvasScene | null
  activeView?: WorkspaceView
}

function syncToActive(
  state: WorkspaceState,
  updates: ActiveSessionUpdates
): Partial<WorkspaceState> {
  const { activeSessionId, sessions } = state
  const sessionUpdates: Partial<WorkspaceSession> = {}
  if (updates.openTabs !== undefined) sessionUpdates.openTabs = updates.openTabs
  if (updates.activeTabId !== undefined) sessionUpdates.activeTabId = updates.activeTabId
  if (updates.activeTileTree !== undefined) sessionUpdates.activeTileTree = updates.activeTileTree
  if (updates.activeCanvasScene !== undefined) sessionUpdates.canvasScene = updates.activeCanvasScene
  if (updates.activeView !== undefined) sessionUpdates.activeView = updates.activeView
  const newSessions = sessions.map(session =>
    session.id === activeSessionId ? { ...session, ...sessionUpdates } : session
  )
  return { ...updates, sessions: newSessions }
}

export function serverResourceKey(serverId: string, resourceId: string): string {
  return `${serverId}\0${resourceId}`
}

export function tabResourceKey(tab: Pick<OpenTab, 'serverId' | 'id' | 'authorityTabId'>): string {
  return tab.authorityTabId ? tab.id : serverResourceKey(tab.serverId, tab.id)
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects: [],
  categories: [],
  sessions: [],
  activeSessionId: null,
  openTabs: [],
  activeTabId: null,
  activeTileTree: null,
  activeCanvasScene: null,
  activeView: 'tiles',
  attentionByTabId: {},

  applyAuthoritativeWorkspace: (serverId, workspace) => {
    set((state) => {
      const existingForServer = state.sessions.filter(session => session.serverId === serverId)
      const existingTabsByAuthorityId = new Map(existingForServer.flatMap(session =>
        session.openTabs.map(tab => [tab.authorityTabId ?? tab.id, tab] as const)))
      const sessions: WorkspaceSession[] = (workspace.sessions ?? []).map((saved) => {
        // Authority tab IDs are set membership, not an append-only history.
        // Older clients could save the same restored tab once per reconnect;
        // collapse those records at the projection boundary so every frontend
        // sees one canonical tab and the next save repairs authority.
        const authoritativeTabs = [...new Map(saved.openTabs.map(tab => [tab.id, tab])).values()]
        const tabIdMapping = new Map(authoritativeTabs.map(tab => [tab.id, serverResourceKey(serverId, tab.id)]))
        const openTabs: OpenTab[] = authoritativeTabs.map(tab => {
          const rebindKey = serverResourceKey(serverId, tab.id)
          const pendingPtyId = pendingRuntimeRebinds.get(rebindKey)
          const existingTab = existingTabsByAuthorityId.get(tab.id)
          if (pendingPtyId && tab.ptyId === pendingPtyId) pendingRuntimeRebinds.delete(rebindKey)
          return {
            ...tab,
            serverId,
            authorityTabId: tab.id,
            id: tabIdMapping.get(tab.id)!,
            agentSessionId: tab.agentSessionId ?? tab.id,
            ptyId: pendingPtyId && existingTab?.ptyId === pendingPtyId
              ? pendingPtyId
              : tab.ptyId || tab.id,
            harnessId: tab.harnessId ?? tab.backend,
          }
        })
        // The authority owns tab membership. Preserving arbitrary local tabs
        // omitted by a snapshot resurrects tabs closed on another frontend and
        // creates a perpetual save/reconcile loop. A newly opened tab is saved
        // before it is projected; after that, omission means deletion.
        const savedTree = (saved.tileTree ?? null) as TileNode | null
        const activeTileTree = savedTree ? remapTabIds(savedTree, tabIdMapping) : null
        const generatedScene = generateCanvasScene(toCanvasTabs(openTabs), { tileTree: activeTileTree })
        let canvasScene = generatedScene
        let preservedCanvasScene: unknown
        if (saved.canvasScene !== undefined && saved.canvasScene !== null) {
          const loaded = loadCanvasScene(saved.canvasScene)
          if (loaded.status === 'ok') {
            canvasScene = reconcileCanvasScene(
              remapSceneTabIds(loaded.scene, Object.fromEntries(tabIdMapping)),
              toCanvasTabs(openTabs),
            )
          } else if (loaded.status === 'future-version') {
            preservedCanvasScene = loaded.data
          }
        }
        return {
          serverId,
          authoritySessionId: saved.id,
          id: serverResourceKey(serverId, saved.id),
          name: saved.name,
          openTabs,
          activeTabId: saved.activeTabId ? tabIdMapping.get(saved.activeTabId) ?? null : null,
          activeTileTree,
          canvasScene,
          preservedCanvasScene,
          activeView: preservedCanvasScene === undefined ? (saved.activeView ?? 'tiles') : 'tiles',
          isRestored: true,
        }
      })
      // Preserve only explicitly pending local creations. An arbitrary local
      // session absent from authority may have been deleted by another client.
      const authoritativeSessionIds = new Set(sessions.map(session => session.authoritySessionId))
      for (const id of authoritativeSessionIds) pendingCreatedSessionIds.delete(serverResourceKey(serverId, id))
      const unsavedLocalSessions = existingForServer.filter(session =>
        !authoritativeSessionIds.has(session.authoritySessionId)
        && pendingCreatedSessionIds.has(serverResourceKey(serverId, session.authoritySessionId)))
      const authoritativeActiveId = workspace.activeSessionId
        ? serverResourceKey(serverId, workspace.activeSessionId)
        : null
      const serverActiveId = authoritativeActiveId && sessions.some(session => session.id === authoritativeActiveId)
        ? authoritativeActiveId
        : sessions[0]?.id ?? null
      const siblingSessions = state.sessions.filter(session => session.serverId !== serverId)
      const mergedSessions = [...siblingSessions, ...sessions, ...unsavedLocalSessions]
      const activeSessionId = state.activeSessionId && mergedSessions.some(session => session.id === state.activeSessionId)
        ? state.activeSessionId
        : serverActiveId
      const active = mergedSessions.find(session => session.id === activeSessionId) ?? null
      const liveTabIds = new Set(mergedSessions.flatMap(session =>
        session.openTabs.map(tabResourceKey)))
      return {
        projects: [
          ...state.projects.filter(project => project.serverId !== serverId),
          ...workspace.projects.map(project => ({
            ...project,
            serverId,
            categoryId: project.categoryId ? serverResourceKey(serverId, project.categoryId) : undefined,
          })),
        ],
        categories: [
          ...state.categories.filter(category => category.serverId !== serverId),
          ...(workspace.categories ?? []).map(category => ({
            ...category,
            serverId,
            id: serverResourceKey(serverId, category.id),
          })),
        ],
        sessions: mergedSessions,
        activeSessionId,
        openTabs: active?.openTabs ?? [],
        activeTabId: active?.activeTabId ?? null,
        activeTileTree: active?.activeTileTree ?? null,
        activeCanvasScene: active?.canvasScene ?? null,
        activeView: active?.activeView ?? 'tiles',
        attentionByTabId: Object.fromEntries(
          Object.entries(state.attentionByTabId).filter(([tabId]) => liveTabIds.has(tabId))
        ),
      }
    })
  },

  removeServerProjection: (serverId) => {
    for (const id of pendingCreatedSessionIds) {
      if (id.startsWith(`${serverId}\u0000`)) pendingCreatedSessionIds.delete(id)
    }
    for (const id of pendingRuntimeRebinds.keys()) {
      if (id.startsWith(`${serverId}\u0000`)) pendingRuntimeRebinds.delete(id)
    }
    set(state => {
      const sessions = state.sessions.filter(session => session.serverId !== serverId)
      const activeSessionId = state.activeSessionId
        && sessions.some(session => session.id === state.activeSessionId)
        ? state.activeSessionId
        : sessions[0]?.id ?? null
      const active = sessions.find(session => session.id === activeSessionId) ?? null
      const liveTabIds = new Set(sessions.flatMap(session => session.openTabs.map(tabResourceKey)))
      return {
        projects: state.projects.filter(project => project.serverId !== serverId),
        categories: state.categories.filter(category => category.serverId !== serverId),
        sessions,
        activeSessionId,
        openTabs: active?.openTabs ?? [],
        activeTabId: active?.activeTabId ?? null,
        activeTileTree: active?.activeTileTree ?? null,
        activeCanvasScene: active?.canvasScene ?? null,
        activeView: active?.activeView ?? 'tiles',
        attentionByTabId: Object.fromEntries(
          Object.entries(state.attentionByTabId).filter(([tabId]) => liveTabIds.has(tabId))
        ),
      }
    })
  },

  // -------------------------------------------------------------------------
  // Session management
  // -------------------------------------------------------------------------

  initSessions: (sessions, activeId) => {
    const active = sessions.find(s => s.id === activeId) ?? sessions[0] ?? null
    set({
      sessions,
      activeSessionId: active?.id ?? null,
      openTabs: active?.openTabs ?? [],
      activeTabId: active?.activeTabId ?? null,
      activeTileTree: active?.activeTileTree ?? null,
      activeCanvasScene: active?.canvasScene ?? null,
      activeView: active?.activeView ?? 'tiles',
      attentionByTabId: {},
    })
  },

  addSession: (serverId, name) => {
    const id = generateSessionId()
    const { sessions } = get()
    const label = name ?? `Workspace ${sessions.filter(session => session.serverId === serverId).length + 1}`
    const newSession: WorkspaceSession = {
      serverId,
      authoritySessionId: id,
      id,
      name: label,
      openTabs: [],
      activeTabId: null,
      activeTileTree: null,
      canvasScene: createEmptyCanvasScene(),
      activeView: 'tiles',
      isRestored: true,
    }
    pendingCreatedSessionIds.add(serverResourceKey(serverId, id))
    set(state => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: id,
      openTabs: [],
      activeTabId: null,
      activeTileTree: null,
      activeCanvasScene: createEmptyCanvasScene(),
      activeView: 'tiles',
    }))
    return id
  },

  ensureSessionForServer: (serverId) => {
    const { sessions, activeSessionId } = get()
    // Prefer the active session when it already belongs to the target server.
    const active = sessions.find(s => s.id === activeSessionId)
    if (active && active.serverId === serverId) return active.id
    // Otherwise find-or-create a session owned by the target server and make
    // it active. Tabs for a server must live in that server's session so the
    // per-server workspace slice round-trips cleanly.
    const existing = sessions.find(s => s.serverId === serverId)
    if (existing) {
      get().switchSession(existing.id)
      return existing.id
    }
    return get().addSession(serverId)
  },

  removeSession: (id) => {
    set(state => {
      const removedSession = state.sessions.find(session => session.id === id)
      if (removedSession) pendingCreatedSessionIds.delete(serverResourceKey(removedSession.serverId, removedSession.authoritySessionId))
      const sessions = state.sessions.filter(s => s.id !== id)
      if (sessions.length === 0) {
        // Always keep at least one session
        const fallbackId = generateSessionId()
        const fallbackServerId = removedSession?.serverId ?? state.projects[0]?.serverId ?? 'unbound'
        const fallback: WorkspaceSession = {
          serverId: fallbackServerId,
          authoritySessionId: fallbackId,
          id: fallbackId,
          name: 'Workspace 1',
          openTabs: [],
          activeTabId: null,
          activeTileTree: null,
          canvasScene: createEmptyCanvasScene(),
          activeView: 'tiles',
          isRestored: true,
        }
        pendingCreatedSessionIds.add(serverResourceKey(fallbackServerId, fallbackId))
        sessions.push(fallback)
      }
      const newActiveId = state.activeSessionId === id
        ? sessions[sessions.length - 1].id
        : state.activeSessionId
      const active = sessions.find(s => s.id === newActiveId) ?? sessions[0]
      const removedTabIds = new Set(state.sessions.find(session => session.id === id)?.openTabs.map(tab => tab.id) ?? [])
      const attentionByTabId = Object.fromEntries(
        Object.entries(state.attentionByTabId).filter(([tabId]) => !removedTabIds.has(tabId))
      )
      return {
        sessions,
        activeSessionId: active.id,
        openTabs: active.openTabs,
        activeTabId: active.activeTabId,
        activeTileTree: active.activeTileTree,
        activeCanvasScene: active.canvasScene,
        activeView: active.activeView,
        attentionByTabId,
      }
    })
  },

  renameSession: (id, name) => {
    set(state => ({
      sessions: state.sessions.map(s => s.id === id ? { ...s, name } : s)
    }))
  },

  reorderSessions: (id, toIndex) => {
    set(state => {
      const from = state.sessions.findIndex(s => s.id === id)
      if (from < 0) return state
      const sessions = [...state.sessions]
      const [moved] = sessions.splice(from, 1)
      const clamped = Math.max(0, Math.min(toIndex, sessions.length))
      sessions.splice(clamped, 0, moved)
      return { sessions }
    })
  },

  switchSession: (id) => {
    set(state => {
      const session = state.sessions.find(s => s.id === id)
      if (!session) return state
      debugTrace('workspace:switch', { from: state.activeSessionId, to: id })
      return {
        activeSessionId: id,
        openTabs: session.openTabs,
        activeTabId: session.activeTabId,
        activeTileTree: session.activeTileTree,
        activeCanvasScene: session.canvasScene,
        activeView: session.activeView,
      }
    })
  },

  moveTabsToSession: (tabIds, toSessionId) => {
    set(state => {
      const { activeSessionId, sessions } = state
      if (!activeSessionId || activeSessionId === toSessionId || tabIds.length === 0) return state
      const source = sessions.find(s => s.id === activeSessionId)
      const target = sessions.find(s => s.id === toSessionId)
      if (!source || !target) return state

      // Collect the moved tab objects (preserve requested order)
      const moved = tabIds
        .map(id => source.openTabs.find(t => t.id === id))
        .filter((t): t is OpenTab => !!t)
      if (moved.length === 0) return state
      const movedIds = moved.map(t => t.id)

      // Remove from source: tabs + tile tree
      let sourceTree = source.activeTileTree
      for (const id of movedIds) {
        sourceTree = sourceTree ? removeTabFromLeaf(sourceTree, id) : null
      }
      const sourceTabs = source.openTabs.filter(t => !movedIds.includes(t.id))
      let sourceActive = source.activeTabId
      if (sourceActive && movedIds.includes(sourceActive)) {
        sourceActive = sourceTabs.length ? sourceTabs[sourceTabs.length - 1].id : null
      }

      // Add to target as a new leaf
      const newLeaf = createLeaf(generateTileId(), movedIds, movedIds[movedIds.length - 1])
      const targetTree = target.activeTileTree
        ? splitRoot(target.activeTileTree, 'horizontal', newLeaf, 'after')
        : newLeaf
      const targetTabs = [...target.openTabs, ...moved]
      const targetActive = movedIds[movedIds.length - 1]
      const sourceScene = reconcileSessionScene(source.canvasScene, sourceTabs, sourceTree)
      const targetScene = reconcileSessionScene(target.canvasScene, targetTabs, targetTree)

      const newSessions = sessions.map(s => {
        if (s.id === source.id) {
          return {
            ...s,
            openTabs: sourceTabs,
            activeTileTree: sourceTree,
            canvasScene: sourceScene,
            activeTabId: sourceActive,
          }
        }
        if (s.id === target.id) {
          return {
            ...s,
            openTabs: targetTabs,
            activeTileTree: targetTree,
            canvasScene: targetScene,
            activeTabId: targetActive,
            isRestored: true,
          }
        }
        return s
      })

      // Active session is the source — mirror its updated state to top-level fields
      return {
        sessions: newSessions,
        openTabs: sourceTabs,
        activeTileTree: sourceTree,
        activeCanvasScene: sourceScene,
        activeTabId: sourceActive,
      }
    })
  },

  setSessionSavedData: (id, data) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, savedData: data, isRestored: false } : s
      )
    }))
  },

  setSessionLiveData: (id, openTabs, tileTree, canvasScene, activeTabId, activeView, preservedCanvasScene) => {
    set(state => {
      const updated = state.sessions.map(s =>
        s.id === id
          ? {
            ...s,
            openTabs,
            activeTileTree: tileTree,
            canvasScene,
            preservedCanvasScene,
            activeTabId,
            activeView,
            isRestored: true,
            savedData: undefined,
          }
          : s
      )
      if (state.activeSessionId === id) {
        return {
          sessions: updated,
          openTabs,
          activeTileTree: tileTree,
          activeCanvasScene: canvasScene,
          activeTabId,
          activeView,
        }
      }
      return { sessions: updated }
    })
  },

  rebindSessionRuntime: (sessionId, authorityTabId, ptyId) => {
    set(state => {
      const rebind = (tab: OpenTab): OpenTab => (tab.authorityTabId ?? tab.id) === authorityTabId
        ? { ...tab, ptyId }
        : tab
      const sessions = state.sessions.map(session => session.id === sessionId
        ? { ...session, openTabs: session.openTabs.map(rebind) }
        : session)
      return state.activeSessionId === sessionId
        ? { sessions, openTabs: state.openTabs.map(rebind) }
        : { sessions }
    })
  },

  markSessionRestored: (id) => {
    debugTrace('workspace:restored', { id })
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, isRestored: true } : s
      )
    }))
  },

  getAllOpenTabs: () => {
    const { sessions } = get()
    return sessions.flatMap(s => s.openTabs)
  },

  // -------------------------------------------------------------------------
  // Active session tab ops
  // -------------------------------------------------------------------------

  addTab: (tab) => {
    set(state => {
      const newTabs = [...state.openTabs, tab]
      const activeCanvasScene = reconcileSessionScene(
        state.activeCanvasScene,
        newTabs,
        state.activeTileTree
      )
      return syncToActive(state, {
        openTabs: newTabs,
        activeTabId: tab.id,
        activeCanvasScene,
      })
    })
  },

  removeTab: (id) => {
    set(state => {
      const removedTab = state.openTabs.find(tab => tab.id === id)
      const newTabs = state.openTabs.filter(t => t.id !== id)
      let newActiveId = state.activeTabId
      if (state.activeTabId === id) {
        const idx = state.openTabs.findIndex(t => t.id === id)
        newActiveId = newTabs.length > 0
          ? newTabs[Math.min(idx, newTabs.length - 1)].id
          : null
      }
      const activeCanvasScene = reconcileSessionScene(
        state.activeCanvasScene,
        newTabs,
        state.activeTileTree
      )
      const synced = syncToActive(state, {
        openTabs: newTabs,
        activeTabId: newActiveId,
        activeCanvasScene,
      })
      const attentionKey = removedTab ? tabResourceKey(removedTab) : id
      const { [attentionKey]: _removedAttention, ...attentionByTabId } = state.attentionByTabId
      return { ...synced, attentionByTabId }
    })
  },

  updateTab: (id, updates) => {
    set(state => {
      const newTabs = state.openTabs.map(t => t.id === id ? { ...t, ...updates } : t)
      // Handle ID changes (PTY recreation renames the tab key)
      const newId = (updates as Partial<OpenTab>).id
      let newActiveId = state.activeTabId
      if (newId && state.activeTabId === id) newActiveId = newId
      const remappedScene = newId && state.activeCanvasScene
        ? remapSceneTabIds(state.activeCanvasScene, { [id]: newId })
        : state.activeCanvasScene
      const activeCanvasScene = reconcileSessionScene(
        remappedScene,
        newTabs,
        state.activeTileTree
      )
      const synced = syncToActive(state, {
        openTabs: newTabs,
        activeTabId: newActiveId,
        activeCanvasScene,
      })
      const oldTab = state.openTabs.find(tab => tab.id === id)
      if (!newId || newId === id || !oldTab) return synced
      const oldKey = tabResourceKey(oldTab)
      if (!state.attentionByTabId[oldKey]) return synced
      const newKey = updates.authorityTabId ?? oldTab.authorityTabId
        ? newId
        : serverResourceKey(updates.serverId ?? oldTab.serverId, newId)
      const { [oldKey]: remappedAttention, ...remainingAttention } = state.attentionByTabId
      return { ...synced, attentionByTabId: { ...remainingAttention, [newKey]: remappedAttention } }
    })
  },

  setActiveTab: (id) => {
    set(state => syncToActive(state, { activeTabId: id }))
  },

  clearTabs: () => {
    set(state => {
      const removedIds = new Set(state.openTabs.map(tabResourceKey))
      const attentionByTabId = Object.fromEntries(
        Object.entries(state.attentionByTabId).filter(([id]) => !removedIds.has(id))
      )
      return {
        ...syncToActive(state, {
          openTabs: [],
          activeTabId: null,
          activeCanvasScene: createEmptyCanvasScene(),
        }),
        attentionByTabId,
      }
    })
  },

  clearAllTabs: () => {
    set(state => ({
      openTabs: [],
      activeTabId: null,
      activeTileTree: null,
      activeCanvasScene: createEmptyCanvasScene(),
      attentionByTabId: {},
      sessions: state.sessions.map(s => ({
        ...s,
        openTabs: [],
        activeTabId: null,
        activeTileTree: null,
        canvasScene: createEmptyCanvasScene(),
      }))
    }))
  },

  setActiveTileTree: (tree) => {
    set(state => syncToActive(state, { activeTileTree: tree }))
  },

  setActiveCanvasScene: (scene) => {
    set(state => ({
      activeCanvasScene: scene,
      sessions: state.sessions.map(session => session.id === state.activeSessionId
        ? { ...session, canvasScene: scene, preservedCanvasScene: undefined }
        : session),
    }))
  },

  setActiveView: (view) => {
    set(state => syncToActive(state, { activeView: view }))
  },

  markTabAttention: (id, kind) => {
    set(state => {
      const current = state.attentionByTabId[id]
      if (current === 'needs-input' || current === kind) return state
      return { attentionByTabId: { ...state.attentionByTabId, [id]: kind } }
    })
  },

  clearTabAttention: (id) => {
    set(state => {
      if (!state.attentionByTabId[id]) return state
      const { [id]: _cleared, ...attentionByTabId } = state.attentionByTabId
      return { attentionByTabId }
    })
  },

  clearTabAttentionMany: (ids) => {
    if (ids.length === 0) return
    set(state => {
      const remove = new Set(ids)
      const attentionByTabId = Object.fromEntries(
        Object.entries(state.attentionByTabId).filter(([id]) => !remove.has(id))
      )
      return Object.keys(attentionByTabId).length === Object.keys(state.attentionByTabId).length
        ? state
        : { attentionByTabId }
    })
  },

  // -------------------------------------------------------------------------
  // Project ops
  // -------------------------------------------------------------------------

  setProjects: (projects) => set({ projects }),

  addProject: (project) => {
    const { projects } = get()
    if (!projects.find(p => p.serverId === project.serverId && p.path === project.path)) {
      set({ projects: [...projects, project] })
    }
  },

  removeProject: (path) => {
    set(state => {
      const matches = state.projects.filter(project => project.path === path)
      if (matches.length !== 1) return state
      const target = matches[0]
      return { projects: state.projects.filter(project => project !== target) }
    })
  },

  updateProject: (path, updates) => {
    set(state => {
      const matches = state.projects.filter(project => project.path === path)
      if (matches.length !== 1) return state
      const target = matches[0]
      return { projects: state.projects.map(project => project === target ? { ...project, ...updates } : project) }
    })
  },

  // -------------------------------------------------------------------------
  // Category ops
  // -------------------------------------------------------------------------

  setCategories: (categories) => set({ categories }),

  addCategory: (serverId, name) => {
    const id = serverResourceKey(serverId, generateCategoryId())
    set(state => {
      const maxOrder = state.categories.reduce((m, c) => Math.max(m, c.order), -1)
      return { categories: [...state.categories, { serverId, id, name, collapsed: false, order: maxOrder + 1 }] }
    })
    return id
  },

  updateCategory: (id, updates) => {
    set(state => ({
      categories: state.categories.map(c => c.id === id ? { ...c, ...updates } : c)
    }))
  },

  removeCategory: (id) => {
    set(state => ({
      categories: state.categories.filter(c => c.id !== id),
      projects: state.projects.map(p => p.categoryId === id ? { ...p, categoryId: undefined } : p)
    }))
  },

  reorderCategories: (ids) => {
    set(state => ({
      categories: state.categories.map(c => ({ ...c, order: ids.indexOf(c.id) }))
    }))
  },

  moveProjectToCategory: (projectPath, categoryId) => {
    set(state => {
      const catProjects = state.projects.filter(p =>
        categoryId === null ? !p.categoryId : p.categoryId === categoryId
      )
      const maxOrder = catProjects.reduce((m, p) => Math.max(m, p.order ?? -1), -1)
      return {
        projects: state.projects.map(p =>
          p.path === projectPath
            ? { ...p, categoryId: categoryId ?? undefined, order: maxOrder + 1 }
            : p
        )
      }
    })
  },

  reorderProjects: (categoryId, projectPaths) => {
    set(state => ({
      projects: state.projects.map(p => {
        const idx = projectPaths.indexOf(p.path)
        return idx >= 0 ? { ...p, order: idx } : p
      })
    }))
  },
}))
