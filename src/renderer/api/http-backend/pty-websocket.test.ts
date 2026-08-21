import { afterEach, describe, expect, it, vi } from 'vitest'
import { PtyWebSocketManager } from './pty-websocket'

class FakeWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  close = (code?: number) => {
    // Simulate the socket closing. A client-requested close (1000) is clean;
    // anything else is an abnormal server-side teardown (e.g. 1006).
    this.readyState = FakeWebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ code: code ?? 1006, reason: code === 1000 ? 'clean' : 'abnormal', wasClean: code === 1000 })
    }
  }

  constructor() {
    instances.push(this)
  }
}

const instances: FakeWebSocket[] = []

// Ticket endpoint is requested per connect attempt.
let ticketCalls = 0
function stubFetch() {
  ticketCalls = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    ticketCalls += 1
    return new Response(JSON.stringify({ ticket: `ticket-${ticketCalls}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }))
}

function stubWebSocket() {
  instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('PtyWebSocketManager reconnect ownership', () => {
  it('does not schedule a reconnect when the pty was deliberately disconnected', async () => {
    vi.useFakeTimers()
    stubFetch()
    stubWebSocket()

    const manager = new PtyWebSocketManager('wss://localhost', 'token')
    manager.connectPtyStream('pty-a')

    // Let the ticket fetch settle, then simulate the opened socket.
    await vi.advanceTimersByTimeAsync(0)
    expect(instances.length).toBe(1)
    instances[0].onopen?.()

    // Deliberate teardown: disconnectPtyStream removes the entry and closes.
    manager.disconnectPtyStream('pty-a')
    // The close handler runs asynchronously; its reconnect branch must no-op.
    await vi.advanceTimersByTimeAsync(60_000)

    // Only the original connect happened — no reconnect attempts were spawned.
    expect(ticketCalls).toBe(1)
    expect(instances.length).toBe(1)
  })

  it('still reconnects a live pty after an abnormal server-side close', async () => {
    vi.useFakeTimers()
    stubFetch()
    stubWebSocket()

    const manager = new PtyWebSocketManager('wss://localhost', 'token')
    manager.connectPtyStream('pty-b')
    await vi.advanceTimersByTimeAsync(0)
    expect(instances.length).toBe(1)
    instances[0].onopen?.()

    // Server drops the socket abnormally — the pty is still tracked, so the
    // manager should reconnect.
    instances[0].close(1006)
    await vi.advanceTimersByTimeAsync(2000)

    expect(ticketCalls).toBeGreaterThanOrEqual(2)
    expect(instances.length).toBeGreaterThanOrEqual(2)
  })

  it('does not loop forever when the ticket fetch keeps failing', async () => {
    vi.useFakeTimers()
    stubWebSocket()
    // Ticket endpoint always fails (e.g. the server rate-limits the storm).
    let fetchFailures = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchFailures += 1
      throw new Error('rate limited')
    }))

    const manager = new PtyWebSocketManager('wss://localhost', 'token')
    manager.connectPtyStream('pty-c')
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    // Bounded: MAX_RECONNECT_ATTEMPTS (5) + the initial attempt.
    expect(fetchFailures).toBeLessThanOrEqual(6)
    // No WebSocket was ever created (every ticket fetch failed).
    expect(instances.length).toBe(0)
  })

  it('publishes canonical geometry and ignores stale generations', async () => {
    vi.useFakeTimers()
    stubFetch()
    stubWebSocket()

    const manager = new PtyWebSocketManager('wss://localhost', 'token')
    manager.connectPtyStream('pty-geometry')
    await vi.advanceTimersByTimeAsync(0)
    const state = manager.getPtyWebsockets().get('pty-geometry')!
    const observed: unknown[] = []
    state.geometryCallbacks.add(geometry => observed.push(geometry))

    instances[0].onmessage?.({ data: JSON.stringify({
      type: 'connected',
      geometry: { cols: 319, rows: 73, generation: 4, canResize: false },
    }) })
    instances[0].onmessage?.({ data: JSON.stringify({
      type: 'geometry',
      geometry: { cols: 80, rows: 24, generation: 3, canResize: false },
    }) })

    expect(observed).toEqual([{ cols: 319, rows: 73, generation: 4, canResize: false }])
    expect(state.geometry).toEqual({ cols: 319, rows: 73, generation: 4, canResize: false })
  })
})
