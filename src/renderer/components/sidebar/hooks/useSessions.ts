import { useState, useEffect, useCallback, useRef } from 'react'
import { Project } from '../../../stores/workspace.js'
import { OpenTab, ClaudeSession } from '../types.js'
import type { BackendId, Session } from '../../../api/types'
import type { OpenSessionOptions } from '../../../hooks/useProjectHandlers.js'

interface UseSessionsOptions {
  projects: Project[]
  openTabs: OpenTab[]
  onOpenSession: (
    projectPath: string,
    options?: OpenSessionOptions
  ) => void
  onSwitchToTab: (tabId: string) => void
  /**
   * Resolves the API for a project's origin server. Session discovery must run
   * against the connected server (remote or local), not the local Electron
   * bridge, or remote sessions never appear in the sidebar list.
   */
  getApiForServer?: (serverId: string) => { discoverSessions: (projectPath: string, backend?: BackendId) => Promise<Session[]> } | null | undefined
  /** Global default harness from settings; used when neither the dropdown nor the project sets one. */
  defaultHarnessId?: string
}

interface UseSessionsReturn {
  expandedProject: string | null
  setExpandedProject: React.Dispatch<React.SetStateAction<string | null>>
  sessions: Record<string, ClaudeSession[]>
  toggleProject: (e: React.MouseEvent, path: string) => void
  openMostRecentSession: (projectPath: string) => Promise<void>
  handleOpenSession: (
    projectPath: string,
    options?: OpenSessionOptions
  ) => void
  /** Per-project harness chosen in the sidebar launch options. */
  harnessByProject: Record<string, string>
  setHarnessForProject: (projectPath: string, harnessId: string) => void
  /** Effective harness for a project: dropdown selection → project → global default → claude. */
  getEffectiveHarness: (projectPath: string) => string
}

export function useSessions({
  projects,
  openTabs,
  onOpenSession,
  onSwitchToTab,
  getApiForServer,
  defaultHarnessId,
}: UseSessionsOptions): UseSessionsReturn {
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Record<string, ClaudeSession[]>>({})
  const [harnessByProject, setHarnessByProject] = useState<Record<string, string>>({})

  const getEffectiveHarness = useCallback((projectPath: string): BackendId => {
    const project = projects.find((item) => item.path === projectPath)
    return (harnessByProject[projectPath]
      || (project?.backend && project.backend !== 'default' ? project.backend : null)
      || (defaultHarnessId && defaultHarnessId !== 'default' ? defaultHarnessId : null)
      || 'claude') as BackendId
  }, [projects, harnessByProject, defaultHarnessId])

  const setHarnessForProject = useCallback((projectPath: string, harnessId: string) => {
    setHarnessByProject((prev) => ({ ...prev, [projectPath]: harnessId }))
  }, [])

  // Load sessions when a project is expanded. Discovery runs against the
  // project's origin server API for the effective harness so remote servers
  // and non-claude harnesses show their sessions.
  useEffect(() => {
    async function loadSessions(): Promise<void> {
      if (expandedProject) {
        try {
          const project = projects.find((item) => item.path === expandedProject)
          const backend = getEffectiveHarness(expandedProject) as BackendId
          const serverApi = project ? getApiForServer?.(project.serverId) : null
          const projectSessions = serverApi?.discoverSessions
            ? (await serverApi.discoverSessions(expandedProject, backend)) as ClaudeSession[]
            : (await window.electronAPI?.discoverSessions(
              expandedProject,
              backend
            )) as ClaudeSession[] | undefined
          setSessions((prev) => ({ ...prev, [expandedProject]: projectSessions ?? [] }))
        } catch (e) {
          console.error('Failed to discover sessions:', e)
        }
      }
    }
    loadSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedProject, projects, getEffectiveHarness])

  const toggleProject = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    setExpandedProject((prev) => (prev === path ? null : path))
  }, [])

  const openMostRecentSession = useCallback(
    async (projectPath: string) => {
      const existingTab = openTabs.find((tab) => tab.projectPath === projectPath)
      const project = projects.find((item) => item.path === projectPath)
      const effectiveBackend = getEffectiveHarness(projectPath)

      if (existingTab) {
        onSwitchToTab(existingTab.id)
        return
      }

      const backend = (effectiveBackend || 'claude') as BackendId
      let projectSessions = sessions[projectPath]

      if (!projectSessions) {
        try {
          const serverApi = project ? getApiForServer?.(project.serverId) : null
          projectSessions = serverApi?.discoverSessions
            ? (await serverApi.discoverSessions(projectPath, backend)) as ClaudeSession[]
            : ((await window.electronAPI?.discoverSessions(projectPath, backend)) as ClaudeSession[] | undefined) ?? []
          setSessions((prev) => ({ ...prev, [projectPath]: projectSessions! }))
        } catch (e) {
          console.error('Failed to discover sessions:', e)
          projectSessions = []
        }
      }

      if (projectSessions.length > 0) {
        const mostRecent = projectSessions[0]
        onOpenSession(projectPath, {
          sessionId: mostRecent.sessionId,
          slug: mostRecent.slug,
          resumeCwd: mostRecent.cwd,
        })
      } else {
        onOpenSession(projectPath, { forceNewSession: true, harnessId: effectiveBackend as OpenSessionOptions['harnessId'] })
      }
    },
    [openTabs, projects, sessions, onSwitchToTab, onOpenSession, getApiForServer, getEffectiveHarness]
  )

  const handleOpenSession = useCallback(
    (projectPath: string, options: OpenSessionOptions = {}) => {
      const { sessionId, slug, forceNewSession, resumeCwd, harnessId } = options
      if (sessionId) {
        const discoveredCwd = resumeCwd ?? sessions[projectPath]?.find(session => session.sessionId === sessionId)?.cwd
        onOpenSession(projectPath, { sessionId, slug, resumeCwd: discoveredCwd, harnessId })
      } else if (forceNewSession) {
        // Explicit "New Session" click - always create a new session
        onOpenSession(projectPath, { forceNewSession: true, harnessId })
      } else {
        openMostRecentSession(projectPath)
      }
    },
    [onOpenSession, openMostRecentSession, sessions]
  )

  return {
    expandedProject,
    setExpandedProject,
    sessions,
    toggleProject,
    openMostRecentSession,
    handleOpenSession,
    harnessByProject,
    setHarnessForProject,
    getEffectiveHarness,
  }
}
