import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../api'
import { useProjectHandlers } from './useProjectHandlers'

const projectPath = '/proj/app'
const worktreePath = `${projectPath}/.claude/worktrees/tutorial`

function renderHandlers(api: Api, openTabs: any[] = []) {
  const addTab = vi.fn()
  const result = renderHook(() => useProjectHandlers({
    serverId: 'server-a',
    api,
    getApiForServer: serverId => serverId === 'server-a' ? api : undefined,
    projects: [{ serverId: 'server-a', path: projectPath, name: 'app', backend: 'claude-codex' }],
    openTabs,
    settings: null,
    tileTree: null,
    addProject: vi.fn(),
    removeTab: vi.fn(),
    addTab,
    setActiveTab: vi.fn(),
    setTileTree: vi.fn(),
  }))
  return { ...result, addTab }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useProjectHandlers worktree resume', () => {
  // AC: @session-discovery ac-3
  it('uses discovered cwd while retaining the root project backend', async () => {
    const api = {
      discoverSessions: vi.fn().mockResolvedValue([
        { sessionId: 'worktree-session', slug: 'tutorial', cwd: worktreePath },
      ]),
      ttsInstallInstructions: vi.fn().mockResolvedValue(undefined),
      spawnPty: vi.fn().mockResolvedValue('pty-1'),
    } as unknown as Api
    const { result, addTab } = renderHandlers(api)

    await act(async () => {
      await result.current.handleOpenSession(projectPath)
    })

    expect(api.discoverSessions).toHaveBeenCalledWith(projectPath, 'claude-codex')
    expect(api.spawnPty).toHaveBeenCalledWith(worktreePath, 'worktree-session', undefined, 'claude-codex', undefined)
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({
      id: 'server-a\0worktree-session',
      authorityTabId: 'worktree-session',
      ptyId: 'pty-1',
      projectPath: worktreePath,
      sessionId: 'worktree-session',
      backend: 'claude-codex',
    }))
  })

  // AC: @session-discovery ac-3
  it('honors an explicit discovered cwd from the sidebar', async () => {
    const api = {
      discoverSessions: vi.fn(),
      ttsInstallInstructions: vi.fn().mockResolvedValue(undefined),
      spawnPty: vi.fn().mockResolvedValue('pty-2'),
    } as unknown as Api
    const { result } = renderHandlers(api)

    await act(async () => {
      await result.current.handleOpenSession(projectPath, {
        sessionId: 'worktree-session',
        slug: 'tutorial',
        resumeCwd: worktreePath,
      })
    })

    expect(api.discoverSessions).not.toHaveBeenCalled()
    expect(api.spawnPty).toHaveBeenCalledWith(worktreePath, 'worktree-session', undefined, 'claude-codex', undefined)
  })

  it('starts an explicit new session without discovering or resuming an old session', async () => {
    const api = {
      discoverSessions: vi.fn().mockResolvedValue([
        { sessionId: 'old-session', slug: 'old', cwd: worktreePath },
      ]),
      ttsInstallInstructions: vi.fn().mockResolvedValue(undefined),
      spawnPty: vi.fn().mockResolvedValue('pty-new'),
    } as unknown as Api
    const { result, addTab } = renderHandlers(api)

    await act(async () => {
      await result.current.handleOpenSession(projectPath, { forceNewSession: true })
    })

    expect(api.discoverSessions).not.toHaveBeenCalled()
    expect(api.spawnPty).toHaveBeenCalledWith(projectPath, undefined, undefined, 'claude-codex', undefined)
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({
      id: 'server-a\0pty-new',
      authorityTabId: 'pty-new',
      ptyId: 'pty-new',
      projectPath,
      sessionId: undefined,
      title: 'app - New',
    }))
  })

  it('routes a new session to the explicitly selected server and harness', async () => {
    const serverA = { discoverSessions: vi.fn(), spawnPty: vi.fn() } as unknown as Api
    const serverB = {
      discoverSessions: vi.fn(),
      ttsInstallInstructions: vi.fn().mockResolvedValue(undefined),
      spawnPty: vi.fn().mockResolvedValue('pty-b'),
    } as unknown as Api
    const addTab = vi.fn()
    const { result } = renderHook(() => useProjectHandlers({
      serverId: 'server-a',
      api: serverA,
      getApiForServer: serverId => serverId === 'server-b' ? serverB : serverA,
      projects: [{ serverId: 'server-b', path: projectPath, name: 'app' }],
      openTabs: [],
      settings: null,
      tileTree: null,
      addProject: vi.fn(),
      removeTab: vi.fn(),
      addTab,
      setActiveTab: vi.fn(),
      setTileTree: vi.fn(),
    }))

    await act(async () => {
      await result.current.handleOpenSession(projectPath, {
        serverId: 'server-b',
        harnessId: 'codex',
        forceNewSession: true,
      })
    })

    expect(serverA.spawnPty).not.toHaveBeenCalled()
    expect(serverB.spawnPty).toHaveBeenCalledWith(projectPath, undefined, undefined, 'codex', undefined)
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({
      serverId: 'server-b',
      backend: 'codex',
      ptyId: 'pty-b',
    }))
  })

  it('closes project tiles on every authority, not just the viewed server', () => {
    const serverA = { killPty: vi.fn() } as unknown as Api
    const serverB = { killPty: vi.fn() } as unknown as Api
    const removeTab = vi.fn()
    const { result } = renderHook(() => useProjectHandlers({
      serverId: 'server-a',
      api: serverA,
      getApiForServer: serverId => serverId === 'server-b' ? serverB : serverA,
      projects: [{ serverId: 'server-b', path: projectPath, name: 'app' }],
      openTabs: [
        { serverId: 'server-a', id: 'a1', projectPath, title: 'local', ptyId: 'pty-a' },
        { serverId: 'server-b', id: 'b1', projectPath, title: 'remote', ptyId: 'pty-b' },
        { serverId: 'server-b', id: 'b2', projectPath: '/other', title: 'other', ptyId: 'pty-other' },
      ],
      settings: null,
      tileTree: null,
      addProject: vi.fn(),
      removeTab,
      addTab: vi.fn(),
      setActiveTab: vi.fn(),
      setTileTree: vi.fn(),
    }))

    act(() => {
      result.current.handleCloseProjectTabs(projectPath)
    })

    expect(serverA.killPty).toHaveBeenCalledWith('pty-a')
    expect(serverB.killPty).toHaveBeenCalledWith('pty-b')
    expect(serverB.killPty).not.toHaveBeenCalledWith('pty-other')
    expect(removeTab).toHaveBeenCalledWith('a1')
    expect(removeTab).toHaveBeenCalledWith('b1')
    expect(removeTab).not.toHaveBeenCalledWith('b2')
  })
})
