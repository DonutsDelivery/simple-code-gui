import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../api'
import { useProjectHandlers } from './useProjectHandlers'

const projectPath = '/proj/app'
const worktreePath = `${projectPath}/.claude/worktrees/tutorial`

function renderHandlers(api: Api) {
  const addTab = vi.fn()
  const result = renderHook(() => useProjectHandlers({
    api,
    projects: [{ path: projectPath, name: 'app', backend: 'claude-codex' }],
    openTabs: [],
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
    expect(api.spawnPty).toHaveBeenCalledWith(worktreePath, 'worktree-session', undefined, 'claude-codex')
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pty-1',
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
      await result.current.handleOpenSession(
        projectPath,
        'worktree-session',
        'tutorial',
        undefined,
        undefined,
        worktreePath
      )
    })

    expect(api.discoverSessions).not.toHaveBeenCalled()
    expect(api.spawnPty).toHaveBeenCalledWith(worktreePath, 'worktree-session', undefined, 'claude-codex')
  })
})
