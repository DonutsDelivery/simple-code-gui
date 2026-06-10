import { useEffect } from 'react'
import type { Api } from '../api'
import type { BackendId } from '../api/types'
import type { OpenTab } from '../stores/workspace'

interface UseSessionPollingOptions {
  api: Api
  projects: { path: string }[]
  openTabs: OpenTab[]
  updateTab: (id: string, updates: Partial<OpenTab>) => void
}

export function useSessionPolling({ api, projects, openTabs, updateTab }: UseSessionPollingOptions): void {
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

      const discoverSessionsForTab = async (tab: OpenTab) => {
        const effectiveBackend = (tab.backend || 'claude') as BackendId
        const key = `${effectiveBackend}\0${tab.projectPath}`
        const cached = sessionDiscoveryCache.get(key)
        if (cached) return cached

        const sessions = await api.discoverSessions(tab.projectPath, effectiveBackend)
        sessionDiscoveryCache.set(key, sessions)
        return sessions
      }

      try {
        await Promise.all(openTabs.map(async (tab) => {
          try {
            const sessions = await discoverSessionsForTab(tab)
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
            } else if (!sessions.some(session => session.sessionId === tab.sessionId)) {
              const alreadyOpen = openTabs.some((t) => t.id !== tab.id && t.sessionId === mostRecent.sessionId)
              if (!alreadyOpen) {
                const updates: Partial<import('../stores/workspace').OpenTab> = { sessionId: mostRecent.sessionId }
                if (!tab.customTitle) updates.title = `${projectName} - ${mostRecent.slug}`
                updateTab(tab.id, updates)
                claimedSessions.add(mostRecent.sessionId)
                claimedSessions.delete(tab.sessionId)
              }
            } else if (mostRecent.sessionId !== tab.sessionId && !claimedSessions.has(mostRecent.sessionId)) {
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
