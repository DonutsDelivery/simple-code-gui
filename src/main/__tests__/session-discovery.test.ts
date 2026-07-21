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

describe('Claude session discovery index repair', () => {
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
