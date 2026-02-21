/**
 * WebSocket Manager - WebSocket handling
 */

import { WebSocket, WebSocketServer } from 'ws'
import { Server } from 'http'
import { log } from './utils'
import { PendingFile } from './types'

export interface WebSocketManagerDeps {
  getToken: () => string
  getPtyManager: () => any
  getPort: () => number
  getTerminalSubscriptions: () => Map<string, Set<WebSocket>>
  getPtyStreams: () => Map<string, Set<WebSocket>>
  getPtyDataBuffer: () => Map<string, string[]>
  getConnectedClients: () => Set<WebSocket>
  getPendingFiles: () => Map<string, PendingFile>
}

export function setupWebSocket(server: Server, deps: WebSocketManagerDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  // Handle upgrade requests manually to support multiple paths
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://localhost:${deps.getPort()}`)
    const pathname = url.pathname

    // Get token from Sec-WebSocket-Protocol header (preferred) or query string (fallback)
    const protocolHeader = req.headers['sec-websocket-protocol'] as string | undefined
    const protocols = protocolHeader?.split(',').map(p => p.trim()) || []
    const tokenFromProtocol = protocols.find(p => p.startsWith('token-'))?.slice(6)
    const tokenFromQuery = url.searchParams.get('token')
    const token = tokenFromProtocol || tokenFromQuery

    log('WebSocket upgrade request', {
      url: req.url,
      pathname,
      hasProtocolToken: !!tokenFromProtocol,
      hasQueryToken: !!tokenFromQuery,
      headers: {
        host: req.headers.host,
        origin: req.headers.origin,
        upgrade: req.headers.upgrade
      }
    })

    // Validate token for all WebSocket connections
    if (token !== deps.getToken()) {
      log('WebSocket auth failed', { providedToken: token?.slice(0, 8) })
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    // Handle PTY stream WebSocket: /api/pty/:id/stream
    const ptyStreamMatch = pathname.match(/^\/api\/pty\/([^/]+)\/stream$/)
    if (ptyStreamMatch) {
      const ptyId = ptyStreamMatch[1]
      handlePtyStreamUpgrade(req, socket, head, ptyId, deps)
      return
    }

    // Handle main WebSocket path: /ws
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
      return
    }

    // Unknown WebSocket path
    log('Unknown WebSocket path', { pathname })
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
  })

  wss.on('connection', (ws: WebSocket, _req) => {
    log('WebSocket client connected (main)')

    deps.getConnectedClients().add(ws)

    ws.on('message', (message: Buffer) => {
      try {
        const msg = JSON.parse(message.toString())
        handleWebSocketMessage(ws, msg, deps)
      } catch (e) {
        log('Invalid WebSocket message', { error: String(e) })
      }
    })

    ws.on('close', () => {
      deps.getConnectedClients().delete(ws)

      deps.getTerminalSubscriptions().forEach((subscribers, ptyId) => {
        subscribers.delete(ws)
        if (subscribers.size === 0) {
          deps.getTerminalSubscriptions().delete(ptyId)
        }
      })
      log('WebSocket client disconnected (main)')
    })

    // Send welcome message
    ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }))

    // Send any pending files to new client
    sendPendingFilesToClient(ws, deps.getPendingFiles())
  })

  return wss
}

function handlePtyStreamUpgrade(
  req: any,
  socket: any,
  head: any,
  ptyId: string,
  deps: WebSocketManagerDeps
): void {
  const ptyManager = deps.getPtyManager()
  if (!ptyManager || !ptyManager.getProcess(ptyId)) {
    log('PTY stream upgrade failed - PTY not found', { ptyId })
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
    return
  }

  const streamWss = new WebSocketServer({ noServer: true })

  streamWss.handleUpgrade(req, socket, head, (ws) => {
    log('PTY stream connected', { ptyId })

    const ptyStreams = deps.getPtyStreams()
    if (!ptyStreams.has(ptyId)) {
      ptyStreams.set(ptyId, new Set())
    }
    ptyStreams.get(ptyId)!.add(ws)

    ws.send(JSON.stringify({ type: 'connected', ptyId }))

    // Flush any buffered data
    flushPtyBuffer(ptyId, ws, deps.getPtyDataBuffer())

    ws.on('message', (message: Buffer) => {
      try {
        const msg = JSON.parse(message.toString())

        switch (msg.type) {
          case 'input':
            if (msg.data && ptyManager) {
              ptyManager.write(ptyId, msg.data)
            }
            break

          case 'resize':
            if (msg.cols && msg.rows && ptyManager) {
              ptyManager.resize(ptyId, msg.cols, msg.rows)
            }
            break

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
            break

          default:
            log('Unknown PTY stream message type', { type: msg.type, ptyId })
        }
      } catch (e) {
        log('Invalid PTY stream message', { error: String(e), ptyId })
      }
    })

    ws.on('close', () => {
      log('PTY stream disconnected', { ptyId })
      ptyStreams.get(ptyId)?.delete(ws)
      if (ptyStreams.get(ptyId)?.size === 0) {
        ptyStreams.delete(ptyId)
      }
    })

    ws.on('error', (err) => {
      log('PTY stream error', { error: String(err), ptyId })
      ptyStreams.get(ptyId)?.delete(ws)
    })
  })
}

function handleWebSocketMessage(ws: WebSocket, msg: any, deps: WebSocketManagerDeps): void {
  const ptyManager = deps.getPtyManager()
  const terminalSubscriptions = deps.getTerminalSubscriptions()

  switch (msg.type) {
    case 'subscribe':
      if (msg.ptyId) {
        if (!terminalSubscriptions.has(msg.ptyId)) {
          terminalSubscriptions.set(msg.ptyId, new Set())
        }
        terminalSubscriptions.get(msg.ptyId)!.add(ws)
        ws.send(JSON.stringify({ type: 'subscribed', ptyId: msg.ptyId }))
      }
      break

    case 'unsubscribe':
      if (msg.ptyId) {
        terminalSubscriptions.get(msg.ptyId)?.delete(ws)
      }
      break

    case 'write':
      if (msg.ptyId && msg.data && ptyManager) {
        ptyManager.write(msg.ptyId, msg.data)
      }
      break

    case 'resize':
      if (msg.ptyId && msg.cols && msg.rows && ptyManager) {
        ptyManager.resize(msg.ptyId, msg.cols, msg.rows)
      }
      break

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
      break
  }
}

function flushPtyBuffer(ptyId: string, ws: WebSocket, ptyDataBuffer: Map<string, string[]>): void {
  const buffer = ptyDataBuffer.get(ptyId)
  if (!buffer || buffer.length === 0) return

  buffer.forEach(data => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data }))
    }
  })

  ptyDataBuffer.delete(ptyId)
}

function sendPendingFilesToClient(ws: WebSocket, pendingFiles: Map<string, PendingFile>): void {
  const now = Date.now()
  // Clean up expired files first
  for (const [fileId, file] of pendingFiles) {
    if (file.expiresAt < now) {
      pendingFiles.delete(fileId)
    }
  }

  const files = Array.from(pendingFiles.values()).map(f => ({
    id: f.id,
    name: f.name,
    size: f.size,
    mimeType: f.mimeType,
    message: f.message
  }))

  if (files.length > 0) {
    ws.send(JSON.stringify({ type: 'files:pending', files }))
  }
}

export function broadcastTerminalData(
  ptyId: string,
  data: string,
  terminalSubscriptions: Map<string, Set<WebSocket>>
): void {
  const subscribers = terminalSubscriptions.get(ptyId)
  if (!subscribers) return

  const message = JSON.stringify({
    type: 'terminal-data',
    ptyId,
    data
  })

  subscribers.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message)
    }
  })
}

export function broadcastPtyData(
  ptyId: string,
  data: string,
  ptyStreams: Map<string, Set<WebSocket>>,
  ptyDataBuffer: Map<string, string[]>
): void {
  const streams = ptyStreams.get(ptyId)

  // If no streams connected, buffer the data
  if (!streams || streams.size === 0) {
    if (!ptyDataBuffer.has(ptyId)) {
      ptyDataBuffer.set(ptyId, [])
    }
    const buffer = ptyDataBuffer.get(ptyId)!
    buffer.push(data)
    // Limit buffer size
    if (buffer.length > 1000) {
      buffer.shift()
    }
    return
  }

  const message = JSON.stringify({
    type: 'data',
    data
  })

  streams.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message)
    }
  })
}

export function broadcastPtyExit(
  ptyId: string,
  code: number,
  ptyStreams: Map<string, Set<WebSocket>>
): void {
  const streams = ptyStreams.get(ptyId)
  if (!streams || streams.size === 0) return

  const message = JSON.stringify({
    type: 'exit',
    code
  })

  streams.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message)
      ws.close(1000, 'PTY exited')
    }
  })
}
