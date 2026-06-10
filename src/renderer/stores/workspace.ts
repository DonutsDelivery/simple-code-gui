import { create } from 'zustand'
import { clearProjectCaches } from '../utils/lruCache'
import { debugTrace } from '../debug/debugBridge'

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

export interface WorkspaceSession {
  id: string
  name: string
  openTabs: OpenTab[]
  activeTabId: string | null
  activeTileTree: any | null
  // Raw saved data for lazy PTY restoration
  savedData?: {
    openTabs: any[]
    tileTree: any
    activeTabId: string | null
  }
  isRestored: boolean
}

const generateSessionId = (): string =>
  `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

const generateCategoryId = (): string =>
  `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

interface WorkspaceState {
  projects: Project[]
  categories: ProjectCategory[]
  sessions: WorkspaceSession[]
  activeSessionId: string | null

  // Mirrors of the active session (kept in sync for backward compat)
  openTabs: OpenTab[]
  activeTabId: string | null
  activeTileTree: any | null

  // Session management
  initSessions: (sessions: WorkspaceSession[], activeId: string | null) => void
  addSession: (name?: string) => string
  removeSession: (id: string) => void
  renameSession: (id: string, name: string) => void
  reorderSessions: (id: string, toIndex: number) => void
  switchSession: (id: string) => void
  setSessionSavedData: (id: string, data: { openTabs: any[]; tileTree: any; activeTabId: string | null }) => void
  setSessionLiveData: (id: string, openTabs: OpenTab[], tileTree: any | null, activeTabId: string | null) => void
  markSessionRestored: (id: string) => void
  getAllOpenTabs: () => OpenTab[]

  // Active session tab ops
  addTab: (tab: OpenTab) => void
  removeTab: (id: string) => void
  updateTab: (id: string, updates: Partial<OpenTab>) => void
  setActiveTab: (id: string) => void
  clearTabs: () => void
  clearAllTabs: () => void
  setActiveTileTree: (tree: any | null) => void

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

function syncToActive(
  state: WorkspaceState,
  updates: { openTabs?: OpenTab[]; activeTabId?: string | null; activeTileTree?: any | null }
): Partial<WorkspaceState> {
  const { activeSessionId, sessions } = state
  const newSessions = sessions.map(s =>
    s.id === activeSessionId ? { ...s, ...updates } : s
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
      isRestored: true,
    }
    set(state => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: id,
      openTabs: [],
      activeTabId: null,
      activeTileTree: null,
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
          isRestored: true,
        }
        sessions.push(fallback)
      }
      const newActiveId = state.activeSessionId === id
        ? sessions[sessions.length - 1].id
        : state.activeSessionId
      const active = sessions.find(s => s.id === newActiveId) ?? sessions[0]
      return {
        sessions,
        activeSessionId: active.id,
        openTabs: active.openTabs,
        activeTabId: active.activeTabId,
        activeTileTree: active.activeTileTree,
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

  setSessionLiveData: (id, openTabs, tileTree, activeTabId) => {
    set(state => {
      const updated = state.sessions.map(s =>
        s.id === id
          ? { ...s, openTabs, activeTileTree: tileTree, activeTabId, isRestored: true, savedData: undefined }
          : s
      )
      if (state.activeSessionId === id) {
        return { sessions: updated, openTabs, activeTileTree: tileTree, activeTabId }
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
      return syncToActive(state, { openTabs: newTabs, activeTabId: tab.id })
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
      return syncToActive(state, { openTabs: newTabs, activeTabId: newActiveId })
    })
  },

  updateTab: (id, updates) => {
    set(state => {
      const newTabs = state.openTabs.map(t => t.id === id ? { ...t, ...updates } : t)
      // Handle ID changes (PTY recreation renames the tab key)
      const newId = (updates as any).id
      let newActiveId = state.activeTabId
      if (newId && state.activeTabId === id) newActiveId = newId
      return syncToActive(state, { openTabs: newTabs, activeTabId: newActiveId })
    })
  },

  setActiveTab: (id) => {
    set(state => syncToActive(state, { activeTabId: id }))
  },

  clearTabs: () => {
    set(state => syncToActive(state, { openTabs: [], activeTabId: null }))
  },

  clearAllTabs: () => {
    set(state => ({
      openTabs: [],
      activeTabId: null,
      activeTileTree: null,
      sessions: state.sessions.map(s => ({
        ...s,
        openTabs: [],
        activeTabId: null,
        activeTileTree: null,
      }))
    }))
  },

  setActiveTileTree: (tree) => {
    set(state => syncToActive(state, { activeTileTree: tree }))
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
