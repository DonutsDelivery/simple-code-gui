import { useEffect, useRef } from 'react'
import type { Api } from '../api'
import type { BackendId } from '../api/types'
import type { AppSettings } from './useSettings'
import type { TileNode } from '../components/tile-tree'
import {
  createLeaf,
  splitLeaf,
  addTabToLeaf,
  findLeafById,
  generateTileId,
} from '../components/tile-tree'
import { useWorkspaceStore, OpenTab, Project } from '../stores/workspace'

function replaceTabIdInTree(node: TileNode, oldId: string, newId: string): TileNode {
  if (node.type === 'leaf') {
    const idx = node.tabIds.indexOf(oldId)
    if (idx === -1) return node
    const tabIds = [...node.tabIds]
    tabIds[idx] = newId
    return {
      ...node,
      tabIds,
      activeTabId: node.activeTabId === oldId ? newId : node.activeTabId
    }
  }
  const children = node.children.map(c => replaceTabIdInTree(c, oldId, newId))
  return { ...node, children }
}

interface UseApiListenersOptions {
  api: Api
  projects: Project[]
  settings: AppSettings | null
  addTab: (tab: OpenTab) => void
  updateTab: (id: string, updates: Partial<OpenTab>) => void
  setActiveTab: (id: string) => void
  tileTree: TileNode | null
  setTileTree: (tree: TileNode | null) => void
  openTabs: OpenTab[]
}

export function useApiListeners({
  api,
  projects,
  settings,
  addTab,
  updateTab,
  setActiveTab,
  tileTree,
  setTileTree,
  openTabs
}: UseApiListenersOptions): void {
  // Listen for API requests to open new sessions
  useEffect(() => {
    const unsubscribe = api.onApiOpenSession(async ({ projectPath, autoClose, model }: { projectPath: string; autoClose?: boolean; model?: string }) => {
      // Open a new session for this project (API-triggered)
      const modelLabel = model && model !== 'default' ? ` [${model}]` : ''
      const title = `${projectPath.split(/[/\\]/).pop() || projectPath} - API${modelLabel}${autoClose ? ' (auto-close)' : ''}`

      // Get project and determine effective backend
      const project = projects.find((p) => p.path === projectPath)

      const effectiveBackend = (project?.backend && project.backend !== 'default'
        ? project.backend
        : (settings?.backend && settings.backend !== 'default'
          ? settings.backend
          : 'claude')) as BackendId

      try {
        // Install TTS instructions in the backend's instruction file
        await api.ttsInstallInstructions?.(projectPath, effectiveBackend)

        const ptyId = await api.spawnPty(projectPath, undefined, model, effectiveBackend)
        addTab({
          id: ptyId,
          projectPath,
          title,
          ptyId,
          backend: effectiveBackend
        })
      } catch (e: any) {
        console.error('Failed to spawn PTY for API request:', e)
      }
    })

    return unsubscribe
  }, [api, addTab, projects, settings?.backend])

  // Listen for orchestrator-created sessions (MCP create_session tool)
  useEffect(() => {
    const unsubscribe = api.onOrchestratorSessionCreated(({ ptyId, projectPath, backend, workspaceId, tileId, placement }) => {
      const alreadyOpen = openTabs.some(t => t.id === ptyId)
      if (alreadyOpen) return

      // Switch workspace if requested and different from active
      if (workspaceId) {
        const state = useWorkspaceStore.getState()
        if (workspaceId !== state.activeSessionId) {
          state.switchSession(workspaceId)
        }
      }

      const projectName = projectPath.split(/[/\\]/).pop() || projectPath
      const title = `${projectName} - Orchestrator`

      addTab({
        id: ptyId,
        projectPath,
        title,
        ptyId,
        backend: backend as BackendId
      })

      // Read fresh tile tree after potential workspace switch
      const tree = tileTreeRef.current
      if (!tree) return

      if (placement === 'sub-tab' && tileId) {
        const leaf = findLeafById(tree, tileId)
        if (leaf) {
          setTileTree(addTabToLeaf(tree, leaf.id, ptyId))
          return
        }
      }

      if (placement && placement.startsWith('split-') && tileId) {
        const dirMap: Record<string, { dir: 'horizontal' | 'vertical'; pos: 'before' | 'after' }> = {
          'split-left': { dir: 'horizontal', pos: 'before' },
          'split-right': { dir: 'horizontal', pos: 'after' },
          'split-top': { dir: 'vertical', pos: 'before' },
          'split-bottom': { dir: 'vertical', pos: 'after' },
        }
        const dirInfo = dirMap[placement]
        if (dirInfo && findLeafById(tree, tileId)) {
          const newLeaf = createLeaf(generateTileId(), [ptyId], ptyId)
          setTileTree(splitLeaf(tree, tileId, dirInfo.dir, newLeaf, dirInfo.pos))
          return
        }
      }
    })

    return unsubscribe
  }, [api, addTab, openTabs, setTileTree])

  // Keep ref fresh so orchestrator callback always reads latest tree
  const tileTreeRef = useRef(tileTree)
  tileTreeRef.current = tileTree

  // Listen for PTY recreation events
  useEffect(() => {
    const unsubscribe = api.onPtyRecreated(({ oldId, newId, backend, sessionId }) => {
      console.log(`PTY recreated: ${oldId} -> ${newId} with backend ${backend}`)
      // Find the tab with the old ID
      const tab = useWorkspaceStore.getState().openTabs.find((t) => t.id === oldId)
      if (tab) {
        // Update the tab with the new ID and backend
        updateTab(oldId, { id: newId, ptyId: newId, backend, sessionId })
        // Update tile tree so tabIds stay in sync
        if (tileTree) {
          setTileTree(replaceTabIdInTree(tileTree, oldId, newId))
        }
        // If it was the active tab, update the active tab ID
        if (useWorkspaceStore.getState().activeTabId === oldId) {
          setActiveTab(newId)
        }
      }
    })
    return unsubscribe
  }, [api, updateTab, setActiveTab, tileTree, setTileTree])
}
