import { useEffect, useRef, useState, useCallback } from 'react'
import type { Api } from '../api'
import type { BackendId } from '../api/types'
import type { AppSettings } from './useSettings'
import { useWorkspaceStore } from '../stores/workspace'
import { Theme, getThemeById, applyTheme, themes } from '../themes'
import { cleanupOrphanedBuffers } from '../components/terminal/Terminal'

interface UseWorkspaceLoaderOptions {
  api: Api
  checkInstallation: () => Promise<void>
  setViewMode: (mode: 'tabs' | 'tiled') => void
  setTileLayout: (layout: any[]) => void
}

interface UseWorkspaceLoaderReturn {
  loading: boolean
  currentTheme: Theme
  settings: AppSettings | null
  setCurrentTheme: (theme: Theme) => void
  setSettings: (settings: AppSettings | null) => void
}

export function useWorkspaceLoader({
  api,
  checkInstallation,
  setViewMode,
  setTileLayout
}: UseWorkspaceLoaderOptions): UseWorkspaceLoaderReturn {
  const {
    setProjects,
    setCategories,
    addTab,
    clearTabs
  } = useWorkspaceStore()

  const [loading, setLoading] = useState(true)
  const [currentTheme, setCurrentTheme] = useState<Theme>(themes[0])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const initRef = useRef(false)
  const hadProjectsRef = useRef(false)

  // Load workspace on mount and restore tabs
  useEffect(() => {
    // Prevent double initialization from StrictMode
    if (initRef.current) return
    initRef.current = true

    const loadWorkspace = async () => {
      try {
        // Check if Claude, npm, and git-bash are installed
        await checkInstallation()

        // Load and apply theme with any saved customizations
        const loadedSettings = await api.getSettings()
        setSettings(loadedSettings)
        const theme = getThemeById(loadedSettings.theme || 'default')
        applyTheme(theme, loadedSettings.themeCustomization)
        setCurrentTheme(theme)

        // Kill any existing PTYs from hot reload (but don't clear buffers - they'll be restored)
        const existingTabs = useWorkspaceStore.getState().openTabs
        for (const tab of existingTabs) {
          api.killPty(tab.id)
        }
        clearTabs()

        const workspace = await api.getWorkspace()
        if (workspace.projects) {
          setProjects(workspace.projects)
          if (workspace.projects.length > 0) {
            hadProjectsRef.current = true
          }
          // Install TTS instructions for all existing projects
          for (const project of workspace.projects) {
            await api.ttsInstallInstructions?.(project.path)
          }
        }
        // Load categories
        if (workspace.categories) {
          setCategories(workspace.categories)
        }

        // Restore previously open tabs (only if not already open)
        // Track old ID -> new ID mapping for layout restoration
        const idMapping = new Map<string, string>()

        if (workspace.openTabs && workspace.openTabs.length > 0) {
          const currentTabs = useWorkspaceStore.getState().openTabs
          const usedSessionIds = new Set(currentTabs.map(t => t.sessionId).filter(Boolean))
          const sessionsCache = new Map<string, { list: { sessionId: string; slug: string }[]; nextIndex: number }>()

          for (const savedTab of workspace.openTabs) {
            try {
              // Always install TTS instructions so Claude uses <tts> tags
              await api.ttsInstallInstructions?.(savedTab.projectPath)

              const projectName = savedTab.projectPath.split(/[/\\]/).pop() || savedTab.projectPath
              let titleToRestore = savedTab.title || `${projectName} - New`

              // Get project and determine effective backend for restored tab
              const projectForTab = workspace.projects?.find((p: { path: string }) => p.path === savedTab.projectPath)
              const savedBackend = savedTab.backend
              const effectiveBackendForTab = (savedBackend
                || (projectForTab?.backend && projectForTab.backend !== 'default'
                  ? projectForTab.backend
                  : (loadedSettings?.backend && loadedSettings.backend !== 'default'
                    ? loadedSettings.backend
                    : 'claude'))) as BackendId

              let sessionIdToRestore: string | undefined = savedTab.sessionId

              // Always discover sessions to find the most recent one
              let sessionsForProject = sessionsCache.get(savedTab.projectPath)
              if (!sessionsForProject) {
                const list = await api.discoverSessions(savedTab.projectPath, effectiveBackendForTab)
                sessionsForProject = { list, nextIndex: 0 }
                sessionsCache.set(savedTab.projectPath, sessionsForProject)
              }

              const list = sessionsForProject.list || []
              for (let i = sessionsForProject.nextIndex; i < list.length; i++) {
                const candidate = list[i]
                if (!usedSessionIds.has(candidate.sessionId)) {
                  sessionIdToRestore = candidate.sessionId
                  titleToRestore = `${projectName} - ${candidate.slug}`
                  sessionsForProject.nextIndex = i + 1
                  break
                }
              }

              const ptyId = await api.spawnPty(
                savedTab.projectPath,
                sessionIdToRestore,
                undefined,
                effectiveBackendForTab
              )
              if (savedTab.id) {
                idMapping.set(savedTab.id, ptyId)
              }

              addTab({
                id: ptyId,
                projectPath: savedTab.projectPath,
                sessionId: sessionIdToRestore,
                title: titleToRestore,
                ptyId,
                backend: effectiveBackendForTab
              })
              if (sessionIdToRestore) {
                usedSessionIds.add(sessionIdToRestore)
              }
            } catch (e) {
              console.error('Failed to restore tab:', savedTab.projectPath, e)
            }
          }
        }

        // Clean up orphaned terminal buffers from previous session/HMR
        const activeTabIds = useWorkspaceStore.getState().openTabs.map(t => t.id)
        cleanupOrphanedBuffers(activeTabIds)

        // Restore view mode
        if (workspace.viewMode) {
          setViewMode(workspace.viewMode)
        }
        // Restore tileLayout with mapped IDs and migrate legacy format
        if (workspace.tileLayout && workspace.tileLayout.length > 0 && idMapping.size > 0) {
          const mappedLayout = workspace.tileLayout
            .map(tile => {
              // Migrate legacy tiles: add tabIds/activeTabId if missing
              const tabIds = tile.tabIds || [tile.id]
              const mappedTabIds = tabIds
                .map(id => idMapping.get(id) || id)
                .filter(id => {
                  // Only keep tab IDs that exist in the current session
                  const currentTabs = useWorkspaceStore.getState().openTabs
                  return currentTabs.some(t => t.id === id)
                })

              if (mappedTabIds.length === 0) return null

              const newId = idMapping.get(tile.id) || mappedTabIds[0]
              const activeTabId = tile.activeTabId
                ? (idMapping.get(tile.activeTabId) || mappedTabIds[0])
                : mappedTabIds[0]

              return {
                ...tile,
                id: newId,
                tabIds: mappedTabIds,
                activeTabId
              }
            })
            .filter((tile): tile is NonNullable<typeof tile> => tile !== null)

          if (mappedLayout.length > 0) {
            setTileLayout(mappedLayout)
          }
        }
      } catch (e) {
        console.error('Failed to load workspace:', e)
      }
      setLoading(false)
    }
    loadWorkspace()
  }, [api, addTab, clearTabs, checkInstallation, setProjects, setCategories, setViewMode, setTileLayout])

  return {
    loading,
    currentTheme,
    settings,
    setCurrentTheme,
    setSettings
  }
}
