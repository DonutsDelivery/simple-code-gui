import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSessionSignalConnection } from './agent-session-signals'

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: MockWebSocket[] = []

  readonly url: string
  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  send = vi.fn()
  close = vi.fn((code = 1000) => {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code } as CloseEvent)
  })

  constructor(url: string, _protocols?: string[]) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent)
  }
}

describe('HTTP agent session signal connection', () => {
  const nextSocket = async (index = 0): Promise<MockWebSocket> => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    return MockWebSocket.instances[index]
  }

  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: 'single-use-ticket' }),
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // AC: @agent-session-notifications ac-1
  // AC: @agent-session-notifications ac-2
  it('delivers authenticated main-socket signals and supports unsubscribe', async () => {
    const connection = new AgentSessionSignalConnection('ws://host:38470', 'secret token')
    const listener = vi.fn()
    const unsubscribe = connection.subscribe(listener)
    const socket = await nextSocket()

    expect(socket.url).toBe('ws://host:38470/ws')
    expect(fetch).toHaveBeenCalledWith('http://host:38470/api/auth/websocket-ticket', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret token' }),
      body: JSON.stringify({ purpose: '/ws' }),
    }))
    socket.receive({
      type: 'agent-session-signal',
      signal: { ptyId: 'pty-background', type: 'input-needed' },
    })
    expect(listener).toHaveBeenCalledWith({ ptyId: 'pty-background', type: 'input-needed' })

    unsubscribe()
    socket.receive({
      type: 'agent-session-signal',
      signal: { ptyId: 'pty-background', type: 'complete' },
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(socket.close).toHaveBeenCalledWith(1000, 'Client disconnecting')
  })

  // AC: @agent-session-notifications ac-1
  // AC: @agent-session-notifications ac-2
  it('closes a half-open signal socket when heartbeat responses stop', async () => {
    vi.useFakeTimers()
    const connection = new AgentSessionSignalConnection('ws://host:38470', 'secret')
    connection.subscribe(vi.fn())
    const socket = await nextSocket()
    socket.readyState = MockWebSocket.OPEN
    socket.onopen?.()

    vi.advanceTimersByTime(30_000)
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"ping"'))

    vi.advanceTimersByTime(10_000)
    expect(socket.close).toHaveBeenCalledWith(4000, 'Heartbeat timeout')
  })

  // AC: @agent-session-notifications ac-1
  it('does not reconnect after an explicit backend disconnect', async () => {
    const connection = new AgentSessionSignalConnection('ws://host:38470', 'secret')
    connection.subscribe(vi.fn())
    const socket = await nextSocket()

    connection.disconnect()
    socket.onclose?.({ code: 1006 } as CloseEvent)

    expect(MockWebSocket.instances).toHaveLength(1)
  })

  // AC: @agent-session-notifications ac-1
  it('keeps signals isolated between backend instances', async () => {
    const first = new AgentSessionSignalConnection('ws://first:38470', 'first')
    const second = new AgentSessionSignalConnection('ws://second:38470', 'second')
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    first.subscribe(firstListener)
    second.subscribe(secondListener)
    await nextSocket(1)

    MockWebSocket.instances[0].receive({
      type: 'agent-session-signal',
      signal: { ptyId: 'pty-first', type: 'complete' },
    })

    expect(firstListener).toHaveBeenCalledOnce()
    expect(secondListener).not.toHaveBeenCalled()
  })
})
