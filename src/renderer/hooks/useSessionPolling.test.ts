import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSessionPolling } from './useSessionPolling.js'

describe('useSessionPolling', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // AC: @session-discovery ac-3
  it('does not bind a root tab to a newer worktree session', async () => {
    vi.useFakeTimers()
    const updateTab = vi.fn()
    const api = {
      listPtys: vi.fn().mockResolvedValue([]),
      discoverSessions: vi.fn().mockResolvedValue([
        { sessionId: 'worktree-session', slug: 'worktree', cwd: '/project/.claude/worktrees/tutorial' },
        { sessionId: 'root-session', slug: 'root', cwd: '/project' },
      ]),
    } as any

    renderHook(() => useSessionPolling({
      api,
      projects: [{ path: '/project' }],
      openTabs: [{
        id: 'tab-1',
        ptyId: 'tab-1',
        projectPath: '/project',
        title: 'Project',
        backend: 'claude',
      }],
      updateTab,
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(updateTab).toHaveBeenCalledWith('tab-1', expect.objectContaining({ sessionId: 'root-session' }))
    expect(updateTab).not.toHaveBeenCalledWith('tab-1', expect.objectContaining({ sessionId: 'worktree-session' }))
  })
})
