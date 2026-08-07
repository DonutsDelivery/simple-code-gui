import { useCallback, useRef, useState } from 'react'
import type { Api } from '../api'
import type { BackendId } from '../api/types'
import type { AppSettings } from './useSettings'
import { serverResourceKey, OpenTab, Project } from '../stores/workspace'
import type { TileNode } from '../components/tile-tree.js'
import type { DropZone } from '../components/tiled-layout-utils.js'
import {
  createLeaf,
  splitLeaf,
  splitRoot,
  addLeafToTree,
  addTabToLeaf,
  removeTabFromLeaf,
  findLeafByTabId,
  findLeafById
} from '../components/tile-tree.js'
import { clearTerminalBuffer } from '../components/terminal/Terminal'

interface UseProjectHandlersOptions {
  serverId: string
  api: Api
  getApiForServer: (serverId: string) => Api | undefined
  projects: Project[]
  openTabs: OpenTab[]
  settings: AppSettings | null
  tileTree: TileNode | null
  addProject: (project: Project) => void
  removeTab: (id: string) => void
  addTab: (tab: OpenTab) => void
  setActiveTab: (id: string) => void
  setTileTree: (tree: TileNode | null) => void
}

interface ClosedTabInfo {
  serverId: string
  projectPath: string
  agentSessionId?: string
  sessionId?: string
  title: string
  backend?: string
}

export interface OpenSessionOptions {
  serverId?: string
  harnessId?: BackendId
  agentSessionId?: string
  sessionId?: string
  slug?: string
  initialPrompt?: string
  forceNewSession?: boolean
  resumeCwd?: string
}

interface UseProjectHandlersReturn {
  handleAddProject: () => Promise<void>
  handleAddProjectsFromParent: () => Promise<void>
  handleOpenSession: (projectPath: string, options?: OpenSessionOptions) => Promise<void>
  handleOpenSessionAtPosition: (projectPath: string, dropZone: DropZone | null, containerSize: { width: number; height: number }, currentTree?: TileNode | null, harnessId?: string) => Promise<void>
  handleAddTabToTile: (projectPath: string, tileId: string, backend?: string) => Promise<void>
  handleCloseTab: (tabId: string) => void
  handleCloseProjectTabs: (projectPath: string) => void
  handleProjectCreated: (projectPath: string, projectName: string) => void
  handleUndoCloseTab: () => void
  canUndoCloseTab: boolean
}

export function useProjectHandlers({
  serverId,
  api,
  getApiForServer,
  projects,
  openTabs,
  settings,
  tileTree,
  addProject,
  removeTab,
  addTab,
  setActiveTab,
  setTileTree
}: UseProjectHandlersOptions): UseProjectHandlersReturn {
  const closedTabsRef = useRef<ClosedTabInfo[]>([])
  const [closedTabCount, setClosedTabCount] = useState(0)

  // Keep a ref to the latest tileTree so async callbacks always read the freshest state
  const tileTreeRef = useRef(tileTree)
  tileTreeRef.current = tileTree

  /** Resolve project → effective AI backend, used for instruction file injection */
  const getEffectiveBackend = useCallback((projectPath: string): BackendId => {
    const project = projects.find((p) => p.serverId === serverId && p.path === projectPath)
    return (project?.backend && project.backend !== 'default'
      ? project.backend
      : (settings?.backend && settings.backend !== 'default'
        ? settings.backend
        : 'claude')) as BackendId
  }, [projects, settings?.backend])

  const handleAddProject = useCallback(async () => {
    const path = await api.addProject()
    if (path) {
      const name = path.split(/[/\\]/).pop() || path
      addProject({ serverId, path, name })
      await api.ttsInstallInstructions?.(path, getEffectiveBackend(path))
    }
  }, [api, addProject, getEffectiveBackend])

  const handleAddProjectsFromParent = useCallback(async () => {
    const projectsToAdd = await api.addProjectsFromParent?.()
    if (projectsToAdd && projectsToAdd.length > 0) {
      const existingPaths = new Set(projects.map((p) => p.path))
      const newProjects = projectsToAdd.filter((p) => !existingPaths.has(p.path))

      for (const project of newProjects) {
        addProject({ serverId, path: project.path, name: project.name })
        await api.ttsInstallInstructions?.(project.path, getEffectiveBackend(project.path))
      }
    }
  }, [api, addProject, projects])

  const handleOpenSession = useCallback(async (projectPath: string, options: OpenSessionOptions = {}) => {
    let { agentSessionId, sessionId, slug, resumeCwd } = options
    const { initialPrompt, forceNewSession = false } = options
    const targetServerId = options.serverId || serverId
    const targetApi = getApiForServer(targetServerId)
    if (!targetApi) throw new Error(`Server ${targetServerId} is disconnected`)

    // Check if this session is already open
    if (sessionId) {
      const existingTab = openTabs.find(tab => tab.serverId === targetServerId && tab.sessionId === sessionId)
      if (existingTab) {
        setActiveTab(existingTab.id)
        return
      }
    }

    // Get project and determine effective backend
    const project = projects.find((p) => p.serverId === targetServerId && p.path === projectPath)
    const effectiveBackend = (options.harnessId || (project?.backend && project.backend !== 'default'
      ? project.backend
      : (settings?.backend && settings.backend !== 'default'
        ? settings.backend
        : 'claude'))) as BackendId

    // Only discover sessions if no specific sessionId was requested
    if (!forceNewSession && !sessionId) {
      try {
        const sessions = await targetApi.discoverSessions(projectPath, effectiveBackend)
        if (sessions.length > 0) {
          const [mostRecent] = sessions
          const existingTab = openTabs.find((tab) => tab.serverId === targetServerId && tab.sessionId === mostRecent.sessionId)

          if (existingTab) {
            setActiveTab(existingTab.id)
            return
          }
          sessionId = mostRecent.sessionId
          slug = mostRecent.slug
          resumeCwd = mostRecent.cwd || projectPath
        }
      } catch (e) {
        console.error('Failed to discover sessions for project:', e)
      }
    }

    const projectName = projectPath.split(/[/\\]/).pop() || projectPath
    const title = slug ? `${projectName} - ${slug}` : `${projectName} - New`

    try {
      const workingPath = resumeCwd || projectPath
      await targetApi.ttsInstallInstructions?.(workingPath, effectiveBackend)

      const ptyId = await targetApi.spawnPty(workingPath, sessionId, undefined, effectiveBackend, agentSessionId)
      const rendererTabId = serverResourceKey(targetServerId, ptyId)

      // Add leaf to tree — single operation, no race condition
      const currentTree = tileTreeRef.current
      const newTree = addLeafToTree(currentTree, rendererTabId, window.innerWidth, window.innerHeight)
      setTileTree(newTree)

      addTab({
        serverId: targetServerId,
        id: rendererTabId,
        authorityTabId: ptyId,
        projectPath: workingPath,
        agentSessionId: agentSessionId || sessionId || ptyId,
        sessionId,
        title,
        ptyId,
        backend: effectiveBackend
      })

      // If an initial prompt was provided, send it after a short delay
      if (initialPrompt) {
        setTimeout(() => {
          targetApi.writePty(ptyId, initialPrompt)
          setTimeout(() => {
            targetApi.writePty(ptyId, '\r')
          }, 100)
        }, 1500)
      }
    } catch (e: any) {
      console.error('Failed to spawn PTY:', e)
      const errorMsg = e?.message || String(e)
      alert(`Failed to start ${effectiveBackend} session:\n\n${errorMsg}\n\nPlease make sure the ${effectiveBackend} harness is installed, then try again.`)
    }
  }, [addTab, getApiForServer, openTabs, projects, serverId, setActiveTab, settings?.backend, setTileTree])

  const handleOpenSessionAtPosition = useCallback(async (projectPath: string, dropZone: DropZone | null, containerSize: { width: number; height: number }, currentTree?: TileNode | null, harnessId?: string) => {
    const treeToUse = currentTree !== undefined ? currentTree : tileTreeRef.current

    if (!projectPath || projectPath === 'pending') {
      console.error('[App] Invalid project path:', projectPath)
      return
    }

    const project = projects.find((p) => p.serverId === serverId && p.path === projectPath)
    const effectiveBackend = (harnessId && harnessId !== 'default'
      ? harnessId
      : (project?.backend && project.backend !== 'default'
        ? project.backend
        : (settings?.backend && settings.backend !== 'default'
          ? settings.backend
          : 'claude'))) as BackendId

    const projectName = projectPath.split(/[/\\]/).pop() || projectPath
    const title = `${projectName} - New`

    try {
      await api.ttsInstallInstructions?.(projectPath, effectiveBackend)
      const ptyId = await api.spawnPty(projectPath, undefined, undefined, effectiveBackend)
      const rendererTabId = serverResourceKey(serverId, ptyId)

      let newTree: TileNode

      // Re-read the latest tree after async spawn
      const latestTree = currentTree !== undefined ? currentTree : tileTreeRef.current
      const newLeaf = createLeaf(rendererTabId, [rendererTabId])

      if (dropZone && dropZone.type === 'swap' && latestTree) {
        // Add as sub-tab to existing tile
        const targetLeaf = findLeafByTabId(latestTree, dropZone.targetTileId) ||
          (latestTree.type === 'leaf' && latestTree.id === dropZone.targetTileId ? latestTree : null) ||
          findLeafById(latestTree, dropZone.targetTileId)
        if (targetLeaf) {
          newTree = addTabToLeaf(latestTree, targetLeaf.id, rendererTabId)
        } else {
          newTree = addLeafToTree(latestTree, rendererTabId, containerSize.width, containerSize.height)
        }
      } else if (dropZone && (dropZone.type === 'root-right' || dropZone.type === 'root-bottom') && latestTree) {
        // Drop on empty canvas: new root-level column/row
        newTree = splitRoot(latestTree, dropZone.type === 'root-right' ? 'horizontal' : 'vertical', newLeaf, 'after')
      } else if (dropZone && dropZone.type !== 'swap' && latestTree) {
        // Split target tile in the drop direction
        const dirMap: Record<string, { dir: 'horizontal' | 'vertical'; pos: 'before' | 'after' }> = {
          'split-left': { dir: 'horizontal', pos: 'before' },
          'split-right': { dir: 'horizontal', pos: 'after' },
          'split-top': { dir: 'vertical', pos: 'before' },
          'split-bottom': { dir: 'vertical', pos: 'after' }
        }
        const { dir, pos } = dirMap[dropZone.type]
        // Find the target leaf - try by ID first (it's a tile/leaf ID from computeDropZone)
        const targetLeafId = dropZone.targetTileId
        newTree = splitLeaf(latestTree, targetLeafId, dir, newLeaf, pos)
      } else {
        newTree = addLeafToTree(latestTree, rendererTabId, containerSize.width, containerSize.height)
      }

      setTileTree(newTree)

      addTab({
        serverId,
        id: rendererTabId,
        authorityTabId: ptyId,
        projectPath,
        agentSessionId: ptyId,
        sessionId: undefined,
        title,
        ptyId,
        backend: effectiveBackend
      })
    } catch (e: any) {
      console.error('Failed to spawn PTY:', e)
      const errorMsg = e?.message || String(e)
      alert(`Failed to start ${effectiveBackend} session:\n\n${errorMsg}\n\nPlease make sure the ${effectiveBackend} harness is installed, then try again.`)
    }
  }, [api, addTab, projects, openTabs, settings?.backend, setTileTree])

  const handleAddTabToTile = useCallback(async (projectPath: string, tileId: string, backend?: string) => {
    const project = projects.find((p) => p.serverId === serverId && p.path === projectPath)
    const effectiveBackend = (backend && backend !== 'default'
      ? backend
      : (project?.backend && project.backend !== 'default'
        ? project.backend
        : (settings?.backend && settings.backend !== 'default'
          ? settings.backend
          : 'claude'))) as BackendId
    const projectName = projectPath.split(/[/\\]/).pop() || projectPath
    const title = `${projectName} - New`

    try {
      await api.ttsInstallInstructions?.(projectPath, effectiveBackend)
      const ptyId = await api.spawnPty(projectPath, undefined, undefined, effectiveBackend)
      const rendererTabId = serverResourceKey(serverId, ptyId)

      const currentTree = tileTreeRef.current
      if (currentTree) {
        const newTree = addTabToLeaf(currentTree, tileId, rendererTabId)
        setTileTree(newTree)
      }

      addTab({
        serverId,
        id: rendererTabId,
        authorityTabId: ptyId,
        projectPath,
        agentSessionId: ptyId,
        sessionId: undefined,
        title,
        ptyId,
        backend: effectiveBackend
      })
    } catch (e: any) {
      console.error('Failed to spawn PTY:', e)
      const errorMsg = e?.message || String(e)
      alert(`Failed to start ${effectiveBackend} session:\n\n${errorMsg}\n\nPlease make sure the ${effectiveBackend} harness is installed, then try again.`)
    }
  }, [api, addTab, projects, settings?.backend, setTileTree])

  const handleCloseTab = useCallback((tabId: string) => {
    const tab = openTabs.find(t => t.id === tabId)
    if (tab) {
      closedTabsRef.current.push({
        serverId: tab.serverId,
        projectPath: tab.projectPath,
        agentSessionId: tab.agentSessionId || tab.sessionId || tab.id,
        sessionId: tab.sessionId,
        title: tab.title,
        backend: tab.backend
      })
      setClosedTabCount(closedTabsRef.current.length)
    }

    // Remove from tree
    const currentTree = tileTreeRef.current
    if (currentTree) {
      const newTree = removeTabFromLeaf(currentTree, tabId)
      setTileTree(newTree)
    }

    const tabApi = tab ? getApiForServer(tab.serverId) : undefined
    if (!tabApi) throw new Error(`Server ${tab?.serverId || serverId} is disconnected`)
    tabApi.killPty(tab?.ptyId || tab?.authorityTabId || tabId)
    clearTerminalBuffer(tabId)
    removeTab(tabId)
  }, [api, openTabs, removeTab, setTileTree])

  const handleCloseProjectTabs = useCallback((projectPath: string) => {
    const tabsToClose = openTabs.filter(tab => tab.serverId === serverId && tab.projectPath === projectPath)
    let currentTree = tileTreeRef.current
    for (const tab of tabsToClose) {
      closedTabsRef.current.push({
        serverId: tab.serverId,
        projectPath: tab.projectPath,
        agentSessionId: tab.agentSessionId || tab.sessionId || tab.id,
        sessionId: tab.sessionId,
        title: tab.title,
        backend: tab.backend
      })
      if (currentTree) {
        currentTree = removeTabFromLeaf(currentTree, tab.id)
      }
      const tabApi = getApiForServer(tab.serverId)
      if (!tabApi) throw new Error(`Server ${tab.serverId} is disconnected`)
      tabApi.killPty(tab.ptyId || tab.authorityTabId || tab.id)
      clearTerminalBuffer(tab.id)
      removeTab(tab.id)
    }
    setTileTree(currentTree)
    setClosedTabCount(closedTabsRef.current.length)
  }, [api, openTabs, removeTab, setTileTree])

  const handleProjectCreated = useCallback((projectPath: string, projectName: string) => {
    addProject({ serverId, path: projectPath, name: projectName })
    handleOpenSession(projectPath)
  }, [addProject, handleOpenSession])

  const handleUndoCloseTab = useCallback(() => {
    const info = closedTabsRef.current.pop()
    if (!info) return
    setClosedTabCount(closedTabsRef.current.length)
    handleOpenSession(info.projectPath, {
      serverId: info.serverId,
      agentSessionId: info.agentSessionId,
      sessionId: info.sessionId,
    })
  }, [handleOpenSession])

  return {
    handleAddProject,
    handleAddProjectsFromParent,
    handleOpenSession,
    handleOpenSessionAtPosition,
    handleAddTabToTile,
    handleCloseTab,
    handleCloseProjectTabs,
    handleProjectCreated,
    handleUndoCloseTab,
    canUndoCloseTab: closedTabCount > 0
  }
}
