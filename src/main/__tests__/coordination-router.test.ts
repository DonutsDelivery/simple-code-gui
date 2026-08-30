import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoordinationMessage } from '../../common/coordination-protocol'
import { CoordinationRouter } from '../coordination-router'
import { CoordinationStore } from '../coordination-store'
import type { SessionRuntimeRegistry } from '../session-runtime-registry'

let dir: string
let writes: string[]
let runtimeRegistry: SessionRuntimeRegistry
let store: CoordinationStore
let router: CoordinationRouter

const request = (overrides: Partial<CoordinationMessage> = {}): CoordinationMessage => ({
  messageId: 'message-1',
  assignmentId: 'assignment-1',
  sequence: 1,
  sender: { serverId: 'linux', agentSessionId: 'coordinator' },
  recipient: { serverId: 'mac', agentSessionId: 'worker' },
  kind: 'request',
  repositoryRevision: 'tree-abc',
  artifactIds: [],
  payload: { task: 'build' },
  createdAt: 1000,
  ...overrides,
})

beforeEach(() => {
  dir = join(tmpdir(), `dc-coordination-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  writes = []
  runtimeRegistry = {
    getRuntime: vi.fn((sessionId: string) => sessionId === 'worker' ? {
      agentSessionId: 'worker', runtimeId: 'runtime-1', ptyId: 'pty-1', projectId: '/repo', harnessId: 'claude', created: false,
    } : null),
    writeInput: vi.fn((_ptyId: string, data: string) => {
      writes.push(data)
      return { runtimeId: 'runtime-1', sequence: writes.length }
    }),
  } as unknown as SessionRuntimeRegistry
  store = new CoordinationStore(dir, 'mac')
  router = new CoordinationRouter('mac', store, runtimeRegistry)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('CoordinationRouter', () => {
  it('persists before delivering through the exact worker runtime input channel', () => {
    const receipt = router.send(request())
    expect(receipt.accepted).toBe(true)
    expect(receipt.delivered).toBe(true)
    expect(receipt.duplicate).toBe(false)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain('"type":"donutcode-coordination"')
    expect(writes[0]).toContain('"agentSessionId":"worker"')
    expect(store.getAssignment('assignment-1')?.repositoryRevision).toBe('tree-abc')
  })

  it('deduplicates message IDs and never delivers a duplicate twice', () => {
    expect(router.send(request()).duplicate).toBe(false)
    expect(router.send(request()).duplicate).toBe(true)
    expect(writes).toHaveLength(1)
    expect(store.getSnapshot().messages).toHaveLength(1)
  })

  it('enforces strict per-assignment sequence ordering', () => {
    router.send(request())
    expect(() => router.send(request({ messageId: 'message-3', sequence: 3, kind: 'progress' })))
      .toThrow('Expected sequence 2')
    const ack = router.send(request({
      messageId: 'message-2',
      sequence: 2,
      kind: 'ack',
      sender: { serverId: 'mac', agentSessionId: 'worker' },
      recipient: { serverId: 'linux', agentSessionId: 'coordinator' },
    }))
    expect(ack.assignment.status).toBe('acknowledged')
  })

  it('keeps undelivered work durable while every frontend is closed', () => {
    ;(runtimeRegistry.getRuntime as ReturnType<typeof vi.fn>).mockReturnValue(null)
    const receipt = router.send(request())
    expect(receipt.delivered).toBe(false)
    const reloadedStore = new CoordinationStore(dir, 'mac')
    expect(reloadedStore.getSnapshot().messages).toHaveLength(1)
    expect(reloadedStore.getAssignment('assignment-1')?.status).toBe('requested')
  })

  it('rejects a message sent to a different server authority', () => {
    expect(() => router.send(request({
      sender: { serverId: 'linux', agentSessionId: 'coordinator' },
      recipient: { serverId: 'windows', agentSessionId: 'worker' },
    }))).toThrow('does not involve server mac')
  })

  it('accumulates progress receipts and artifact references', () => {
    router.send(request())
    router.send(request({
      messageId: 'message-2', sequence: 2, kind: 'progress', artifactIds: ['log-1'], payload: { percent: 50 },
    }))
    const result = router.send(request({
      messageId: 'message-3', sequence: 3, kind: 'result', artifactIds: ['package-1'], payload: { tests: 'passed' },
    }))
    expect(result.assignment.status).toBe('completed')
    expect(result.assignment.artifactIds).toEqual(['log-1', 'package-1'])
    expect(result.assignment.lastSequence).toBe(3)
  })
})
