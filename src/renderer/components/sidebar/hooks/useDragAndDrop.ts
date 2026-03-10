import { useState, useCallback, useRef } from 'react'
import { Project } from '../../../stores/workspace.js'
import { DropTarget } from '../types.js'

interface UseDragAndDropOptions {
  projects: Project[]
  moveProjectToCategory: (projectPath: string, categoryId: string | null) => void
  reorderProjects: (categoryId: string | null, projectPaths: string[]) => void
  reorderCategories: (categoryIds: string[]) => void
  categories: Array<{ id: string; name: string; order: number; collapsed?: boolean }>
}

interface UseDragAndDropReturn {
  draggedProject: string | null
  draggedCategory: string | null
  dropTarget: DropTarget | null
  handleProjectDragStart: (e: React.DragEvent, projectPath: string) => void
  handleProjectDragEnd: () => void
  handleCategoryDragOver: (e: React.DragEvent, categoryId: string | null) => void
  handleCategoryDrop: (e: React.DragEvent, categoryId: string | null) => void
  handleProjectDragOver: (
    e: React.DragEvent,
    projectPath: string,
    position: 'before' | 'after'
  ) => void
  handleProjectDrop: (
    e: React.DragEvent,
    targetPath: string,
    targetCategoryId: string | undefined
  ) => void
  handleCategoryDragStart: (e: React.DragEvent, categoryId: string) => void
  handleCategoryDragEnd: () => void
  handleCategoryHeaderDragOver: (
    e: React.DragEvent,
    targetCategoryId: string,
    position: 'before' | 'after'
  ) => void
  handleCategoryHeaderDrop: (e: React.DragEvent, targetCategoryId: string) => void
}

export function useDragAndDrop({
  projects,
  moveProjectToCategory,
  reorderProjects,
  reorderCategories,
  categories,
}: UseDragAndDropOptions): UseDragAndDropReturn {
  const [draggedProject, setDraggedProject] = useState<string | null>(null)
  const [draggedCategory, setDraggedCategory] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  // Ref tracks the latest dropTarget so drop handlers always read fresh position
  // (state in the closure may be stale if React hasn't re-rendered since the last dragOver)
  const dropTargetRef = useRef<DropTarget | null>(null)

  const handleProjectDragStart = useCallback((e: React.DragEvent, projectPath: string) => {
    setDraggedProject(projectPath)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', projectPath)
    // Also set custom type so TiledTerminalView can detect sidebar project drags
    e.dataTransfer.setData('application/x-sidebar-project', projectPath)
  }, [])

  const handleProjectDragEnd = useCallback(() => {
    setDraggedProject(null)
    setDropTarget(null)
    dropTargetRef.current = null
  }, [])

  const handleCategoryDragOver = useCallback(
    (e: React.DragEvent, categoryId: string | null) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (draggedProject) {
        const target: DropTarget = {
          type: categoryId ? 'category' : 'uncategorized',
          id: categoryId,
        }
        setDropTarget(target)
        dropTargetRef.current = target
      }
    },
    [draggedProject]
  )

  const handleCategoryDrop = useCallback(
    (e: React.DragEvent, categoryId: string | null) => {
      e.preventDefault()
      if (draggedProject) {
        moveProjectToCategory(draggedProject, categoryId)
      }
      setDraggedProject(null)
      setDropTarget(null)
      dropTargetRef.current = null
    },
    [draggedProject, moveProjectToCategory]
  )

  const handleProjectDragOver = useCallback(
    (e: React.DragEvent, projectPath: string, position: 'before' | 'after') => {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      if (draggedProject && draggedProject !== projectPath) {
        const target: DropTarget = { type: 'project', id: projectPath, position }
        setDropTarget(target)
        dropTargetRef.current = target
      }
    },
    [draggedProject]
  )

  const handleProjectDrop = useCallback(
    (e: React.DragEvent, targetPath: string, targetCategoryId: string | undefined) => {
      e.preventDefault()
      e.stopPropagation()

      if (draggedProject && draggedProject !== targetPath) {
        const draggedProjectData = projects.find((p) => p.path === draggedProject)
        const targetProject = projects.find((p) => p.path === targetPath)

        if (draggedProjectData && targetProject) {
          moveProjectToCategory(draggedProject, targetCategoryId ?? null)
          const categoryProjects = projects
            .filter((p) =>
              targetCategoryId ? p.categoryId === targetCategoryId : !p.categoryId
            )
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((p) => p.path)

          const newOrder = categoryProjects.filter((p) => p !== draggedProject)
          const targetIndex = newOrder.indexOf(targetPath)
          // Read from ref to get the latest position (state may be stale)
          const currentDropTarget = dropTargetRef.current
          const insertIndex = currentDropTarget?.position === 'after' ? targetIndex + 1 : targetIndex
          newOrder.splice(insertIndex, 0, draggedProject)
          reorderProjects(targetCategoryId ?? null, newOrder)
        }
      }
      setDraggedProject(null)
      setDropTarget(null)
      dropTargetRef.current = null
    },
    [draggedProject, projects, moveProjectToCategory, reorderProjects]
  )

  const handleCategoryDragStart = useCallback((e: React.DragEvent, categoryId: string) => {
    setDraggedCategory(categoryId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', categoryId)
  }, [])

  const handleCategoryDragEnd = useCallback(() => {
    setDraggedCategory(null)
    setDropTarget(null)
    dropTargetRef.current = null
  }, [])

  const handleCategoryHeaderDragOver = useCallback(
    (e: React.DragEvent, targetCategoryId: string, position: 'before' | 'after') => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (draggedCategory && draggedCategory !== targetCategoryId) {
        const target: DropTarget = { type: 'category', id: targetCategoryId, position }
        setDropTarget(target)
        dropTargetRef.current = target
      }
    },
    [draggedCategory]
  )

  const handleCategoryHeaderDrop = useCallback(
    (e: React.DragEvent, targetCategoryId: string) => {
      e.preventDefault()
      if (draggedCategory && draggedCategory !== targetCategoryId) {
        const orderedCategories = [...categories].sort((a, b) => a.order - b.order)
        const categoryIds = orderedCategories.map((c) => c.id)
        const newOrder = categoryIds.filter((id) => id !== draggedCategory)
        const targetIndex = newOrder.indexOf(targetCategoryId)
        // Read from ref to get the latest position (state may be stale)
        const currentDropTarget = dropTargetRef.current
        const insertIndex = currentDropTarget?.position === 'after' ? targetIndex + 1 : targetIndex
        newOrder.splice(insertIndex, 0, draggedCategory)
        reorderCategories(newOrder)
      }
      setDraggedCategory(null)
      setDropTarget(null)
      dropTargetRef.current = null
    },
    [draggedCategory, categories, reorderCategories]
  )

  return {
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
  }
}
