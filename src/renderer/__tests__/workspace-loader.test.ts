import { describe, expect, it, vi } from 'vitest'

vi.mock('../components/terminal/Terminal', () => ({
  cleanupOrphanedBuffers: vi.fn(),
}))

import { spawnSessionTabs } from '../hooks/useWorkspaceLoader'
import type { Api, PtySession } from '../api'

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

function createApi(discoveredSessions: Array<{ sessionId: string; slug: string }> = []) {
  return {
    ttsInstallInstructions: vi.fn().mockResolvedValue(undefined),
    discoverSessions: vi.fn().mockResolvedValue(discoveredSessions),
    spawnPty: vi.fn().mockResolvedValue('new-pty'),
  } as unknown as Api
}

describe('spawnSessionTabs', () => {
  it('uses the most recent discovered session when a saved session id is stale', async () => {
    const api = createApi([{ sessionId: 'most-recent', slug: 'latest' }])
    const addedTabs: any[] = []

    const result = await spawnSessionTabs(
      api,
      [savedTab()],
      [{ path: projectPath, backend: 'codex' }],
      null,
      (tab) => addedTabs.push(tab)
    )

    expect(api.spawnPty).toHaveBeenCalledWith(projectPath, 'most-recent', undefined, 'codex')
    expect(result.restoredTabs[0].sessionId).toBe('most-recent')
    expect(addedTabs[0].sessionId).toBe('most-recent')
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
