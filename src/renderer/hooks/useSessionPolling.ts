import { useEffect } from 'react'
import type { Api } from '../api'
import type { BackendId } from '../api/types'
import type { OpenTab } from '../stores/workspace'

interface UseSessionPollingOptions {
  api: Api
  openTabs: OpenTab[]
  updateTab: (id: string, updates: Partial<OpenTab>) => void
}

export function useSessionPolling({ api, openTabs, updateTab }: UseSessionPollingOptions): void {
  // Poll for session IDs - update tabs without sessions and detect when sessions change (e.g., after /clear)
  // Uses 30s interval to reduce IPC overhead, only polls tabs that need session discovery
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      if (openTabs.length === 0) return

      // Only poll tabs that don't have a session yet (reduces unnecessary IPC calls)
      const tabsNeedingSession = openTabs.filter(tab => !tab.sessionId)
      if (tabsNeedingSession.length === 0) return

      // Run discovery in parallel for tabs needing sessions (async so non-blocking)
      try {
        await Promise.all(tabsNeedingSession.map(async (tab) => {
          try {
            const effectiveBackend = (tab.backend || 'claude') as BackendId
            const sessions = await api.discoverSessions(tab.projectPath, effectiveBackend)

            if (sessions.length > 0) {
              const mostRecent = sessions[0]

              // Check if we already have this session in another tab
              const alreadyOpen = openTabs.some((t) => t.id !== tab.id && t.sessionId === mostRecent.sessionId)
              if (!alreadyOpen) {
                const projectName = tab.projectPath.split(/[/\\]/).pop() || tab.projectPath
                updateTab(tab.id, {
                  sessionId: mostRecent.sessionId,
                  title: `${projectName} - ${mostRecent.slug}`
                })
              }
            }
          } catch (e) {
            console.error('Failed to discover sessions for tab:', e)
          }
        }))
      } catch (e) {
        console.error('Session discovery polling error:', e)
      }
    }, 30000) // Poll every 30 seconds

    return () => clearInterval(pollInterval)
  }, [api, openTabs, updateTab])
}
