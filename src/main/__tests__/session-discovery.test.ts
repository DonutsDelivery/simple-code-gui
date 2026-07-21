import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverSessions } from '../session-discovery'

const projectPath = '/proj/app'
const tempHomes: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempHomes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

describe('Claude session discovery', () => {
  it('discovers a session after Claude moves it into an owned worktree store', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-terminal-claude-'))
    tempHomes.push(home)
    vi.stubEnv('HOME', home)

    const sessionId = '91ba3b3d-ba17-4872-b332-98d09f2a097c'
    const worktreePath = '/proj/app/.claude/worktrees/grid'
    const worktreeStore = join(home, '.claude', 'projects', '-proj-app--claude-worktrees-grid')
    await mkdir(worktreeStore, { recursive: true })
    await writeFile(join(worktreeStore, `${sessionId}.jsonl`), [
      JSON.stringify({
        type: 'user',
        cwd: worktreePath,
        sessionId,
        timestamp: '2026-07-17T12:00:00.000Z',
        message: { role: 'user', content: 'Fix the grid end to end' },
      }),
      JSON.stringify({
        type: 'assistant',
        cwd: worktreePath,
        sessionId,
        slug: 'grid-workflow',
        timestamp: '2026-07-17T12:01:00.000Z',
        message: { role: 'assistant', content: 'Working on it' },
      }),
    ].join('\n'))

    await expect(discoverSessions(projectPath, 'claude-codex')).resolves.toMatchObject([
      { sessionId, slug: 'grid-workflow', cwd: worktreePath },
    ])
    await expect(discoverSessions(projectPath, 'claude-codex', sessionId)).resolves.toMatchObject([
      { sessionId, slug: 'grid-workflow', cwd: worktreePath },
    ])
  })

  // AC: @session-discovery ac-3
  it('aggregates only owned worktree sessions and keeps their actual cwd', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-terminal-claude-'))
    tempHomes.push(home)
    vi.stubEnv('HOME', home)

    const projectsDir = join(home, '.claude', 'projects')
    const rootStore = join(projectsDir, '-proj-app')
    const worktreeStore = join(projectsDir, '-proj-app--claude-worktrees-tutorial')
    const legacyWorktreeStore = join(projectsDir, 'proj-app--claude-worktrees-legacy')
    const collisionStore = join(projectsDir, '-proj-app--claude-worktrees-collision')
    const missingCwdStore = join(projectsDir, '-proj-app--claude-worktrees-missing')
    const siblingStore = join(projectsDir, '-proj-application--claude-worktrees-other')
    const worktreePath = '/proj/app/.claude/worktrees/tutorial'
    const legacyWorktreePath = '/proj/app/.claude/worktrees/legacy'
    const rootSessionId = '11111111-1111-4111-8111-111111111111'
    const movedSessionId = '22222222-2222-4222-8222-222222222222'
    const foreignSessionId = '33333333-3333-4333-8333-333333333333'
    const missingCwdSessionId = '44444444-4444-4444-8444-444444444444'
    const legacySessionId = '55555555-5555-4555-8555-555555555555'

    async function writeSession(
      store: string,
      sessionId: string,
      cwd: string | undefined,
      modified: string
    ): Promise<void> {
      await mkdir(store, { recursive: true })
      const identity = cwd ? { cwd } : {}
      const filePath = join(store, `${sessionId}.jsonl`)
      await writeFile(filePath, [
        JSON.stringify({
          ...identity,
          type: 'user',
          sessionId,
          timestamp: modified,
          message: { role: 'user', content: `Session ${sessionId}` },
        }),
        JSON.stringify({
          ...identity,
          type: 'assistant',
          sessionId,
          timestamp: modified,
          message: { role: 'assistant', content: 'Working' },
        }),
      ].join('\n'))
      const stamp = new Date(modified)
      await utimes(filePath, stamp, stamp)
    }

    await writeSession(rootStore, rootSessionId, projectPath, '2026-07-20T10:00:00.000Z')
    await writeSession(rootStore, movedSessionId, projectPath, '2026-07-19T10:00:00.000Z')
    await writeSession(worktreeStore, movedSessionId, worktreePath, '2026-07-21T13:00:00.000Z')
    await writeSession(legacyWorktreeStore, legacySessionId, legacyWorktreePath, '2026-07-21T12:00:00.000Z')
    await writeSession(collisionStore, foreignSessionId, '/proj/application/.claude/worktrees/foreign', '2026-07-22T10:00:00.000Z')
    await writeSession(missingCwdStore, missingCwdSessionId, undefined, '2026-07-23T10:00:00.000Z')
    await writeSession(siblingStore, foreignSessionId, '/proj/application/.claude/worktrees/other', '2026-07-24T10:00:00.000Z')

    const discovered = await discoverSessions(projectPath)
    expect(discovered.map(session => session.sessionId)).toEqual([
      movedSessionId,
      legacySessionId,
      rootSessionId,
    ])
    expect(discovered[0]).toMatchObject({ sessionId: movedSessionId, cwd: worktreePath })
    expect(discovered[1]).toMatchObject({ sessionId: legacySessionId, cwd: legacyWorktreePath })

    const rootIndex = JSON.parse(await readFile(join(rootStore, 'sessions-index.json'), 'utf-8'))
    expect(rootIndex.entries.find((entry: { sessionId: string }) => entry.sessionId === movedSessionId)).toMatchObject({
      fullPath: join(worktreeStore, `${movedSessionId}.jsonl`),
      projectPath: worktreePath,
    })
    expect(rootIndex.entries.map((entry: { sessionId: string }) => entry.sessionId)).toEqual([
      rootSessionId,
      legacySessionId,
      movedSessionId,
    ])

    const worktreeIndex = JSON.parse(await readFile(join(worktreeStore, 'sessions-index.json'), 'utf-8'))
    expect(worktreeIndex.originalPath).toBe(worktreePath)
    expect(worktreeIndex.entries).toEqual([
      expect.objectContaining({ sessionId: movedSessionId, projectPath: worktreePath }),
    ])
  })

  // AC: @session-discovery ac-1
  // AC: @session-discovery ac-2
  it('refreshes stale index activity while preserving native session metadata', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-terminal-claude-'))
    tempHomes.push(home)
    vi.stubEnv('HOME', home)

    const sessionsDir = join(home, '.claude', 'projects', '-proj-app')
    await mkdir(sessionsDir, { recursive: true })

    const activeSessionId = '12b44ea6-fbd6-4a58-b1e9-ae930fba3664'
    const olderSessionId = 'a414c242-1594-457a-80f8-0ca42a92f003'
    const deletedSessionId = 'f5c01dea-82c1-4775-86a1-67b6700abda5'
    const activePath = join(sessionsDir, `${activeSessionId}.jsonl`)
    const olderPath = join(sessionsDir, `${olderSessionId}.jsonl`)
    const indexPath = join(sessionsDir, 'sessions-index.json')

    await writeFile(activePath, [
      JSON.stringify({
        type: 'user', cwd: projectPath, sessionId: activeSessionId,
        timestamp: '2026-07-21T12:00:00.000Z', message: { role: 'user', content: 'Continue the active session' },
      }),
      JSON.stringify({
        type: 'assistant', cwd: projectPath, sessionId: activeSessionId,
        timestamp: '2026-07-21T12:01:00.000Z', message: { role: 'assistant', content: 'First response' },
      }),
      JSON.stringify({
        type: 'assistant', cwd: projectPath, sessionId: activeSessionId, slug: 'jsonl-generated-slug',
        timestamp: '2026-07-21T12:02:00.000Z', message: { role: 'assistant', content: 'Latest response' },
      }),
    ].join('\n'))
    await writeFile(olderPath, JSON.stringify({
      type: 'user', cwd: projectPath, sessionId: olderSessionId,
      timestamp: '2026-07-20T12:00:00.000Z', message: { role: 'user', content: 'Older session' },
    }))
    await utimes(activePath, new Date('2026-07-21T13:00:00.000Z'), new Date('2026-07-21T13:00:00.000Z'))
    await utimes(olderPath, new Date('2026-07-20T13:00:00.000Z'), new Date('2026-07-20T13:00:00.000Z'))
    const activeFileStat = await stat(activePath)

    await writeFile(indexPath, JSON.stringify({
      version: 1,
      entries: [
        {
          sessionId: activeSessionId,
          fullPath: activePath,
          fileMtime: 1,
          firstPrompt: 'Native first prompt',
          summary: 'Native generated title',
          messageCount: 1,
          created: '2026-07-01T00:00:00.000Z',
          modified: '2026-07-01T00:00:00.000Z',
          gitBranch: 'feat/native-metadata',
          projectPath,
          isSidechain: false,
          nativeExtension: { preserved: true },
        },
        {
          sessionId: deletedSessionId,
          fullPath: join(sessionsDir, `${deletedSessionId}.jsonl`),
          fileMtime: 2,
          firstPrompt: 'Deleted',
          summary: 'Deleted',
          messageCount: 1,
          created: '2026-07-01T00:00:00.000Z',
          modified: '2026-07-01T00:00:00.000Z',
          gitBranch: '',
          projectPath,
          isSidechain: false,
        },
      ],
      originalPath: projectPath,
      nativeTopLevel: 'preserved',
    }, null, 2))

    const discovered = await discoverSessions(projectPath)
    expect(discovered.map(session => session.sessionId)).toEqual([activeSessionId, olderSessionId])

    const repaired = JSON.parse(await readFile(indexPath, 'utf-8'))
    expect(repaired.nativeTopLevel).toBe('preserved')
    expect(repaired.entries.map((entry: { sessionId: string }) => entry.sessionId)).toEqual([
      olderSessionId,
      activeSessionId,
    ])

    const refreshed = repaired.entries[1]
    expect(refreshed).toMatchObject({
      sessionId: activeSessionId,
      fileMtime: activeFileStat.mtimeMs,
      modified: activeFileStat.mtime.toISOString(),
      messageCount: 3,
      firstPrompt: 'Native first prompt',
      summary: 'Native generated title',
      created: '2026-07-01T00:00:00.000Z',
      gitBranch: 'feat/native-metadata',
      isSidechain: false,
      nativeExtension: { preserved: true },
    })
    expect(repaired.entries.some((entry: { sessionId: string }) => entry.sessionId === deletedSessionId)).toBe(false)

    const repairedStat = await stat(indexPath)
    await new Promise(resolve => setTimeout(resolve, 20))
    await discoverSessions(projectPath)
    expect((await stat(indexPath)).mtimeMs).toBe(repairedStat.mtimeMs)
    await expect(readFile(indexPath, 'utf-8').then(JSON.parse)).resolves.toBeTruthy()
  })
})
