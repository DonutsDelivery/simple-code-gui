import { describe, expect, it, vi } from 'vitest'

vi.mock('../components/terminal/Terminal', () => ({
  cleanupOrphanedBuffers: vi.fn(),
}))

import { buildRestoredCanvasScene, spawnSessionTabs } from '../hooks/useWorkspaceLoader'
import { createEmptyCanvasScene } from '../components/canvas'
import type { Api } from '../api'
import type { PtySession } from '../api/types'

const projectPath = '/proj/app'

function savedTab(overrides: Partial<any> = {}) {
  return {
    id: 'saved-pty',
    ptyId: 'saved-pty',
    projectPath,
    sessionId: 'ses_stale',
    title: 'app - old session',
    backend: 'codex',
    ...overrides,
  }
}

function createApi(discoveredSessions: Array<{ sessionId: string; slug: string; cwd?: string }> = []) {
  return {
    ttsInstallInstructions: vi.fn().mockResolvedValue(undefined),
    discoverSessions: vi.fn().mockResolvedValue(discoveredSessions),
    spawnPty: vi.fn().mockResolvedValue('new-pty'),
  } as unknown as Api
}

describe('spawnSessionTabs', () => {
  // AC: @session-discovery ac-3
  it('uses the discovered worktree cwd when a saved session id is stale', async () => {
    const worktreePath = `${projectPath}/.claude/worktrees/latest`
    const api = createApi([{ sessionId: 'most-recent', slug: 'latest', cwd: worktreePath }])
    const addedTabs: any[] = []

    const result = await spawnSessionTabs(
      api,
      [savedTab()],
      [{ path: projectPath, backend: 'codex' }],
      null,
      (tab) => addedTabs.push(tab)
    )

    expect(api.spawnPty).toHaveBeenCalledWith(worktreePath, 'most-recent', undefined, 'codex')
    expect(result.restoredTabs[0]).toMatchObject({ sessionId: 'most-recent', projectPath: worktreePath })
    expect(addedTabs[0].sessionId).toBe('most-recent')
  })

  // AC: @session-discovery ac-3
  it('uses the discovered worktree cwd when the saved tab has no session id', async () => {
    const worktreePath = `${projectPath}/.claude/worktrees/latest`
    const api = createApi([{ sessionId: 'most-recent', slug: 'latest', cwd: worktreePath }])

    const result = await spawnSessionTabs(
      api,
      [savedTab({ sessionId: undefined })],
      [{ path: projectPath, backend: 'codex' }],
      null,
      () => {}
    )

    expect(api.spawnPty).toHaveBeenCalledWith(worktreePath, 'most-recent', undefined, 'codex')
    expect(result.restoredTabs[0]).toMatchObject({ sessionId: 'most-recent', projectPath: worktreePath })
  })

  it('falls back to Codex resume-last when a stale saved session id has no discovered replacement', async () => {
    const api = createApi([])
    const addedTabs: any[] = []

    const result = await spawnSessionTabs(
      api,
      [savedTab()],
      [{ path: projectPath, backend: 'codex' }],
      null,
      (tab) => addedTabs.push(tab)
    )

    expect(api.spawnPty).toHaveBeenCalledWith(projectPath, '__codex_resume_last__', undefined, 'codex')
    expect(result.restoredTabs[0].sessionId).toBeUndefined()
    expect(addedTabs[0].sessionId).toBeUndefined()
  })

  it('uses live PTY metadata instead of a stale saved session id', async () => {
    const api = createApi([{ sessionId: 'real-session', slug: 'real' }])
    const livePty: PtySession = {
      id: 'saved-pty',
      cwd: projectPath,
      backend: 'codex',
      spawnedAt: 123,
    }

    const result = await spawnSessionTabs(
      api,
      [savedTab()],
      [{ path: projectPath, backend: 'codex' }],
      null,
      () => {},
      [livePty]
    )

    expect(api.discoverSessions).not.toHaveBeenCalled()
    expect(api.spawnPty).not.toHaveBeenCalled()
    expect(result.restoredTabs[0]).toMatchObject({
      id: 'saved-pty',
      ptyId: 'saved-pty',
      sessionId: undefined,
      backend: 'codex',
    })
  })
})

describe('buildRestoredCanvasScene', () => {
  const liveTab = {
    id: 'live-pty',
    ptyId: 'live-pty',
    projectPath,
    title: 'app - restored',
    backend: 'codex' as const,
  }

  // AC: @canvas-workspace ac-2
  // AC: @canvas-scene-persistence ac-1
  it('restores the camera and remaps saved terminal references', () => {
    const saved = createEmptyCanvasScene()
    saved.camera = { x: -240, y: 90, zoom: 0.65 }
    saved.nodes = [{
      id: 'node-1',
      tabIds: ['saved-pty'],
      activeTabId: 'saved-pty',
      projectPath,
      rect: { x: -100, y: 40, width: 680, height: 420 },
      zIndex: 0,
      presentation: { title: 'app' },
    }]

    const restored = buildRestoredCanvasScene(
      saved,
      'canvas',
      null,
      new Map([['saved-pty', 'live-pty']]),
      [liveTab]
    )

    expect(restored.activeView).toBe('canvas')
    expect(restored.scene.camera).toEqual({ x: -240, y: 90, zoom: 0.65 })
    expect(restored.scene.nodes[0].tabIds).toEqual(['live-pty'])
    expect(restored.scene.nodes[0].rect).toEqual({ x: -100, y: 40, width: 680, height: 420 })
  })

  // AC: @canvas-scene-persistence ac-3
  it('falls back to Tiles and preserves unknown future scene data', () => {
    const future = { version: 42, nodes: [{ future: true }] }

    const restored = buildRestoredCanvasScene(
      future,
      'canvas',
      null,
      new Map(),
      [liveTab]
    )

    expect(restored.activeView).toBe('tiles')
    expect(restored.preservedScene).toBe(future)
    expect(restored.scene.nodes[0].tabIds).toEqual(['live-pty'])
  })

  // AC: @canvas-scene-persistence ac-2
  it('regenerates malformed spatial data without losing live sessions', () => {
    const restored = buildRestoredCanvasScene(
      { version: 1, nodes: 'broken' },
      'canvas',
      null,
      new Map(),
      [liveTab]
    )

    expect(restored.activeView).toBe('canvas')
    expect(restored.scene.nodes[0].tabIds).toEqual(['live-pty'])
    expect(restored.preservedScene).toBeUndefined()
  })
})
