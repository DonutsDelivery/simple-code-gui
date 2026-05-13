import { useEffect, useRef, useState, useCallback } from 'react'
import type { Api } from '../api'
import type { BackendId } from '../api/types'
import type { AppSettings } from './useSettings'
import { useWorkspaceStore, WorkspaceSession, OpenTab } from '../stores/workspace'
import { Theme, getThemeById, applyTheme, themes } from '../themes'
import { cleanupOrphanedBuffers } from '../components/terminal/Terminal'
import type { TileNode } from '../components/tile-tree.js'
import {
  deserializeTree,
  migrateFromFlat,
  remapTabIds,
  filterTabs,
  getAllTabIds,
  createLeaf,
  createBranch,
  generateTileId,
} from '../components/tile-tree.js'

interface UseWorkspaceLoaderOptions {
  api: Api
  checkInstallation: () => Promise<void>
}

interface UseWorkspaceLoaderReturn {
  loading: boolean
  currentTheme: Theme
  settings: AppSettings | null
  setCurrentTheme: (theme: Theme) => void
  setSettings: (settings: AppSettings | null) => void
  restoreSession: (sessionId: string) => Promise<void>
}

async function spawnSessionTabs(
  api: Api,
  savedTabs: any[],
  projects: any[],
  settings: AppSettings | null,
  onAddTab: (tab: OpenTab, idMapping: Map<string, string>) => void
): Promise<{ idMapping: Map<string, string>; restoredTabs: OpenTab[] }> {
  const idMapping = new Map<string, string>()
  const restoredTabs: OpenTab[] = []

  const usedSessionIds = new Set<string>()
  const sessionsCache = new Map<string, { list: { sessionId: string; slug: string }[]; nextIndex: number }>()

  for (const savedTab of savedTabs) {
    try {
      const projectName = savedTab.projectPath.split(/[/\\]/).pop() || savedTab.projectPath
      let titleToRestore = savedTab.title || `${projectName} - New`

      const projectForTab = projects?.find((p: { path: string }) => p.path === savedTab.projectPath)
      const savedBackend = savedTab.backend
      const effectiveBackend = (savedBackend
        || (projectForTab?.backend && projectForTab.backend !== 'default'
          ? projectForTab.backend
          : (settings?.backend && settings.backend !== 'default'
            ? settings.backend
            : 'claude'))) as BackendId

      await api.ttsInstallInstructions?.(savedTab.projectPath, effectiveBackend)

      let sessionIdToRestore: string | undefined = savedTab.sessionId

      let sessionsForProject = sessionsCache.get(savedTab.projectPath)
      if (!sessionsForProject) {
        const list = await api.discoverSessions(savedTab.projectPath, effectiveBackend)
        sessionsForProject = { list, nextIndex: 0 }
        sessionsCache.set(savedTab.projectPath, sessionsForProject)
      }

      const list = sessionsForProject.list || []

      // Extract slug from saved title (format: "projectName - slug")
      const savedSlug = savedTab.title?.replace(/^.*?-\s*/, '')?.trim() || ''
      function matchBySlug(): { sessionId: string; slug: string } | null {
        if (!savedSlug) return null
        for (const s of list) {
          if (s.slug === savedSlug && !usedSessionIds.has(s.sessionId)) return s
        }
        return null
      }

      if (savedTab.sessionId) {
        const savedMatch = list.find((s: any) => s.sessionId === savedTab.sessionId)
        // For projects not in workspace.projects (e.g. the meta-project), always prefer
        // the most recently modified session. These projects' sessions can change externally
        // (orchestrator spawning a new session, /reset inside the terminal) without the
        // GUI ever updating the saved sessionId.
        const mostRecent = list.length > 0 && !usedSessionIds.has(list[0].sessionId) ? list[0] : null
        const preferMostRecent = !projectForTab && mostRecent && mostRecent.sessionId !== savedTab.sessionId
        if (preferMostRecent) {
          sessionIdToRestore = mostRecent!.sessionId
          if (!savedTab.customTitle) {
            titleToRestore = `${projectName} - ${mostRecent!.slug}`
          }
          sessionsForProject.nextIndex = 1
        } else if (savedMatch && !usedSessionIds.has(savedMatch.sessionId)) {
          sessionIdToRestore = savedMatch.sessionId
          if (!savedTab.customTitle) {
            titleToRestore = `${projectName} - ${savedMatch.slug}`
          }
        } else {
          // Saved sessionId is stale — try matching by slug from title first,
          // then fall back to next unclaimed session
          const slugMatch = matchBySlug()
          if (slugMatch) {
            sessionIdToRestore = slugMatch.sessionId
            if (!savedTab.customTitle) {
              titleToRestore = `${projectName} - ${slugMatch.slug}`
            }
          } else {
            for (let i = sessionsForProject.nextIndex; i < list.length; i++) {
              const candidate = list[i]
              if (!usedSessionIds.has(candidate.sessionId)) {
                sessionIdToRestore = candidate.sessionId
                if (!savedTab.customTitle) {
                  titleToRestore = `${projectName} - ${candidate.slug}`
                }
                sessionsForProject.nextIndex = i + 1
                break
              }
            }
          }
        }
      } else {
        for (let i = sessionsForProject.nextIndex; i < list.length; i++) {
          const candidate = list[i]
          if (!usedSessionIds.has(candidate.sessionId)) {
            sessionIdToRestore = candidate.sessionId
            if (!savedTab.customTitle) {
              titleToRestore = `${projectName} - ${candidate.slug}`
            }
            sessionsForProject.nextIndex = i + 1
            break
          }
        }
      }

      const ptyId = await api.spawnPty(
        savedTab.projectPath,
        sessionIdToRestore,
        undefined,
        effectiveBackend
      )

      if (savedTab.id) {
        idMapping.set(savedTab.id, ptyId)
      }

      const tab: OpenTab = {
        id: ptyId,
        projectPath: savedTab.projectPath,
        sessionId: sessionIdToRestore,
        title: titleToRestore,
        customTitle: savedTab.customTitle || undefined,
        ptyId,
        backend: effectiveBackend,
      }
      restoredTabs.push(tab)
      onAddTab(tab, idMapping)

      if (sessionIdToRestore) {
        usedSessionIds.add(sessionIdToRestore)
      }
    } catch (e) {
      console.error('Failed to restore tab:', savedTab.projectPath, e)
    }
  }

  return { idMapping, restoredTabs }
}

function buildRestoredTree(
  savedTileTree: any,
  savedTileLayout: any,
  idMapping: Map<string, string>,
  liveTabIds: Set<string>
): TileNode | null {
  let tree: TileNode | null = null

  if (savedTileTree) {
    tree = deserializeTree(savedTileTree)
  } else if (savedTileLayout && savedTileLayout.length > 0) {
    const mappedLayout = savedTileLayout.map((tile: any) => {
      const tabIds = (tile.tabIds || [tile.id]).map((id: string) => idMapping.get(id) || id)
      const newId = idMapping.get(tile.id) || tabIds[0]
      const activeTabId = tile.activeTabId
        ? (idMapping.get(tile.activeTabId) || tabIds[0])
        : tabIds[0]
      return { ...tile, id: newId, tabIds, activeTabId }
    })
    tree = migrateFromFlat(mappedLayout)
  }

  if (tree) {
    tree = remapTabIds(tree, idMapping)
    tree = filterTabs(tree, liveTabIds)
  }

  // Heal orphans — any live tab not in the tree gets appended
  const tabsInTree = tree ? getAllTabIds(tree) : new Set<string>()
  const orphanIds = [...liveTabIds].filter(id => !tabsInTree.has(id))
  if (orphanIds.length > 0) {
    const orphanLeaf = createLeaf(generateTileId(), orphanIds, orphanIds[0])
    tree = tree
      ? createBranch(generateTileId(), 'horizontal', [tree, orphanLeaf])
      : orphanLeaf
  }

  return tree
}

export function useWorkspaceLoader({
  api,
  checkInstallation,
}: UseWorkspaceLoaderOptions): UseWorkspaceLoaderReturn {
  const store = useWorkspaceStore()
  const {
    setProjects,
    setCategories,
    initSessions,
    setSessionSavedData,
    setSessionLiveData,
    markSessionRestored,
    switchSession,
    clearAllTabs,
  } = store

  const [loading, setLoading] = useState(true)
  const [currentTheme, setCurrentTheme] = useState<Theme>(themes[0])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const initRef = useRef(false)
  const settingsRef = useRef<AppSettings | null>(null)
  const projectsRef = useRef<any[]>([])

  const restoreSession = useCallback(async (sessionId: string) => {
    const state = useWorkspaceStore.getState()
    const session = state.sessions.find(s => s.id === sessionId)
    if (!session || session.isRestored) return
    if (!session.savedData) {
      markSessionRestored(sessionId)
      return
    }

    const { savedData } = session

    const restoredTabs: OpenTab[] = []
    const { idMapping } = await spawnSessionTabs(
      api,
      savedData.openTabs,
      projectsRef.current,
      settingsRef.current,
      (tab) => { restoredTabs.push(tab) }
    )

    const liveTabIds = new Set(restoredTabs.map(t => t.id))
    const tree = buildRestoredTree(savedData.tileTree, null, idMapping, liveTabIds)

    const activeTabId = savedData.activeTabId
      ? (idMapping.get(savedData.activeTabId) ?? restoredTabs[0]?.id ?? null)
      : restoredTabs[0]?.id ?? null

    setSessionLiveData(sessionId, restoredTabs, tree, activeTabId)
  }, [api, markSessionRestored, setSessionLiveData])

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    const loadWorkspace = async () => {
      try {
        await checkInstallation()

        const loadedSettings = await api.getSettings()
        setSettings(loadedSettings)
        settingsRef.current = loadedSettings
        const theme = getThemeById(loadedSettings.theme || 'default')
        applyTheme(theme, loadedSettings.themeCustomization)
        setCurrentTheme(theme)

        // Kill any existing PTYs (hot reload cleanup)
        const allExisting = useWorkspaceStore.getState().getAllOpenTabs()
        for (const tab of allExisting) {
          api.killPty(tab.id)
        }
        clearAllTabs()

        const workspace = await api.getWorkspace()

        if (workspace.projects) {
          setProjects(workspace.projects)
          projectsRef.current = workspace.projects
          for (const project of workspace.projects) {
            const projBackend = (project.backend && project.backend !== 'default'
              ? project.backend
              : (loadedSettings?.backend && loadedSettings.backend !== 'default'
                ? loadedSettings.backend
                : 'claude')) as BackendId
            await api.ttsInstallInstructions?.(project.path, projBackend)
          }
        }

        if (workspace.categories) {
          setCategories(workspace.categories)
        }

        // Build session list — migrate legacy format if needed
        let savedSessions: Array<{ id: string; name: string; openTabs: any[]; activeTabId: string | null; tileTree?: any }> = []
        let activeSessionId: string | null = null

        if (workspace.sessions && workspace.sessions.length > 0) {
          savedSessions = workspace.sessions
          activeSessionId = workspace.activeSessionId ?? workspace.sessions[0].id
        } else {
          // Legacy: single session from top-level fields
          const legacyId = `ws-${Date.now()}`
          savedSessions = [{
            id: legacyId,
            name: 'Workspace 1',
            openTabs: workspace.openTabs ?? [],
            activeTabId: workspace.activeTabId ?? null,
            tileTree: workspace.tileTree,
          }]
          activeSessionId = legacyId
        }

        // Build WorkspaceSession objects; set savedData for inactive sessions
        const sessions: WorkspaceSession[] = savedSessions.map(s => ({
          id: s.id,
          name: s.name,
          openTabs: [],
          activeTabId: null,
          activeTileTree: null,
          savedData: {
            openTabs: s.openTabs ?? [],
            tileTree: s.tileTree ?? null,
            activeTabId: s.activeTabId ?? null,
          },
          isRestored: false,
        }))

        initSessions(sessions, activeSessionId)

        // Store savedData for each inactive session
        for (const s of sessions) {
          if (s.id !== activeSessionId) {
            setSessionSavedData(s.id, s.savedData!)
          }
        }

        // Restore the active session eagerly
        const activeSaved = savedSessions.find(s => s.id === activeSessionId)
        if (activeSaved && activeSaved.openTabs.length > 0) {
          const restoredTabs: OpenTab[] = []
          const { idMapping } = await spawnSessionTabs(
            api,
            activeSaved.openTabs,
            workspace.projects ?? [],
            loadedSettings,
            (tab) => { restoredTabs.push(tab) }
          )

          const liveTabIds = new Set(restoredTabs.map(t => t.id))
          const legacyLayout = (workspace.sessions ? undefined : workspace.tileLayout)
          const tree = buildRestoredTree(activeSaved.tileTree, legacyLayout, idMapping, liveTabIds)

          const activeTabId = activeSaved.activeTabId
            ? (idMapping.get(activeSaved.activeTabId) ?? restoredTabs[0]?.id ?? null)
            : restoredTabs[0]?.id ?? null

          setSessionLiveData(activeSessionId!, restoredTabs, tree, activeTabId)
          switchSession(activeSessionId!)
        } else {
          markSessionRestored(activeSessionId!)
        }

        // Clean up orphaned terminal buffers
        const activeTabIds = useWorkspaceStore.getState().openTabs.map(t => t.id)
        cleanupOrphanedBuffers(activeTabIds)
      } catch (e) {
        console.error('Failed to load workspace:', e)
      }
      setLoading(false)
    }

    loadWorkspace()
  }, [api, checkInstallation, clearAllTabs, initSessions, markSessionRestored, setCategories, setProjects, setSessionLiveData, setSessionSavedData, switchSession])

  return {
    loading,
    currentTheme,
    settings,
    setCurrentTheme,
    setSettings,
    restoreSession,
  }
}
