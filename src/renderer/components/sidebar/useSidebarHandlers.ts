import { useCallback } from 'react'
import { Project, useWorkspaceStore } from '../../stores/workspace.js'
import { SidebarState } from './useSidebarState.js'
import { SidebarProps } from './types.js'

// Use type assertion for extended electronAPI methods not in the base type
const electronAPI = window.electronAPI as (typeof window.electronAPI) & {
  selectExecutable?: () => Promise<string | null>
  runExecutable?: (executable: string, cwd: string) => Promise<{ success: boolean; error?: string }>
  getCategoryMetaPath?: (categoryName: string) => Promise<string>
  getMetaProjectsPath?: () => Promise<string>
}

export interface SidebarHandlers {
  // Project handlers
  handleSelectExecutable: (project: Project) => Promise<void>
  handleClearExecutable: (project: Project) => void
  handleRunExecutable: (project: Project) => Promise<void>

  // Rename handlers
  handleStartRename: (e: React.MouseEvent, project: Project) => void
  handleRenameSubmit: () => void
  handleRenameKeyDown: (e: React.KeyboardEvent) => void

  // Category handlers
  handleAddCategory: () => void
  handleOpenCategoryAsProject: (categoryName: string) => Promise<void>
  handleOpenAllProjects: () => Promise<void>
  handleStartCategoryRename: (
    category: ReturnType<typeof useWorkspaceStore.getState>['categories'][0]
  ) => void
  handleCategoryRenameSubmit: () => void
  handleCategoryRenameKeyDown: (e: React.KeyboardEvent) => void
  toggleCategoryCollapse: (categoryId: string) => void

  // Resize handler
  handleMouseDown: (e: React.MouseEvent) => void

  // Backdrop handler
  handleBackdropClick: () => void
}

export interface UseSidebarHandlersParams {
  state: SidebarState
  onUpdateProject: SidebarProps['onUpdateProject']
  onOpenSession: SidebarProps['onOpenSession']
  isMobile: boolean
  onMobileClose: (() => void) | undefined
}

export function useSidebarHandlers(params: UseSidebarHandlersParams): SidebarHandlers {
  const { state, onUpdateProject, onOpenSession, isMobile, onMobileClose } = params
  const {
    setContextMenu,
    editingProject,
    setEditingProject,
    editInputRef,
    editingCategory,
    setEditingCategory,
    categoryEditInputRef,
    addCategory,
    updateCategory,
    categories,
    setIsResizing,
    moveProjectToCategory,
  } = state

  // Project handlers
  const handleSelectExecutable = useCallback(
    async (project: Project) => {
      const executable = await electronAPI?.selectExecutable?.()
      if (executable) onUpdateProject(project.path, { executable })
      setContextMenu(null)
    },
    [onUpdateProject, setContextMenu]
  )

  const handleClearExecutable = useCallback(
    (project: Project) => {
      onUpdateProject(project.path, { executable: undefined })
      setContextMenu(null)
    },
    [onUpdateProject, setContextMenu]
  )

  const handleRunExecutable = useCallback(
    async (project: Project) => {
      if (project.executable) {
        const result = await electronAPI?.runExecutable?.(project.executable, project.path)
        if (result && !result.success) console.error('Failed to run executable:', result.error)
      }
      setContextMenu(null)
    },
    [setContextMenu]
  )

  // Rename handlers
  const handleStartRename = useCallback(
    (e: React.MouseEvent, project: Project) => {
      e.stopPropagation()
      setEditingProject({ path: project.path, name: project.name })
      setTimeout(() => editInputRef.current?.select(), 0)
    },
    [setEditingProject, editInputRef]
  )

  const handleRenameSubmit = useCallback(() => {
    if (editingProject && editingProject.name.trim()) {
      onUpdateProject(editingProject.path, { name: editingProject.name.trim() })
    }
    setEditingProject(null)
  }, [editingProject, onUpdateProject, setEditingProject])

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleRenameSubmit()
      else if (e.key === 'Escape') setEditingProject(null)
    },
    [handleRenameSubmit, setEditingProject]
  )

  // Category handlers
  const handleAddCategory = useCallback(() => {
    const newId = addCategory('New Category')
    setEditingCategory({ id: newId, name: 'New Category' })
    setTimeout(() => categoryEditInputRef.current?.select(), 0)
  }, [addCategory, setEditingCategory, categoryEditInputRef])

  const handleOpenCategoryAsProject = useCallback(
    async (categoryName: string) => {
      const metaPath = await electronAPI?.getCategoryMetaPath?.(categoryName)
      if (metaPath) onOpenSession(metaPath)
    },
    [onOpenSession]
  )

  const handleOpenAllProjects = useCallback(async () => {
    const metaPath = await electronAPI?.getMetaProjectsPath?.()
    if (metaPath) onOpenSession(metaPath)
  }, [onOpenSession])

  const handleStartCategoryRename = useCallback(
    (category: ReturnType<typeof useWorkspaceStore.getState>['categories'][0]) => {
      setEditingCategory({ id: category.id, name: category.name })
      setTimeout(() => categoryEditInputRef.current?.select(), 0)
    },
    [setEditingCategory, categoryEditInputRef]
  )

  const handleCategoryRenameSubmit = useCallback(() => {
    if (editingCategory && editingCategory.name.trim()) {
      updateCategory(editingCategory.id, { name: editingCategory.name.trim() })
    }
    setEditingCategory(null)
  }, [editingCategory, updateCategory, setEditingCategory])

  const handleCategoryRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleCategoryRenameSubmit()
      else if (e.key === 'Escape') setEditingCategory(null)
    },
    [handleCategoryRenameSubmit, setEditingCategory]
  )

  const toggleCategoryCollapse = useCallback(
    (categoryId: string) => {
      const category = categories.find((c) => c.id === categoryId)
      if (category) updateCategory(categoryId, { collapsed: !category.collapsed })
    },
    [categories, updateCategory]
  )

  // Resize handler
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
    },
    [setIsResizing]
  )

  // Backdrop handler
  const handleBackdropClick = useCallback(() => {
    if (isMobile && onMobileClose) {
      onMobileClose()
    }
  }, [isMobile, onMobileClose])

  return {
    handleSelectExecutable,
    handleClearExecutable,
    handleRunExecutable,
    handleStartRename,
    handleRenameSubmit,
    handleRenameKeyDown,
    handleAddCategory,
    handleOpenCategoryAsProject,
    handleOpenAllProjects,
    handleStartCategoryRename,
    handleCategoryRenameSubmit,
    handleCategoryRenameKeyDown,
    toggleCategoryCollapse,
    handleMouseDown,
    handleBackdropClick,
  }
}

// Helper for creating category with project
export function useCreateCategoryWithProject(
  state: SidebarState
): (projectPath: string) => void {
  const { addCategory, moveProjectToCategory, setContextMenu, setEditingCategory, categoryEditInputRef } = state

  return useCallback(
    (projectPath: string) => {
      const newId = addCategory('New Category')
      moveProjectToCategory(projectPath, newId)
      setContextMenu(null)
      setEditingCategory({ id: newId, name: 'New Category' })
      setTimeout(() => categoryEditInputRef.current?.select(), 0)
    },
    [addCategory, moveProjectToCategory, setContextMenu, setEditingCategory, categoryEditInputRef]
  )
}
