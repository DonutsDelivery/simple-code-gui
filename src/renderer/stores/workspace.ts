import { create } from 'zustand'
import { clearProjectCaches } from '../utils/lruCache'

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
  color?: string
  ttsVoice?: string
  ttsEngine?: 'piper' | 'xtts'
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
  categoryId?: string
  order?: number
}

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  ptyId: string
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
}

interface WorkspaceState {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
  categories: ProjectCategory[]

  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  removeProject: (path: string) => void
  updateProject: (path: string, updates: Partial<Project>) => void

  addTab: (tab: OpenTab) => void
  removeTab: (id: string) => void
  updateTab: (id: string, updates: Partial<OpenTab>) => void
  setActiveTab: (id: string) => void
  clearTabs: () => void

  setCategories: (categories: ProjectCategory[]) => void
  addCategory: (name: string) => string
  updateCategory: (id: string, updates: Partial<ProjectCategory>) => void
  removeCategory: (id: string) => void
  reorderCategories: (ids: string[]) => void
  moveProjectToCategory: (projectPath: string, categoryId: string | null) => void
  reorderProjects: (categoryId: string | null, projectPaths: string[]) => void
}

const generateCategoryId = (): string =>
  `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects: [],
  openTabs: [],
  activeTabId: null,
  categories: [],

  setProjects: (projects) => set({ projects }),

  addProject: (project) => {
    const { projects } = get()
    if (!projects.find((p) => p.path === project.path)) {
      set({ projects: [...projects, project] })
    }
  },

  removeProject: (path) => {
    const { projects } = get()
    clearProjectCaches(path)
    set({ projects: projects.filter((p) => p.path !== path) })
  },

  updateProject: (path, updates) => {
    const { projects } = get()
    set({
      projects: projects.map((p) =>
        p.path === path ? { ...p, ...updates } : p
      )
    })
  },

  addTab: (tab) => {
    const { openTabs } = get()
    set({
      openTabs: [...openTabs, tab],
      activeTabId: tab.id
    })
  },

  removeTab: (id) => {
    const { openTabs, activeTabId } = get()
    const newTabs = openTabs.filter((t) => t.id !== id)
    let newActiveId = activeTabId

    if (activeTabId === id) {
      const index = openTabs.findIndex((t) => t.id === id)
      if (newTabs.length > 0) {
        newActiveId = newTabs[Math.min(index, newTabs.length - 1)].id
      } else {
        newActiveId = null
      }
    }

    set({ openTabs: newTabs, activeTabId: newActiveId })
  },

  updateTab: (id, updates) => {
    const { openTabs } = get()
    set({
      openTabs: openTabs.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      )
    })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  clearTabs: () => set({ openTabs: [], activeTabId: null }),

  setCategories: (categories) => set({ categories }),

  addCategory: (name) => {
    const { categories } = get()
    const id = generateCategoryId()
    const maxOrder = categories.reduce((max, c) => Math.max(max, c.order), -1)
    set({
      categories: [...categories, { id, name, collapsed: false, order: maxOrder + 1 }]
    })
    return id
  },

  updateCategory: (id, updates) => {
    const { categories } = get()
    set({
      categories: categories.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      )
    })
  },

  removeCategory: (id) => {
    const { categories, projects } = get()
    set({
      categories: categories.filter((c) => c.id !== id),
      projects: projects.map((p) =>
        p.categoryId === id ? { ...p, categoryId: undefined } : p
      )
    })
  },

  reorderCategories: (ids) => {
    const { categories } = get()
    set({
      categories: categories.map((c) => ({
        ...c,
        order: ids.indexOf(c.id)
      }))
    })
  },

  moveProjectToCategory: (projectPath, categoryId) => {
    const { projects } = get()
    const categoryProjects = projects.filter((p) =>
      categoryId === null ? !p.categoryId : p.categoryId === categoryId
    )
    const maxOrder = categoryProjects.reduce((max, p) => Math.max(max, p.order ?? -1), -1)
    set({
      projects: projects.map((p) =>
        p.path === projectPath
          ? { ...p, categoryId: categoryId ?? undefined, order: maxOrder + 1 }
          : p
      )
    })
  },

  reorderProjects: (categoryId, projectPaths) => {
    const { projects } = get()
    set({
      projects: projects.map((p) => {
        const index = projectPaths.indexOf(p.path)
        if (index >= 0) {
          return { ...p, order: index }
        }
        return p
      })
    })
  }
}))
