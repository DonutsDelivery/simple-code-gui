import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyCanvasScene } from '../components/canvas'
import { createLeaf } from '../components/tile-tree'
import { useWorkspaceStore, type WorkspaceSession } from '../stores/workspace'
import { useAgentNotifications } from './useAgentNotifications'

vi.mock('../utils/agentNotificationAudio', () => ({ playAgentNotificationSound: vi.fn() }))
import { playAgentNotificationSound } from '../utils/agentNotificationAudio'

function session(id: string, tabId: string): WorkspaceSession {
  const rendererTabId = `server-a\0${tabId}`
  return {
    serverId: 'server-a',
    authoritySessionId: id,
    id,
    name: id,
    openTabs: [{ serverId: 'server-a', authorityTabId: tabId, id: rendererTabId, ptyId: `pty-${tabId}`, projectPath: `/${id}`, title: tabId }],
    activeTabId: rendererTabId,
    activeTileTree: createLeaf(`leaf-${id}`, [rendererTabId], rendererTabId),
    canvasScene: createEmptyCanvasScene(),
    activeView: 'tiles',
    isRestored: true,
  }
}

describe('useAgentNotifications', () => {
  beforeEach(() => {
    vi.mocked(playAgentNotificationSound).mockClear()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    useWorkspaceStore.getState().initSessions([session('one', 'visible'), session('two', 'hidden')], 'one')
  })
  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  // AC: @agent-session-notifications ac-3
  // AC: @agent-session-notifications ac-4
  it('plays every cue but marks only hidden tabs until their workspace is opened', () => {
    let listener: ((event: { ptyId: string; type: 'complete' | 'input-needed' }) => void) | undefined
    const api = {
      onAgentSessionSignal: vi.fn((callback) => { listener = callback; return vi.fn() }),
    } as any
    renderHook(() => useAgentNotifications({ serverId: 'server-a', api, settings: { defaultProjectDir: '', theme: 'default' }, isMobile: false }))

    act(() => listener?.({ ptyId: 'pty-visible', type: 'complete' }))
    expect(playAgentNotificationSound).toHaveBeenCalledWith('completed', 0.65)
    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({})

    act(() => listener?.({ ptyId: 'pty-hidden', type: 'input-needed' }))
    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({ ['server-a\0hidden']: 'needs-input' })

    act(() => useWorkspaceStore.getState().switchSession('two'))
    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({})
  })

  // AC: @agent-session-notifications ac-3
  it('delivers signals that arrive before restored PTYs are mapped to tabs', () => {
    let listener: ((event: { ptyId: string; type: 'complete' }) => void) | undefined
    const api = { onAgentSessionSignal: (callback: typeof listener) => { listener = callback; return vi.fn() } } as any
    renderHook(() => useAgentNotifications({ serverId: 'server-a',
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
    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({ ['server-a\0restored']: 'completed' })
  })

  // AC: @agent-session-notifications ac-6
  it('keeps highlighting enabled when independent notification audio is disabled', () => {
    let listener: ((event: { ptyId: string; type: 'complete' }) => void) | undefined
    const api = { onAgentSessionSignal: (callback: typeof listener) => { listener = callback; return vi.fn() } } as any
    renderHook(() => useAgentNotifications({ serverId: 'server-a',
      api,
      settings: { defaultProjectDir: '', theme: 'default', notificationSoundsEnabled: false, notificationVolume: 0.2 },
      isMobile: false,
    }))

    act(() => listener?.({ ptyId: 'pty-hidden', type: 'complete' }))
    expect(playAgentNotificationSound).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({ ['server-a\0hidden']: 'completed' })
  })

  // AC: @agent-session-notifications ac-3
  it('keeps attention when the selected mobile tab signals while the document is hidden', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    let listener: ((event: { ptyId: string; type: 'complete' }) => void) | undefined
    const api = { onAgentSessionSignal: (callback: typeof listener) => { listener = callback; return vi.fn() } } as any
    renderHook(() => useAgentNotifications({ serverId: 'server-a',
      api,
      settings: { defaultProjectDir: '', theme: 'default' },
      isMobile: true,
    }))

    act(() => listener?.({ ptyId: 'pty-visible', type: 'complete' }))

    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({ ['server-a\0visible']: 'completed' })
  })

  // AC: @agent-session-notifications ac-3
  it('acknowledges attention when a rendered terminal is retagged in the viewport', () => {
    let notifyIntersection: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined
    let notifyMutation: (() => void) | undefined
    class TestIntersectionObserver {
      constructor(callback: typeof notifyIntersection) { notifyIntersection = callback }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    class TestMutationObserver {
      constructor(callback: typeof notifyMutation) { notifyMutation = callback }
      observe = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
    vi.stubGlobal('MutationObserver', TestMutationObserver)
    const marker = document.createElement('div')
    marker.dataset.agentVisibleTabId = 'server-a\0hidden'
    marker.getBoundingClientRect = () => ({
      width: 100,
      height: 100,
      left: -200,
      right: -100,
      top: 0,
      bottom: 100,
    } as DOMRect)
    document.body.append(marker)
    useWorkspaceStore.getState().markTabAttention('server-a\0visible', 'completed')

    renderHook(() => useAgentNotifications({ serverId: 'server-a',
      api: { onAgentSessionSignal: () => vi.fn() } as any,
      settings: { defaultProjectDir: '', theme: 'default' },
      isMobile: true,
    }))
    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({ ['server-a\0visible']: 'completed' })

    marker.dataset.agentVisibleTabId = 'server-a\0visible'
    marker.getBoundingClientRect = () => ({
      width: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      bottom: 100,
    } as DOMRect)
    act(() => notifyMutation?.())

    expect(useWorkspaceStore.getState().attentionByTabId).toEqual({})
  })

  // AC: @agent-session-notifications ac-3
  it('does not rerun visibility acknowledgement for Canvas-only scene updates', () => {
    const clearVisible = vi.spyOn(useWorkspaceStore.getState(), 'clearTabAttentionMany')
    renderHook(() => useAgentNotifications({ serverId: 'server-a',
      api: { onAgentSessionSignal: () => vi.fn() } as any,
      settings: { defaultProjectDir: '', theme: 'default' },
      isMobile: false,
    }))
    const initialCalls = clearVisible.mock.calls.length

    act(() => {
      useWorkspaceStore.getState().setActiveCanvasScene({
        ...createEmptyCanvasScene(),
        camera: { x: 25, y: 40, zoom: 1 },
      })
    })

    expect(clearVisible).toHaveBeenCalledTimes(initialCalls)
  })
})
