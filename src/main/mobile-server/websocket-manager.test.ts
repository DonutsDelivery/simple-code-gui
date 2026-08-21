import { createServer, type Server } from 'http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, type WebSocketServer } from 'ws'
import { canClientResizePty, canRemoteResizePty, setupWebSocket } from './websocket-manager'
import { issueWebSocketTicket } from './routes/auth'

vi.mock('./utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('./utils')>()
  return { ...original, log: vi.fn() }
})

let server: Server | null = null
let wss: WebSocketServer | null = null
let client: WebSocket | null = null

afterEach(async () => {
  client?.terminate()
  if (wss) await new Promise<void>(resolve => wss!.close(() => resolve()))
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
  client = null
  wss = null
  server = null
})

describe('main WebSocket environment synchronization', () => {
  it('sends the current authoritative snapshot immediately on connect', async () => {
    server = createServer()
    let port = 0
    const connectedClients = new Set<WebSocket>()
    wss = setupWebSocket(server, {
      getToken: () => 'test-token',
      getPtyManager: () => null,
      getPort: () => port,
      getTerminalSubscriptions: () => new Map(),
      getPtyStreams: () => new Map(),
      getPtyDataBuffer: () => new Map(),
      getConnectedClients: () => connectedClients,
      getPendingFiles: () => new Map(),
      getEnvironmentSnapshot: () => ({
        serverId: 'server-ws',
        revision: 7,
        workspace: { projects: [] },
        sessions: [],
        ptys: [],
      }),
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP address')
    port = address.port

    client = new WebSocket(`ws://127.0.0.1:${port}/ws`, [`ticket-${issueWebSocketTicket('test-token')}`])
    const messages = await new Promise<any[]>((resolve, reject) => {
      const received: any[] = []
      const timer = setTimeout(() => reject(new Error('Timed out waiting for synchronization messages')), 1000)
      client!.on('message', data => {
        received.push(JSON.parse(String(data)))
        if (received.length === 2) {
          clearTimeout(timer)
          resolve(received)
        }
      })
      client!.on('error', reject)
    })

    expect(messages[0]).toMatchObject({ type: 'connected' })
    expect(messages[1]).toMatchObject({
      type: 'environment-event',
      event: {
        serverId: 'server-ws',
        revision: 7,
        event: { type: 'environment-snapshot', snapshot: { revision: 7 } },
      },
    })
  })
})

describe('remote PTY resize ownership', () => {
  it('allows only remotely created PTYs to accept remote viewport dimensions', () => {
    const localPtys = new Map([['remote-created', {} as any]])
    const deps = { getLocalPtys: () => localPtys }
    expect(canRemoteResizePty('remote-created', deps)).toBe(true)
    expect(canRemoteResizePty('desktop-owned', deps)).toBe(false)
    expect(canRemoteResizePty('unknown', {})).toBe(false)
  })

  it('always lets the authority token resize its canonical PTY', () => {
    expect(canClientResizePty('desktop-owned', 'shared-host-token', { getLocalPtys: () => new Map() })).toBe(true)
  })

  it('advertises canonical geometry before replay bytes', async () => {
    server = createServer()
    let port = 0
    const ptyManager = {
      getProcess: () => ({}),
      getGeometry: () => ({ cols: 319, rows: 73, generation: 4 }),
      getReplayBytes: () => 'replay',
      getOutputSequence: () => 9,
      addDataListener: () => () => {},
      addExitListener: () => () => {},
      addResizeListener: () => () => {},
    }
    wss = setupWebSocket(server, {
      getToken: () => 'test-token',
      getPtyManager: () => ptyManager,
      getPort: () => port,
      getTerminalSubscriptions: () => new Map(),
      getPtyStreams: () => new Map(),
      getPtyDataBuffer: () => new Map(),
      getConnectedClients: () => new Set(),
      getPendingFiles: () => new Map(),
      getLocalPtys: () => new Map(),
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP address')
    port = address.port

    client = new WebSocket(
      `ws://127.0.0.1:${port}/api/pty/pty-a/stream`,
      [`ticket-${issueWebSocketTicket('test-token', '/api/pty/pty-a/stream')}`],
    )
    const messages = await new Promise<any[]>((resolve, reject) => {
      const received: any[] = []
      const timer = setTimeout(() => reject(new Error('Timed out waiting for PTY handshake')), 1000)
      client!.on('message', data => {
        received.push(JSON.parse(String(data)))
        if (received.length === 2) {
          clearTimeout(timer)
          resolve(received)
        }
      })
      client!.on('error', reject)
    })

    expect(messages[0]).toEqual({
      type: 'connected',
      ptyId: 'pty-a',
      geometry: { cols: 319, rows: 73, generation: 4, canResize: true },
    })
    expect(messages[1]).toMatchObject({
      type: 'data',
      data: 'replay',
      sequence: 9,
      geometryGeneration: 4,
      snapshot: true,
    })
  })
})
