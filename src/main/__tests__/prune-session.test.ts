import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// Native/heavy deps that pty-manager pulls in at import time but that this test
// doesn't exercise. Keep fs real so prune reads/writes an actual temp file.
const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('os', async (importActual) => {
  const actual = await importActual<typeof import('os')>()
  return { ...actual, homedir: () => home.dir, default: { ...actual, homedir: () => home.dir } }
})
vi.mock('node-pty', () => ({ spawn: vi.fn() }))
vi.mock('../platform', () => ({
  isWindows: false,
  getEnhancedPathWithPortable: vi.fn().mockReturnValue(''),
  getAdditionalPaths: vi.fn().mockReturnValue([]),
}))
vi.mock('../portable-deps', () => ({ getPortableBinDirs: vi.fn().mockReturnValue([]) }))

import { pruneClaudeSessionToLatestBranch } from '../pty-manager'

describe('pruneClaudeSessionToLatestBranch', () => {
  let tmpHome: string
  const cwd = '/tmp/proj'
  const sessionId = 'sess-1'

  // claudeSessionJsonlPath encodes the cwd the same way Claude Code does.
  const sessionFile = () =>
    path.join(tmpHome, '.claude', 'projects', '-tmp-proj', `${sessionId}.jsonl`)

  beforeEach(() => {
    tmpHome = fs.mkdtempSync('/tmp/prune-test-')
    home.dir = tmpHome
    fs.mkdirSync(path.dirname(sessionFile()), { recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  const entry = (o: Record<string, unknown>) => JSON.stringify(o)

  it('keeps the latest real turn after compaction even when the freshest leaf is on a stale branch', () => {
    // Tree: u1 -> a1 -> (compact summary) cs -> u2 -> a2  [latest real turn]
    //                \-> att  [freshest entry by timestamp, but a dead pre-compaction leaf]
    const lines = [
      entry({ uuid: 'u1', parentUuid: null, type: 'user', timestamp: '2026-01-01T00:00:00.000Z' }),
      entry({ uuid: 'a1', parentUuid: 'u1', type: 'assistant', timestamp: '2026-01-01T00:01:00.000Z' }),
      entry({ uuid: 'cs', parentUuid: 'a1', type: 'user', isCompactSummary: true, timestamp: '2026-01-01T00:02:00.000Z' }),
      entry({ uuid: 'u2', parentUuid: 'cs', type: 'user', timestamp: '2026-01-01T00:03:00.000Z' }),
      entry({ uuid: 'a2', parentUuid: 'u2', type: 'assistant', timestamp: '2026-01-01T00:04:00.000Z' }),
      // Trailing non-conversation entry on the OLD branch with the newest timestamp.
      entry({ uuid: 'att', parentUuid: 'a1', type: 'attachment', timestamp: '2026-01-01T00:05:00.000Z' }),
    ]
    fs.writeFileSync(sessionFile(), lines.join('\n') + '\n')

    pruneClaudeSessionToLatestBranch(cwd, sessionId)

    const kept = fs.readFileSync(sessionFile(), 'utf-8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l).uuid)
    // The post-compaction turns must survive...
    expect(kept).toEqual(['u1', 'a1', 'cs', 'u2', 'a2'])
    // ...and the stale freshest leaf must be pruned away.
    expect(kept).not.toContain('att')
  })

  it('strips corrupted lines while preserving the chosen chain', () => {
    const lines = [
      entry({ uuid: 'u1', parentUuid: null, type: 'user', timestamp: '2026-01-01T00:00:00.000Z' }),
      '{ this is not valid json',
      entry({ uuid: 'a1', parentUuid: 'u1', type: 'assistant', timestamp: '2026-01-01T00:01:00.000Z' }),
    ]
    fs.writeFileSync(sessionFile(), lines.join('\n') + '\n')

    pruneClaudeSessionToLatestBranch(cwd, sessionId)

    const raw = fs.readFileSync(sessionFile(), 'utf-8').split('\n').filter(l => l.trim())
    expect(raw.every(l => { try { JSON.parse(l); return true } catch { return false } })).toBe(true)
    expect(raw.map(l => JSON.parse(l).uuid)).toEqual(['u1', 'a1'])
  })
})
