import React, { useState, useRef, useMemo } from 'react'
import { Project, useWorkspaceStore } from '../../stores/workspace.js'
import { useVoice } from '../../contexts/VoiceContext.js'
import { SidebarProps, OpenTab, ClaudeSession } from './types.js'
import { useSessions, useDragAndDrop, useProjectSettingsModal } from './hooks/index.js'

export interface SidebarState {
  // Voice context
  volume: number
  setVolume: (v: number) => void
  speed: number
  setSpeed: (s: number) => void
  skipOnNew: boolean
  setSkipOnNew: (s: boolean) => void
  voiceOutputEnabled: boolean

  // Workspace store
  categories: ReturnType<typeof useWorkspaceStore.getState>['categories']
  addCategory: (name: string) => string
  updateCategory: (id: string, updates: Partial<{ name: string; collapsed: boolean }>) => void
  removeCategory: (id: string) => void
  reorderCategories: (categoryIds: string[]) => void
  moveProjectToCategory: (projectPath: string, categoryId: string | null) => void
  reorderProjects: (categoryId: string | null, projectPaths: string[]) => void

  // Custom hooks
  expandedProject: string | null
  sessions: Record<string, ClaudeSession[]>
  toggleProject: (e: React.MouseEvent, projectPath: string) => void
  handleOpenSession: (
    projectPath: string,
    sessionId?: string,
    slug?: string,
    isNewSession?: boolean
  ) => void

  // Drag and drop
  draggedProject: string | null
  draggedCategory: string | null
  dropTarget: { type: 'category' | 'project' | 'uncategorized'; id: string | null; position?: 'before' | 'after' } | null
  handleProjectDragStart: (e: React.DragEvent, projectPath: string) => void
  handleProjectDragEnd: () => void
  handleCategoryDragOver: (e: React.DragEvent, categoryId: string | null) => void
  handleCategoryDrop: (e: React.DragEvent, categoryId: string | null) => void
  handleProjectDragOver: (e: React.DragEvent, projectPath: string, position: 'before' | 'after') => void
  handleProjectDrop: (e: React.DragEvent, projectPath: string, categoryId: string | undefined) => void
  handleCategoryDragStart: (e: React.DragEvent, categoryId: string) => void
  handleCategoryDragEnd: () => void
  handleCategoryHeaderDragOver: (e: React.DragEvent, categoryId: string, position: 'before' | 'after') => void
  handleCategoryHeaderDrop: (e: React.DragEvent, categoryId: string) => void

  // Project settings modal
  projectSettingsModal: ReturnType<typeof useProjectSettingsModal>['projectSettingsModal']
  installedVoices: ReturnType<typeof useProjectSettingsModal>['installedVoices']
  globalVoiceSettings: ReturnType<typeof useProjectSettingsModal>['globalVoiceSettings']
  globalPermissions: ReturnType<typeof useProjectSettingsModal>['globalPermissions']
  apiStatus: ReturnType<typeof useProjectSettingsModal>['apiStatus']
  setApiStatus: ReturnType<typeof useProjectSettingsModal>['setApiStatus']
  handleOpenProjectSettings: ReturnType<typeof useProjectSettingsModal>['handleOpenProjectSettings']
  handleSaveProjectSettings: ReturnType<typeof useProjectSettingsModal>['handleSaveProjectSettings']
  handleToggleApi: ReturnType<typeof useProjectSettingsModal>['handleToggleApi']
  setProjectSettingsModal: ReturnType<typeof useProjectSettingsModal>['setProjectSettingsModal']
  handleToggleTool: ReturnType<typeof useProjectSettingsModal>['handleToggleTool']
  handleAllowAll: ReturnType<typeof useProjectSettingsModal>['handleAllowAll']
  handleClearAll: ReturnType<typeof useProjectSettingsModal>['handleClearAll']
  handleProjectSettingsChange: ReturnType<typeof useProjectSettingsModal>['handleProjectSettingsChange']

  // Local state
  beadsExpanded: boolean
  setBeadsExpanded: (v: boolean) => void
  isResizing: boolean
  setIsResizing: (v: boolean) => void
  contextMenu: { x: number; y: number; project: Project } | null
  setContextMenu: (v: { x: number; y: number; project: Project } | null) => void
  categoryContextMenu: {
    x: number
    y: number
    category: ReturnType<typeof useWorkspaceStore.getState>['categories'][0]
  } | null
  setCategoryContextMenu: (
    v: {
      x: number
      y: number
      category: ReturnType<typeof useWorkspaceStore.getState>['categories'][0]
    } | null
  ) => void
  editingProject: { path: string; name: string } | null
  setEditingProject: React.Dispatch<React.SetStateAction<{ path: string; name: string } | null>>
  editingCategory: { id: string; name: string } | null
  setEditingCategory: (v: { id: string; name: string } | null) => void
  isDebugMode: boolean
  setIsDebugMode: (v: boolean) => void
  extensionBrowserModal: { project: Project } | null
  setExtensionBrowserModal: (v: { project: Project } | null) => void
  claudeMdEditorModal: { project: Project } | null
  setClaudeMdEditorModal: (v: { project: Project } | null) => void
  deleteConfirmModal: { project: Project } | null
  setDeleteConfirmModal: (v: { project: Project } | null) => void
  taskCounts: Record<string, { open: number; inProgress: number }>
  setTaskCounts: (v: Record<string, { open: number; inProgress: number }>) => void

  // Refs
  sidebarRef: React.RefObject<HTMLDivElement>
  editInputRef: React.RefObject<HTMLInputElement>
  categoryEditInputRef: React.RefObject<HTMLInputElement>

  // Computed values
  focusedTabId: string | null
  focusedTab: OpenTab | undefined
  focusedProjectPath: string | null
  focusedTabPtyId: string | null
  beadsProjectPath: string | null
  focusedProject: Project | undefined
  sortedCategories: ReturnType<typeof useWorkspaceStore.getState>['categories']
  projectsByCategory: Record<string, Project[]>
}

export interface UseSidebarStateParams {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
  lastFocusedTabId: string | null
  onOpenSession: SidebarProps['onOpenSession']
  onSwitchToTab: SidebarProps['onSwitchToTab']
  onUpdateProject: SidebarProps['onUpdateProject']
}

export function useSidebarState(params: UseSidebarStateParams): SidebarState {
  const { projects, openTabs, activeTabId, lastFocusedTabId, onOpenSession, onSwitchToTab, onUpdateProject } = params

  // Voice context
  const { volume, setVolume, speed, setSpeed, skipOnNew, setSkipOnNew, voiceOutputEnabled } =
    useVoice()

  // Workspace store
  const categories = useWorkspaceStore((state) => state.categories)
  const addCategory = useWorkspaceStore((state) => state.addCategory)
  const updateCategory = useWorkspaceStore((state) => state.updateCategory)
  const removeCategory = useWorkspaceStore((state) => state.removeCategory)
  const reorderCategories = useWorkspaceStore((state) => state.reorderCategories)
  const moveProjectToCategory = useWorkspaceStore((state) => state.moveProjectToCategory)
  const reorderProjects = useWorkspaceStore((state) => state.reorderProjects)

  // Custom hooks for extracted logic
  const { expandedProject, sessions, toggleProject, handleOpenSession } = useSessions({
    projects,
    openTabs,
    onOpenSession,
    onSwitchToTab,
  })

  const {
    draggedProject,
    draggedCategory,
    dropTarget,
    handleProjectDragStart,
    handleProjectDragEnd,
    handleCategoryDragOver,
    handleCategoryDrop,
    handleProjectDragOver,
    handleProjectDrop,
    handleCategoryDragStart,
    handleCategoryDragEnd,
    handleCategoryHeaderDragOver,
    handleCategoryHeaderDrop,
  } = useDragAndDrop({
    projects,
    moveProjectToCategory,
    reorderProjects,
    reorderCategories,
    categories,
  })

  const {
    projectSettingsModal,
    installedVoices,
    globalVoiceSettings,
    globalPermissions,
    apiStatus,
    setApiStatus,
    handleOpenProjectSettings,
    handleSaveProjectSettings,
    handleToggleApi,
    setProjectSettingsModal,
    handleToggleTool,
    handleAllowAll,
    handleClearAll,
    handleProjectSettingsChange,
  } = useProjectSettingsModal({ onUpdateProject })

  // Local state
  const [beadsExpanded, setBeadsExpanded] = useState(true)
  const [isResizing, setIsResizing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: Project } | null>(
    null
  )
  const [categoryContextMenu, setCategoryContextMenu] = useState<{
    x: number
    y: number
    category: ReturnType<typeof useWorkspaceStore.getState>['categories'][0]
  } | null>(null)
  const [editingProject, setEditingProject] = useState<{ path: string; name: string } | null>(null)
  const [editingCategory, setEditingCategory] = useState<{ id: string; name: string } | null>(null)
  const [isDebugMode, setIsDebugMode] = useState(false)
  const [extensionBrowserModal, setExtensionBrowserModal] = useState<{ project: Project } | null>(
    null
  )
  const [claudeMdEditorModal, setClaudeMdEditorModal] = useState<{ project: Project } | null>(null)
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{ project: Project } | null>(null)
  const [taskCounts, setTaskCounts] = useState<Record<string, { open: number; inProgress: number }>>(
    {}
  )

  // Refs
  const sidebarRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const categoryEditInputRef = useRef<HTMLInputElement>(null)

  // Computed values
  const focusedTabId = lastFocusedTabId || activeTabId
  const focusedTab = useMemo(
    () => openTabs.find((t) => t.id === focusedTabId),
    [openTabs, focusedTabId]
  )
  const focusedProjectPath = useMemo(() => focusedTab?.projectPath || null, [focusedTab])
  const focusedTabPtyId = useMemo(() => focusedTab?.ptyId || null, [focusedTab])
  const beadsProjectPath = useMemo(
    () => focusedProjectPath || expandedProject,
    [focusedProjectPath, expandedProject]
  )
  const focusedProject = useMemo(
    () => projects.find((p) => p.path === focusedProjectPath),
    [projects, focusedProjectPath]
  )

  // Computed groupings
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.order - b.order),
    [categories]
  )

  const projectsByCategory = useMemo(() => {
    const grouped: Record<string, Project[]> = {}
    sortedCategories.forEach((cat) => {
      grouped[cat.id] = []
    })
    grouped['uncategorized'] = []

    projects.forEach((project) => {
      const key = project.categoryId || 'uncategorized'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(project)
    })

    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    })

    return grouped
  }, [projects, sortedCategories])

  return {
    // Voice context
    volume,
    setVolume,
    speed,
    setSpeed,
    skipOnNew,
    setSkipOnNew,
    voiceOutputEnabled,

    // Workspace store
    categories,
    addCategory,
    updateCategory,
    removeCategory,
    reorderCategories,
    moveProjectToCategory,
    reorderProjects,

    // Sessions hook
    expandedProject,
    sessions,
    toggleProject,
    handleOpenSession,

    // Drag and drop hook
    draggedProject,
    draggedCategory,
    dropTarget,
    handleProjectDragStart,
    handleProjectDragEnd,
    handleCategoryDragOver,
    handleCategoryDrop,
    handleProjectDragOver,
    handleProjectDrop,
    handleCategoryDragStart,
    handleCategoryDragEnd,
    handleCategoryHeaderDragOver,
    handleCategoryHeaderDrop,

    // Project settings modal hook
    projectSettingsModal,
    installedVoices,
    globalVoiceSettings,
    globalPermissions,
    apiStatus,
    setApiStatus,
    handleOpenProjectSettings,
    handleSaveProjectSettings,
    handleToggleApi,
    setProjectSettingsModal,
    handleToggleTool,
    handleAllowAll,
    handleClearAll,
    handleProjectSettingsChange,

    // Local state
    beadsExpanded,
    setBeadsExpanded,
    isResizing,
    setIsResizing,
    contextMenu,
    setContextMenu,
    categoryContextMenu,
    setCategoryContextMenu,
    editingProject,
    setEditingProject,
    editingCategory,
    setEditingCategory,
    isDebugMode,
    setIsDebugMode,
    extensionBrowserModal,
    setExtensionBrowserModal,
    claudeMdEditorModal,
    setClaudeMdEditorModal,
    deleteConfirmModal,
    setDeleteConfirmModal,
    taskCounts,
    setTaskCounts,

    // Refs
    sidebarRef,
    editInputRef,
    categoryEditInputRef,

    // Computed values
    focusedTabId,
    focusedTab,
    focusedProjectPath,
    focusedTabPtyId,
    beadsProjectPath,
    focusedProject,
    sortedCategories,
    projectsByCategory,
  }
}
