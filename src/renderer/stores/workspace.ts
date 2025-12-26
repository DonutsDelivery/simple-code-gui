import { create } from 'zustand'

export interface Project {
  path: string
  name: string
}

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  ptyId: string
}

interface WorkspaceState {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null

  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  removeProject: (path: string) => void

  addTab: (tab: OpenTab) => void
  removeTab: (id: string) => void
  setActiveTab: (id: string) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects: [],
  openTabs: [],
  activeTabId: null,

  setProjects: (projects) => set({ projects }),

  addProject: (project) => {
    const { projects } = get()
    if (!projects.find((p) => p.path === project.path)) {
      set({ projects: [...projects, project] })
    }
  },

  removeProject: (path) => {
    const { projects } = get()
    set({ projects: projects.filter((p) => p.path !== path) })
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

  setActiveTab: (id) => set({ activeTabId: id })
}))
