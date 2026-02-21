import { useEffect, useCallback } from 'react'
import { Project } from '../../stores/workspace.js'
import { useSwipeGesture } from '../../hooks/useSwipeGesture.js'
import { SidebarState } from './useSidebarState.js'

// Use type assertion for extended electronAPI methods not in the base type
const electronAPI = window.electronAPI as (typeof window.electronAPI) & {
  apiStatus?: (projectPath: string) => Promise<{ running: boolean; port?: number }>
  beadsCheck?: (cwd: string) => Promise<{ installed: boolean; initialized: boolean }>
  beadsList?: (cwd: string) => Promise<{ success: boolean; tasks?: Array<{ status: string }>; error?: string }>
  isDebugMode?: () => Promise<boolean>
}

export interface UseSidebarEffectsParams {
  state: SidebarState
  projects: Project[]
  isMobile: boolean
  isMobileOpen: boolean | undefined
  onMobileClose: (() => void) | undefined
  onWidthChange: (width: number) => void
}

export function useSidebarEffects(params: UseSidebarEffectsParams): void {
  const { state, projects, isMobile, isMobileOpen, onMobileClose, onWidthChange } = params
  const {
    sidebarRef,
    isResizing,
    setIsResizing,
    contextMenu,
    categoryContextMenu,
    setContextMenu,
    setCategoryContextMenu,
    setApiStatus,
    setTaskCounts,
    focusedProjectPath,
    setIsDebugMode,
  } = state

  // Swipe to close on mobile (swipe left to close drawer)
  useSwipeGesture(sidebarRef, {
    onSwipeLeft: isMobile && isMobileOpen ? onMobileClose : undefined,
    threshold: 50,
  })

  // Resize handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [setIsResizing])

  useEffect(() => {
    let rafId: number | null = null
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const newWidth = Math.min(Math.max(e.clientX, 200), 500)
        onWidthChange(newWidth)
      })
    }
    const handleMouseUp = () => setIsResizing(false)

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, onWidthChange, setIsResizing])

  // Close context menus on click
  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null)
      setCategoryContextMenu(null)
    }
    if (contextMenu || categoryContextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu, categoryContextMenu, setContextMenu, setCategoryContextMenu])

  // Fetch API status when context menu opens
  useEffect(() => {
    if (contextMenu && electronAPI?.apiStatus) {
      electronAPI.apiStatus(contextMenu.project.path).then((status) => {
        setApiStatus((prev) => ({ ...prev, [contextMenu.project.path]: status }))
      })
    }
  }, [contextMenu, setApiStatus])

  // Fetch task counts for all projects
  useEffect(() => {
    async function fetchTaskCounts(): Promise<void> {
      if (!electronAPI?.beadsCheck) return
      const counts: Record<string, { open: number; inProgress: number }> = {}
      for (const project of projects) {
        try {
          const status = await electronAPI.beadsCheck(project.path)
          if (status.installed && status.initialized && electronAPI.beadsList) {
            const result = await electronAPI.beadsList(project.path)
            if (result.success && result.tasks) {
              const tasks = result.tasks as Array<{ status: string }>
              const open = tasks.filter((t) => t.status === 'open').length
              const inProgress = tasks.filter((t) => t.status === 'in_progress').length
              counts[project.path] = { open, inProgress }
            }
          }
        } catch {
          /* ignore */
        }
      }
      setTaskCounts(counts)
    }
    fetchTaskCounts()
    const interval = setInterval(fetchTaskCounts, 30000)
    return () => clearInterval(interval)
  }, [projects, setTaskCounts])

  // Fetch API status for focused project
  useEffect(() => {
    if (focusedProjectPath && electronAPI?.apiStatus) {
      electronAPI.apiStatus(focusedProjectPath).then((status) => {
        setApiStatus((prev) => ({ ...prev, [focusedProjectPath]: status }))
      })
    }
  }, [focusedProjectPath, setApiStatus])

  // Check debug mode on mount
  useEffect(() => {
    electronAPI?.isDebugMode?.()?.then(setIsDebugMode)
  }, [setIsDebugMode])

  // Export handleMouseDown for use in the component
  return
}

export function useResizeHandler(
  setIsResizing: (v: boolean) => void
): (e: React.MouseEvent) => void {
  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
    },
    [setIsResizing]
  )
}
