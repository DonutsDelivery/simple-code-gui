import { useEffect } from 'react'
import type { Api } from '../api'
import { getApi } from '../api'
import type { BackendId } from '../api/types'
import type { OpenTab } from '../stores/workspace'

interface UseSessionPollingOptions {
  api: Api
  projects: { path: string }[]
  openTabs: OpenTab[]
  updateTab: (id: string, updates: Partial<OpenTab>) => void
}

export function useSessionPolling({ api, projects, openTabs, updateTab }: UseSessionPollingOptions): void {
  // A running PTY is authoritative for its own conversation identity. Hermes
  // can switch that identity from inside the TUI with /resume, so copy it into
  // workspace state promptly instead of waiting for filesystem discovery.
  useEffect(() => {
    const syncLiveSessionIds = async () => {
      if (openTabs.length === 0) return
      try {
        const livePtys = await api.listPtys()
        const liveById = new Map(livePtys.map(pty => [pty.id, pty]))
        for (const tab of openTabs) {
          const live = liveById.get(tab.ptyId)
          if (live?.sessionId && live.sessionId !== tab.sessionId) {
            updateTab(tab.id, { sessionId: live.sessionId })
          }
        }
      } catch (e) {
        console.error('Failed to synchronize live PTY session IDs:', e)
      }
    }

    void syncLiveSessionIds()
    // Poll slowly: the backend rate-limits API reads to 60/min per client
    // (default endpoint budget). A 1s poll would consume the entire budget by
    // itself and starve other requests (workspace saves, session discovery),
    // which then 429 and let the authoritative snapshot revert local changes.
    // 5s keeps /resume detection responsive at 12 req/min with room to spare.
    const interval = setInterval(syncLiveSessionIds, 5000)
    return () => clearInterval(interval)
  }, [api, openTabs, updateTab])

  // Poll for session IDs — two goals:
  // 1. Assign a session to tabs that don't have one yet.
  // 2. Detect when a session changes under a tab (e.g. /reset inside Claude, or the
  //    meta-project orchestrator spawning a new session) so workspace.json stays in sync.
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      if (openTabs.length === 0) return

      // Build the set of session IDs currently claimed by open tabs so we don't
      // assign the same session to two different tabs.
      const claimedSessions = new Set(openTabs.filter(t => t.sessionId).map(t => t.sessionId!))
      const sessionDiscoveryCache = new Map<string, Awaited<ReturnType<Api['discoverSessions']>>>()

      const discoverSessionsForTab = async (tab: OpenTab, effectiveBackend: BackendId) => {
        const key = `${effectiveBackend}\0${tab.projectPath}`
        const cached = sessionDiscoveryCache.get(key)
        if (cached) return cached

        // Discover on the tab's ORIGIN server, not the active one — a tab may
        // live on a paired remote server while another server is active.
        const originApi = tab.serverId ? getApi(tab.serverId) : null
        const tabApi = originApi ?? api
        const sessions = await tabApi.discoverSessions(tab.projectPath, effectiveBackend)
        sessionDiscoveryCache.set(key, sessions)
        return sessions
      }

      try {
        await Promise.all(openTabs.map(async (tab) => {
          try {
            const effectiveBackend = (tab.backend || 'claude') as BackendId
            const discovered = await discoverSessionsForTab(tab, effectiveBackend)
            const tabCwd = tab.projectPath.replace(/[/\\]+$/, '')
            const sessions = discovered.filter(session =>
              (session.cwd || tab.projectPath).replace(/[/\\]+$/, '') === tabCwd
            )
            if (sessions.length === 0) return

            const mostRecent = sessions[0]
            const projectName = tab.projectPath.split(/[/\\]/).pop() || tab.projectPath

            if (!tab.sessionId) {
              // Tab has no session yet — assign the most recent unclaimed one.
              const alreadyOpen = openTabs.some((t) => t.id !== tab.id && t.sessionId === mostRecent.sessionId)
              if (!alreadyOpen) {
                const updates: Partial<import('../stores/workspace').OpenTab> = { sessionId: mostRecent.sessionId }
                if (!tab.customTitle) updates.title = `${projectName} - ${mostRecent.slug}`
                updateTab(tab.id, updates)
              }
            } else if (effectiveBackend !== 'hermes' && !sessions.some(session => session.sessionId === tab.sessionId)) {
              const alreadyOpen = openTabs.some((t) => t.id !== tab.id && t.sessionId === mostRecent.sessionId)
              if (!alreadyOpen) {
                const updates: Partial<import('../stores/workspace').OpenTab> = { sessionId: mostRecent.sessionId }
                if (!tab.customTitle) updates.title = `${projectName} - ${mostRecent.slug}`
                updateTab(tab.id, updates)
                claimedSessions.add(mostRecent.sessionId)
                claimedSessions.delete(tab.sessionId)
              }
            } else if (effectiveBackend !== 'hermes' && mostRecent.sessionId !== tab.sessionId && !claimedSessions.has(mostRecent.sessionId)) {
              // Tab has a session but a newer one has appeared (e.g. /reset, external spawn).
              // Only update for projects NOT in workspace.projects (e.g. the meta-project);
              // for registered projects, the user may have deliberately chosen an older session.
              const isRegistered = projects.some(p => p.path === tab.projectPath)
              if (!isRegistered) {
                const updates: Partial<import('../stores/workspace').OpenTab> = { sessionId: mostRecent.sessionId }
                if (!tab.customTitle) updates.title = `${projectName} - ${mostRecent.slug}`
                updateTab(tab.id, updates)
                claimedSessions.add(mostRecent.sessionId)
                claimedSessions.delete(tab.sessionId)
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
  }, [api, projects, openTabs, updateTab])
}
