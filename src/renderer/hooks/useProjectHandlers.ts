import { useCallback, useRef, useState } from 'react'
import type { Api } from '../api'
import type { BackendId } from '../api/types'
import type { AppSettings } from './useSettings'
import { OpenTab, Project } from '../stores/workspace'
import { TileLayout, DropZone, splitTile, addTileToLayout, addTabToExistingTile } from '../components/TiledTerminalView'
import { clearTerminalBuffer } from '../components/terminal/Terminal'

interface UseProjectHandlersOptions {
  api: Api
  projects: Project[]
  openTabs: OpenTab[]
  settings: AppSettings | null
  tileLayout: TileLayout[]
  addProject: (project: { path: string; name: string }) => void
  removeTab: (id: string) => void
  addTab: (tab: OpenTab) => void
  setActiveTab: (id: string) => void
  setTileLayout: (layout: TileLayout[]) => void
}

interface ClosedTabInfo {
  projectPath: string
  sessionId?: string
  title: string
  backend?: string
}

interface UseProjectHandlersReturn {
  handleAddProject: () => Promise<void>
  handleAddProjectsFromParent: () => Promise<void>
  handleOpenSession: (projectPath: string, sessionId?: string, slug?: string, initialPrompt?: string, forceNewSession?: boolean) => Promise<void>
  handleOpenSessionAtPosition: (projectPath: string, dropZone: DropZone | null, containerSize: { width: number; height: number }, currentLayout?: TileLayout[]) => Promise<void>
  handleCloseTab: (tabId: string) => void
  handleCloseProjectTabs: (projectPath: string) => void
  handleProjectCreated: (projectPath: string, projectName: string) => void
  handleUndoCloseTab: () => void
  canUndoCloseTab: boolean
}

export function useProjectHandlers({
  api,
  projects,
  openTabs,
  settings,
  tileLayout,
  addProject,
  removeTab,
  addTab,
  setActiveTab,
  setTileLayout
}: UseProjectHandlersOptions): UseProjectHandlersReturn {
  const closedTabsRef = useRef<ClosedTabInfo[]>([])
  const [closedTabCount, setClosedTabCount] = useState(0)

  const handleAddProject = useCallback(async () => {
    const path = await api.addProject()
    if (path) {
      const name = path.split(/[/\\]/).pop() || path
      addProject({ path, name })
      await api.ttsInstallInstructions?.(path)
    }
  }, [api, addProject])

  const handleAddProjectsFromParent = useCallback(async () => {
    const projectsToAdd = await api.addProjectsFromParent?.()
    if (projectsToAdd && projectsToAdd.length > 0) {
      const existingPaths = new Set(projects.map((p) => p.path))
      const newProjects = projectsToAdd.filter((p) => !existingPaths.has(p.path))

      for (const project of newProjects) {
        addProject({ path: project.path, name: project.name })
        await api.ttsInstallInstructions?.(project.path)
      }
    }
  }, [api, addProject, projects])

  const handleOpenSession = useCallback(async (projectPath: string, sessionId?: string, slug?: string, initialPrompt?: string, forceNewSession?: boolean) => {
    // Check if this session is already open
    if (sessionId) {
      const existingTab = openTabs.find(tab => tab.sessionId === sessionId)
      if (existingTab) {
        setActiveTab(existingTab.id)
        return
      }
    }

    // Get project and determine effective backend
    const project = projects.find((p) => p.path === projectPath)
    const effectiveBackend = (project?.backend && project.backend !== 'default'
      ? project.backend
      : (settings?.backend && settings.backend !== 'default'
        ? settings.backend
        : 'claude')) as BackendId

    // Only discover sessions if no specific sessionId was requested
    if (!forceNewSession && !sessionId) {
      try {
        const sessions = await api.discoverSessions(projectPath, effectiveBackend)
        if (sessions.length > 0) {
          const [mostRecent] = sessions
          const existingTab = openTabs.find((tab) => tab.sessionId === mostRecent.sessionId)

          if (existingTab) {
            setActiveTab(existingTab.id)
            return
          }
          sessionId = mostRecent.sessionId
          slug = mostRecent.slug
        }
      } catch (e) {
        console.error('Failed to discover sessions for project:', e)
      }
    }

    const projectName = projectPath.split(/[/\\]/).pop() || projectPath
    const title = slug ? `${projectName} - ${slug}` : `${projectName} - New`

    try {
      await api.ttsInstallInstructions?.(projectPath)

      const ptyId = await api.spawnPty(projectPath, sessionId, undefined, effectiveBackend)
      addTab({
        id: ptyId,
        projectPath,
        sessionId,
        title,
        ptyId,
        backend: effectiveBackend
      })

      // If an initial prompt was provided, send it after a short delay
      if (initialPrompt) {
        setTimeout(() => {
          api.writePty(ptyId, initialPrompt)
          setTimeout(() => {
            api.writePty(ptyId, '\r')
          }, 100)
        }, 1500)
      }
    } catch (e: any) {
      console.error('Failed to spawn PTY:', e)
      const errorMsg = e?.message || String(e)
      alert(`Failed to start Claude session:\n\n${errorMsg}\n\nPlease ensure Claude Code is installed and try restarting the application.`)
    }
  }, [api, addTab, openTabs, projects, setActiveTab, settings?.backend, setTileLayout])

  // Keep a ref to the latest tileLayout so async callbacks always read the freshest state
  const tileLayoutRef = useRef(tileLayout)
  tileLayoutRef.current = tileLayout

  const handleOpenSessionAtPosition = useCallback(async (projectPath: string, dropZone: DropZone | null, containerSize: { width: number; height: number }, currentLayout?: TileLayout[]) => {
    // Use the effective layout passed from the drop handler (matches what computeDropZone used),
    // falling back to the latest stored layout via ref (not the stale closure value)
    const layoutToUse = currentLayout || tileLayoutRef.current
    console.log('[App] handleOpenSessionAtPosition called with:', { projectPath, dropZone, containerSize, currentTileLayout: layoutToUse, hadCurrentLayout: !!currentLayout })

    if (!projectPath || projectPath === 'pending') {
      console.error('[App] Invalid project path:', projectPath)
      return
    }

    const project = projects.find((p) => p.path === projectPath)
    console.log('[App] Found project:', project)
    const effectiveBackend = (project?.backend && project.backend !== 'default'
      ? project.backend
      : (settings?.backend && settings.backend !== 'default'
        ? settings.backend
        : 'claude')) as BackendId
    console.log('[App] Using backend:', effectiveBackend)

    // Always create a new session when dragging to a position
    const sessionId: string | undefined = undefined
    const slug: string | undefined = undefined

    const projectName = projectPath.split(/[/\\]/).pop() || projectPath
    const title = slug ? `${projectName} - ${slug}` : `${projectName} - New`

    try {
      await api.ttsInstallInstructions?.(projectPath)
      const ptyId = await api.spawnPty(projectPath, sessionId, undefined, effectiveBackend)

      // Calculate the new layout based on the drop zone
      let newLayout: TileLayout[]

      // Re-read the latest layout after the async spawn (layout may have changed during await)
      const latestLayout = currentLayout || tileLayoutRef.current

      // Sidebar drag onto swap zone → always tab into target tile
      if (dropZone && dropZone.type === 'swap') {
        const targetTile = latestLayout.find(t => t.id === dropZone.targetTileId)
        if (targetTile) {
          console.log('[App] Adding as sub-tab to existing tile')
          newLayout = addTabToExistingTile(latestLayout, targetTile.id, ptyId)
        } else {
          console.log('[App] Using addTileToLayout for swap (target not found)')
          newLayout = addTileToLayout(latestLayout, ptyId, dropZone.targetTileId, containerSize.width, containerSize.height)
        }
      } else if (dropZone && dropZone.type !== 'swap') {
        const direction = dropZone.type.replace('split-', '') as 'top' | 'bottom' | 'left' | 'right'
        console.log('[App] Using splitTile with direction:', direction, 'targetTileId:', dropZone.targetTileId)
        newLayout = splitTile(latestLayout, dropZone.targetTileId, ptyId, direction)
      } else {
        console.log('[App] Using addTileToLayout with no drop zone (null)')
        newLayout = addTileToLayout(latestLayout, ptyId, null, containerSize.width, containerSize.height)
      }
      console.log('[App] New layout calculated:', newLayout)

      // Add tab FIRST, then set layout LAST.
      // This ensures our positioned layout is the final state update and
      // won't be overwritten by useEffectiveLayout's generic positioning
      // if there's an intermediate render between these two updates.
      addTab({
        id: ptyId,
        projectPath,
        sessionId,
        title,
        ptyId,
        backend: effectiveBackend
      })
      setTileLayout(newLayout)
    } catch (e: any) {
      console.error('Failed to spawn PTY:', e)
      const errorMsg = e?.message || String(e)
      alert(`Failed to start Claude session:\n\n${errorMsg}\n\nPlease ensure Claude Code is installed and try restarting the application.`)
    }
  }, [api, addTab, projects, openTabs, settings?.backend, setTileLayout])

  const handleCloseTab = useCallback((tabId: string) => {
    const tab = openTabs.find(t => t.id === tabId)
    if (tab) {
      closedTabsRef.current.push({
        projectPath: tab.projectPath,
        sessionId: tab.sessionId,
        title: tab.title,
        backend: tab.backend
      })
      setClosedTabCount(closedTabsRef.current.length)
    }
    api.killPty(tabId)
    clearTerminalBuffer(tabId)
    removeTab(tabId)
  }, [api, openTabs, removeTab])

  const handleCloseProjectTabs = useCallback((projectPath: string) => {
    const tabsToClose = openTabs.filter(tab => tab.projectPath === projectPath)
    tabsToClose.forEach(tab => {
      api.killPty(tab.id)
      clearTerminalBuffer(tab.id)
      removeTab(tab.id)
    })
  }, [api, openTabs, removeTab])

  const handleProjectCreated = useCallback((projectPath: string, projectName: string) => {
    addProject({ path: projectPath, name: projectName })
    handleOpenSession(projectPath, undefined, undefined, undefined, false)
  }, [addProject, handleOpenSession])

  const handleUndoCloseTab = useCallback(() => {
    const info = closedTabsRef.current.pop()
    if (!info) return
    setClosedTabCount(closedTabsRef.current.length)
    handleOpenSession(info.projectPath, info.sessionId)
  }, [handleOpenSession])

  return {
    handleAddProject,
    handleAddProjectsFromParent,
    handleOpenSession,
    handleOpenSessionAtPosition,
    handleCloseTab,
    handleCloseProjectTabs,
    handleProjectCreated,
    handleUndoCloseTab,
    canUndoCloseTab: closedTabCount > 0
  }
}
