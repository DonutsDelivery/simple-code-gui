import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentSessionSignalEvent } from '../../common/agent-session-signal'
import type { Api } from '../api'
import { useWorkspaceStore, type AgentAttentionKind } from '../stores/workspace'
import type { AppSettings } from './useSettings'
import { findTabByPtyId, getActuallyVisibleTabIds, getVisibleTabIds } from '../utils/agentAttention'
import { playAgentNotificationSound } from '../utils/agentNotificationAudio'

interface UseAgentNotificationsOptions {
  serverId: string
  api: Api
  settings: AppSettings | null
  isMobile: boolean
}

export function useAgentNotifications({ serverId, api, settings, isMobile }: UseAgentNotificationsOptions): void {
  const tabTopology = useWorkspaceStore(useShallow(
    state => state.sessions.map(session => session.openTabs),
  ))
  const activeSessionId = useWorkspaceStore(state => state.activeSessionId)
  const pendingSignals = useRef(new Map<string, AgentSessionSignalEvent>())

  const handleSignal = (event: AgentSessionSignalEvent): boolean => {
    const state = useWorkspaceStore.getState()
    const attentionKey = findTabByPtyId(state.sessions, serverId, event.ptyId)
    if (!attentionKey) return false

    const kind: AgentAttentionKind = event.type === 'complete' ? 'completed' : 'needs-input'
    if (settings?.notificationSoundsEnabled !== false) {
      playAgentNotificationSound(kind, settings?.notificationVolume ?? 0.65)
    }

    const logical = getVisibleTabIds(state.sessions, state.activeSessionId, isMobile)
    const visible = getActuallyVisibleTabIds(logical)
    if (visible.has(attentionKey)) state.clearTabAttention(attentionKey)
    else state.markTabAttention(attentionKey, kind)
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
  }, [tabTopology, isMobile, settings?.notificationSoundsEnabled, settings?.notificationVolume])

  useEffect(() => {
    const clearVisibleAttention = (): void => {
      const state = useWorkspaceStore.getState()
      const logical = getVisibleTabIds(state.sessions, state.activeSessionId, isMobile)
      const visible = getActuallyVisibleTabIds(logical)
      state.clearTabAttentionMany([...visible])
    }

    const observedElements = new Set<Element>()
    const intersectionObserver = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
        if (entries.some(entry => entry.isIntersecting)) clearVisibleAttention()
      })

    const observeVisibleTabElements = (): void => {
      if (!intersectionObserver) return
      for (const element of document.querySelectorAll('[data-agent-visible-tab-id]')) {
        if (observedElements.has(element)) continue
        observedElements.add(element)
        intersectionObserver.observe(element)
      }
      for (const element of observedElements) {
        if (element.isConnected) continue
        intersectionObserver.unobserve(element)
        observedElements.delete(element)
      }
    }

    const mutationObserver = !intersectionObserver || !document.body
      ? null
      : new MutationObserver(() => {
        observeVisibleTabElements()
        clearVisibleAttention()
      })

    clearVisibleAttention()
    observeVisibleTabElements()
    mutationObserver?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-agent-visible-tab-id'],
    })
    document.addEventListener('visibilitychange', clearVisibleAttention)
    window.addEventListener('focus', clearVisibleAttention)
    return () => {
      mutationObserver?.disconnect()
      intersectionObserver?.disconnect()
      document.removeEventListener('visibilitychange', clearVisibleAttention)
      window.removeEventListener('focus', clearVisibleAttention)
    }
  }, [activeSessionId, isMobile])
}
