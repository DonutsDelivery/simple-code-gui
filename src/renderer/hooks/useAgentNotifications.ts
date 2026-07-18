import { useEffect, useRef } from 'react'
import type { AgentSessionSignalEvent } from '../../common/agent-session-signal'
import type { Api } from '../api'
import { useWorkspaceStore, type AgentAttentionKind } from '../stores/workspace'
import type { AppSettings } from './useSettings'
import { findTabByPtyId, getActuallyVisibleTabIds, getVisibleTabIds } from '../utils/agentAttention'
import { playAgentNotificationSound } from '../utils/agentNotificationAudio'

interface UseAgentNotificationsOptions {
  api: Api
  settings: AppSettings | null
  isMobile: boolean
}

export function useAgentNotifications({ api, settings, isMobile }: UseAgentNotificationsOptions): void {
  const sessions = useWorkspaceStore(state => state.sessions)
  const activeSessionId = useWorkspaceStore(state => state.activeSessionId)
  const pendingSignals = useRef(new Map<string, AgentSessionSignalEvent>())

  const handleSignal = (event: AgentSessionSignalEvent): boolean => {
    const state = useWorkspaceStore.getState()
    const tabId = findTabByPtyId(state.sessions, event.ptyId)
    if (!tabId) return false

    const kind: AgentAttentionKind = event.type === 'complete' ? 'completed' : 'needs-input'
    if (settings?.notificationSoundsEnabled !== false) {
      playAgentNotificationSound(kind, settings?.notificationVolume ?? 0.65)
    }

    const logical = getVisibleTabIds(state.sessions, state.activeSessionId, isMobile)
    const visible = isMobile ? logical : getActuallyVisibleTabIds(logical)
    if (visible.has(tabId)) state.clearTabAttention(tabId)
    else state.markTabAttention(tabId, kind)
    return true
  }

  useEffect(() => {
    const unsubscribe = api.onAgentSessionSignal((event) => {
      if (!handleSignal(event)) pendingSignals.current.set(event.ptyId, event)
    })
    return () => unsubscribe?.()
  }, [api, isMobile, settings?.notificationSoundsEnabled, settings?.notificationVolume])

  useEffect(() => {
    for (const [ptyId, event] of pendingSignals.current) {
      if (handleSignal(event)) pendingSignals.current.delete(ptyId)
    }

    const clearVisibleAttention = (): void => {
      const logical = getVisibleTabIds(
        useWorkspaceStore.getState().sessions,
        useWorkspaceStore.getState().activeSessionId,
        isMobile,
      )
      const visible = isMobile ? logical : getActuallyVisibleTabIds(logical)
      useWorkspaceStore.getState().clearTabAttentionMany([...visible])
    }

    clearVisibleAttention()
    document.addEventListener('visibilitychange', clearVisibleAttention)
    window.addEventListener('focus', clearVisibleAttention)
    return () => {
      document.removeEventListener('visibilitychange', clearVisibleAttention)
      window.removeEventListener('focus', clearVisibleAttention)
    }
  }, [sessions, activeSessionId, isMobile])
}
