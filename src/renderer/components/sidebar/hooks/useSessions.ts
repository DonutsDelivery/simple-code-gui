import { useState, useEffect, useCallback, useRef } from 'react'
import { Project } from '../../../stores/workspace.js'
import { ClaudeSession, OpenTab } from '../types.js'

interface UseSessionsOptions {
  projects: Project[]
  openTabs: OpenTab[]
  onOpenSession: (
    projectPath: string,
    sessionId?: string,
    slug?: string,
    initialPrompt?: string,
    forceNewSession?: boolean
  ) => void
  onSwitchToTab: (tabId: string) => void
}

interface UseSessionsReturn {
  expandedProject: string | null
  setExpandedProject: React.Dispatch<React.SetStateAction<string | null>>
  sessions: Record<string, ClaudeSession[]>
  toggleProject: (e: React.MouseEvent, path: string) => void
  openMostRecentSession: (projectPath: string) => Promise<void>
  handleOpenSession: (
    projectPath: string,
    sessionId?: string,
    slug?: string,
    isNewSession?: boolean
  ) => void
}

export function useSessions({
  projects,
  openTabs,
  onOpenSession,
  onSwitchToTab,
}: UseSessionsOptions): UseSessionsReturn {
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Record<string, ClaudeSession[]>>({})

  // Load sessions when a project is expanded
  useEffect(() => {
    async function loadSessions(): Promise<void> {
      if (expandedProject) {
        try {
          const project = projects.find((item) => item.path === expandedProject)
          const backend = project?.backend === 'opencode' ? 'opencode' : 'claude'
          const projectSessions = await window.electronAPI?.discoverSessions(
            expandedProject,
            backend
          )
          setSessions((prev) => ({ ...prev, [expandedProject]: projectSessions }))
        } catch (e) {
          console.error('Failed to discover sessions:', e)
        }
      }
    }
    loadSessions()
  }, [expandedProject, projects])

  const toggleProject = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    setExpandedProject((prev) => (prev === path ? null : path))
  }, [])

  const openMostRecentSession = useCallback(
    async (projectPath: string) => {
      const existingTab = openTabs.find((tab) => tab.projectPath === projectPath)
      const project = projects.find((item) => item.path === projectPath)
      const effectiveBackend =
        project?.backend && project.backend !== 'default' ? project.backend : 'claude'

      if (existingTab) {
        onSwitchToTab(existingTab.id)
        return
      }

      const backend = effectiveBackend === 'opencode' ? 'opencode' : 'claude'
      let projectSessions = sessions[projectPath]

      if (!projectSessions) {
        try {
          projectSessions = await window.electronAPI?.discoverSessions(projectPath, backend)
          setSessions((prev) => ({ ...prev, [projectPath]: projectSessions }))
        } catch (e) {
          console.error('Failed to discover sessions:', e)
          projectSessions = []
        }
      }

      if (projectSessions && projectSessions.length > 0) {
        const mostRecent = projectSessions[0]
        onOpenSession(projectPath, mostRecent.sessionId, mostRecent.slug)
      } else {
        onOpenSession(projectPath, undefined, undefined, undefined, false)
      }
    },
    [openTabs, projects, sessions, onSwitchToTab, onOpenSession]
  )

  const handleOpenSession = useCallback(
    (projectPath: string, sessionId?: string, slug?: string, isNewSession?: boolean) => {
      if (sessionId) {
        onOpenSession(projectPath, sessionId, slug)
      } else if (isNewSession) {
        // Explicit "New Session" click - always create a new session
        onOpenSession(projectPath, undefined, undefined, undefined, true)
      } else {
        openMostRecentSession(projectPath)
      }
    },
    [onOpenSession, openMostRecentSession]
  )

  return {
    expandedProject,
    setExpandedProject,
    sessions,
    toggleProject,
    openMostRecentSession,
    handleOpenSession,
  }
}
