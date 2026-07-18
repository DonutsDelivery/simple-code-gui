import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyCanvasScene } from '../components/canvas'
import { createLeaf } from '../components/tile-tree'
import { useWorkspaceStore, type WorkspaceSession } from '../stores/workspace'
import { useAgentNotifications } from './useAgentNotifications'

vi.mock('../utils/agentNotificationAudio', () => ({ playAgentNotificationSound: vi.fn() }))
import { playAgentNotificationSound } from '../utils/agentNotificationAudio'

function session(id: string, tabId: string): WorkspaceSession {
  return {
    id,
    name: id,
    openTabs: [{ id: tabId, ptyId: `pty-${tabId}`, projectPath: `/${id}`, title: tabId }],
    activeTabId: tabId,
    activeTileTree: createLeaf(`leaf-${id}`, [tabId], tabId),
    canvasScene: createEmptyCanvasScene(),
    activeView: 'tiles',
    isRestored: true,
  }
}

describe('useAgentNotifications', () => {
  beforeEach(() => {
    vi.mocked(playAgentNotificationSound).mockClear()
    useWorkspaceStore.getState().initSessions([session('one', 'visible'), session('two', 'hidden')], 'one')
  })
  afterEach(cleanup)

  // AC: @agent-session-notifications ac-3
  // AC: @agent-session-notifications ac-4
  it('plays every cue but marks only hidden tabs until their workspace is opened', () => {
    let listener: ((event: { ptyId: string; type: 'complete' | 'input-needed' }) => void) | undefined
    const api = {
      onAgentSessionSignal: vi.fn((callback) => { listener = callback; return vi.fn() }),
    } as any
    renderHook(() => useAgentNotifications({ api, settings: { defaultProjectDir: '', theme: 'default' }, isMobile: false }))

    act(() => listener?.({ ptyId: 'pty-visible', type: 'complete' }))
    expect(playAgentNotificationSound).toHaveBeenCalledWith('completed', 0.65)
    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({})

    act(() => listener?.({ ptyId: 'pty-hidden', type: 'input-needed' }))
    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({ hidden: 'needs-input' })

    act(() => useWorkspaceStore.getState().switchSession('two'))
    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({})
  })

  // AC: @agent-session-notifications ac-3
  it('delivers signals that arrive before restored PTYs are mapped to tabs', () => {
    let listener: ((event: { ptyId: string; type: 'complete' }) => void) | undefined
    const api = { onAgentSessionSignal: (callback: typeof listener) => { listener = callback; return vi.fn() } } as any
    renderHook(() => useAgentNotifications({
      api,
      settings: { defaultProjectDir: '', theme: 'default' },
      isMobile: false,
    }))

    act(() => listener?.({ ptyId: 'pty-restored', type: 'complete' }))
    expect(playAgentNotificationSound).not.toHaveBeenCalled()

    const restored = session('restored-workspace', 'restored')
    act(() => useWorkspaceStore.getState().initSessions([
      session('one', 'visible'),
      session('two', 'hidden'),
      restored,
    ], 'one'))

    expect(playAgentNotificationSound).toHaveBeenCalledWith('completed', 0.65)
    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({ restored: 'completed' })
  })

  // AC: @agent-session-notifications ac-6
  it('keeps highlighting enabled when independent notification audio is disabled', () => {
    let listener: ((event: { ptyId: string; type: 'complete' }) => void) | undefined
    const api = { onAgentSessionSignal: (callback: typeof listener) => { listener = callback; return vi.fn() } } as any
    renderHook(() => useAgentNotifications({
      api,
      settings: { defaultProjectDir: '', theme: 'default', notificationSoundsEnabled: false, notificationVolume: 0.2 },
      isMobile: false,
    }))

    act(() => listener?.({ ptyId: 'pty-hidden', type: 'complete' }))
    expect(playAgentNotificationSound).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({ hidden: 'completed' })
  })
})
