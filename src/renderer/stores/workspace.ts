import { create } from 'zustand'
import { clearProjectCaches } from '../utils/lruCache'
import { debugTrace } from '../debug/debugBridge'
import { removeTabFromLeaf, splitRoot, createLeaf, generateTileId, type TileNode } from '../components/tile-tree'
import {
  createEmptyCanvasScene,
  generateCanvasScene,
  reconcileCanvasScene,
  remapSceneTabIds,
  type CanvasScene,
  type CanvasTabDescriptor,
} from '../components/canvas'

export interface ProjectCategory {
  id: string
  name: string
  collapsed: boolean
  order: number
}

export interface Project {
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
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok'
  categoryId?: string
  order?: number
}

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  customTitle?: boolean
  ptyId: string
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok'
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

  // Session management
  initSessions: (sessions: WorkspaceSession[], activeId: string | null) => void
  addSession: (name?: string) => string
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
  addCategory: (name: string) => string
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

  addSession: (name) => {
    const id = generateSessionId()
    const { sessions } = get()
    const label = name ?? `Workspace ${sessions.length + 1}`
    const newSession: WorkspaceSession = {
      id,
      name: label,
      openTabs: [],
      activeTabId: null,
      activeTileTree: null,
      canvasScene: createEmptyCanvasScene(),
      activeView: 'tiles',
      isRestored: true,
    }
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

  removeSession: (id) => {
    set(state => {
      const sessions = state.sessions.filter(s => s.id !== id)
      if (sessions.length === 0) {
        // Always keep at least one session
        const fallback: WorkspaceSession = {
          id: generateSessionId(),
          name: 'Workspace 1',
          openTabs: [],
          activeTabId: null,
          activeTileTree: null,
          canvasScene: createEmptyCanvasScene(),
          activeView: 'tiles',
          isRestored: true,
        }
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
      const { [id]: _removedAttention, ...attentionByTabId } = state.attentionByTabId
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
      if (!newId || newId === id || !state.attentionByTabId[id]) return synced
      const { [id]: remappedAttention, ...remainingAttention } = state.attentionByTabId
      return { ...synced, attentionByTabId: { ...remainingAttention, [newId]: remappedAttention } }
    })
  },

  setActiveTab: (id) => {
    set(state => syncToActive(state, { activeTabId: id }))
  },

  clearTabs: () => {
    set(state => {
      const removedIds = new Set(state.openTabs.map(tab => tab.id))
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
    if (!projects.find(p => p.path === project.path)) {
      set({ projects: [...projects, project] })
    }
  },

  removeProject: (path) => {
    clearProjectCaches(path)
    set(state => ({ projects: state.projects.filter(p => p.path !== path) }))
  },

  updateProject: (path, updates) => {
    set(state => ({
      projects: state.projects.map(p => p.path === path ? { ...p, ...updates } : p)
    }))
  },

  // -------------------------------------------------------------------------
  // Category ops
  // -------------------------------------------------------------------------

  setCategories: (categories) => set({ categories }),

  addCategory: (name) => {
    const id = generateCategoryId()
    set(state => {
      const maxOrder = state.categories.reduce((m, c) => Math.max(m, c.order), -1)
      return { categories: [...state.categories, { id, name, collapsed: false, order: maxOrder + 1 }] }
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
