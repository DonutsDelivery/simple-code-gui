import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSessions } from './useSessions'

const projects = [
  { path: '/repo-a', name: 'Repo A', serverId: 'server-1', backend: 'default' as const },
  { path: '/repo-b', name: 'Repo B', serverId: 'server-2', backend: 'hermes' as const },
]

describe('useSessions multi-server discovery', () => {
  it('discovers sessions through the project origin server api for the effective harness', async () => {
    const discoverSessions = vi.fn(async (_path: string, backend?: string) =>
      backend === 'hermes'
        ? [{ sessionId: 'hermes-session', slug: 'hermes-latest', lastModified: 2, cwd: '/repo-a' }]
        : []
    )
    const { result } = renderHook(() => useSessions({
      projects,
      openTabs: [],
      onOpenSession: vi.fn(),
      onSwitchToTab: vi.fn(),
      getApiForServer: (serverId: string) => (serverId === 'server-1' ? { discoverSessions } as any : null),
    }))

    act(() => { result.current.setExpandedProject('/repo-a') })
    await waitFor(() => expect(result.current.sessions['/repo-a']).toBeDefined())
    // Global default is claude; discovery runs against server-1 with claude.
    expect(discoverSessions).toHaveBeenCalledWith('/repo-a', 'claude')
    expect(result.current.sessions['/repo-a']).toEqual([])
  })

  it('switching the harness dropdown re-discovers and lists that harness sessions', async () => {
    const discoverSessions = vi.fn(async (_path: string, backend?: string) =>
      backend === 'hermes'
        ? [{ sessionId: 'hermes-session', slug: 'hermes-latest', lastModified: 2, cwd: '/repo-a' }]
        : []
    )
    const { result } = renderHook(() => useSessions({
      projects,
      openTabs: [],
      onOpenSession: vi.fn(),
      onSwitchToTab: vi.fn(),
      getApiForServer: () => ({ discoverSessions } as any),
    }))

    act(() => { result.current.setExpandedProject('/repo-a') })
    await waitFor(() => expect(discoverSessions).toHaveBeenCalled())

    act(() => { result.current.setHarnessForProject('/repo-a', 'hermes') })
    await waitFor(() => expect(result.current.sessions['/repo-a']?.[0]?.sessionId).toBe('hermes-session'))
    expect(discoverSessions).toHaveBeenLastCalledWith('/repo-a', 'hermes')
    expect(result.current.getEffectiveHarness('/repo-a')).toBe('hermes')
  })

  it('falls back project backend, then global default, then claude', () => {
    const { result } = renderHook(() => useSessions({
      projects,
      openTabs: [],
      onOpenSession: vi.fn(),
      onSwitchToTab: vi.fn(),
      defaultHarnessId: 'opencode',
    }))
    // repo-a: no project backend, no dropdown -> global default opencode
    expect(result.current.getEffectiveHarness('/repo-a')).toBe('opencode')
    // repo-b: project backend hermes wins over the global default
    expect(result.current.getEffectiveHarness('/repo-b')).toBe('hermes')
  })

  it('threads the project origin serverId through session open on a remote project', async () => {
    const discoverSessions = vi.fn(async () => [])
    const onOpenSession = vi.fn()
    const { result } = renderHook(() => useSessions({
      projects,
      openTabs: [],
      onOpenSession,
      onSwitchToTab: vi.fn(),
      getApiForServer: (serverId: string) => (serverId === 'server-2' ? { discoverSessions } as any : null),
    }))

    // Clicking a project on server-2 (no explicit options) opens a new session
    // and must carry server-2 so the spawn does not fall back to the active server.
    await act(async () => { await result.current.handleOpenSession('/repo-b') })
    expect(discoverSessions).toHaveBeenCalledWith('/repo-b', 'hermes')
    expect(onOpenSession).toHaveBeenCalledWith('/repo-b', expect.objectContaining({ serverId: 'server-2' }))
  })
})
