import { useCallback } from 'react'
import { Project } from '../../stores/workspace.js'
import { SidebarState } from './useSidebarState.js'
import { SidebarHandlers } from './useSidebarHandlers.js'
import { OpenTab } from './types.js'

export interface ProjectItemCallbacks {
  handleProjectToggleExpand: (e: React.MouseEvent, projectPath: string) => void
  handleProjectOpenSession: (
    projectPath: string,
    sessionId?: string,
    slug?: string,
    isNewSession?: boolean
  ) => void
  handleProjectRunExecutable: (projectPath: string) => Promise<void>
  handleProjectCloseProjectTabs: (projectPath: string) => void
  handleProjectContextMenu: (e: React.MouseEvent, project: Project) => void
  handleProjectItemDragStart: (e: React.DragEvent, projectPath: string) => void
  handleProjectItemDragOver: (e: React.DragEvent, projectPath: string) => void
  handleProjectItemDrop: (
    e: React.DragEvent,
    projectPath: string,
    categoryId: string | undefined
  ) => void
  handleProjectStartRename: (e: React.MouseEvent, project: Project) => void
  handleProjectEditingChange: (name: string) => void
  renderProjectItem: (project: Project) => React.ReactElement
}

export interface UseProjectItemCallbacksParams {
  state: SidebarState
  handlers: SidebarHandlers
  projects: Project[]
  openTabs: OpenTab[]
  onCloseProjectTabs: (projectPath: string) => void
}

export function useProjectItemCallbacks(
  params: UseProjectItemCallbacksParams
): Omit<ProjectItemCallbacks, 'renderProjectItem'> {
  const { state, handlers, projects, onCloseProjectTabs } = params
  const {
    toggleProject,
    handleOpenSession,
    setContextMenu,
    handleProjectDragStart,
    handleProjectDragOver,
    handleProjectDrop,
    handleProjectDragEnd,
    setEditingProject,
  } = state
  const { handleRunExecutable, handleStartRename } = handlers

  const handleProjectToggleExpand = useCallback(
    (e: React.MouseEvent, projectPath: string) => {
      toggleProject(e, projectPath)
    },
    [toggleProject]
  )

  const handleProjectOpenSession = useCallback(
    (projectPath: string, sessionId?: string, slug?: string, isNewSession?: boolean) => {
      handleOpenSession(projectPath, sessionId, slug, isNewSession)
    },
    [handleOpenSession]
  )

  const handleProjectRunExecutable = useCallback(
    async (projectPath: string) => {
      const project = projects.find((p) => p.path === projectPath)
      if (project) await handleRunExecutable(project)
    },
    [projects, handleRunExecutable]
  )

  const handleProjectCloseProjectTabs = useCallback(
    (projectPath: string) => {
      onCloseProjectTabs(projectPath)
    },
    [onCloseProjectTabs]
  )

  const handleProjectContextMenu = useCallback(
    (e: React.MouseEvent, project: Project) => {
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({ x: e.clientX, y: e.clientY, project })
    },
    [setContextMenu]
  )

  const handleProjectItemDragStart = useCallback(
    (e: React.DragEvent, projectPath: string) => {
      handleProjectDragStart(e, projectPath)
    },
    [handleProjectDragStart]
  )

  const handleProjectItemDragOver = useCallback(
    (e: React.DragEvent, projectPath: string) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      const position = e.clientY < midY ? 'before' : 'after'
      handleProjectDragOver(e, projectPath, position)
    },
    [handleProjectDragOver]
  )

  const handleProjectItemDrop = useCallback(
    (e: React.DragEvent, projectPath: string, categoryId: string | undefined) => {
      handleProjectDrop(e, projectPath, categoryId)
    },
    [handleProjectDrop]
  )

  const handleProjectStartRename = useCallback(
    (e: React.MouseEvent, project: Project) => {
      handleStartRename(e, project)
    },
    [handleStartRename]
  )

  const handleProjectEditingChange = useCallback(
    (name: string) => {
      setEditingProject((prev) => (prev ? { ...prev, name } : null))
    },
    [setEditingProject]
  )

  return {
    handleProjectToggleExpand,
    handleProjectOpenSession,
    handleProjectRunExecutable,
    handleProjectCloseProjectTabs,
    handleProjectContextMenu,
    handleProjectItemDragStart,
    handleProjectItemDragOver,
    handleProjectItemDrop,
    handleProjectStartRename,
    handleProjectEditingChange,
  }
}

// Separate hook to get the memoization dependencies for renderProjectItem
export function useProjectItemDependencies(
  state: SidebarState,
  callbacks: Omit<ProjectItemCallbacks, 'renderProjectItem'>,
  handlers: SidebarHandlers,
  openTabs: OpenTab[]
): unknown[] {
  const {
    expandedProject,
    focusedProjectPath,
    draggedProject,
    editingProject,
    sessions,
    taskCounts,
    dropTarget,
    handleProjectDragEnd,
  } = state
  const { handleRenameSubmit, handleRenameKeyDown } = handlers

  return [
    expandedProject,
    focusedProjectPath,
    openTabs,
    draggedProject,
    editingProject,
    sessions,
    taskCounts,
    dropTarget,
    callbacks.handleProjectToggleExpand,
    callbacks.handleProjectOpenSession,
    callbacks.handleProjectRunExecutable,
    callbacks.handleProjectCloseProjectTabs,
    callbacks.handleProjectContextMenu,
    callbacks.handleProjectItemDragStart,
    handleProjectDragEnd,
    callbacks.handleProjectItemDragOver,
    callbacks.handleProjectItemDrop,
    callbacks.handleProjectStartRename,
    callbacks.handleProjectEditingChange,
    handleRenameSubmit,
    handleRenameKeyDown,
  ]
}
