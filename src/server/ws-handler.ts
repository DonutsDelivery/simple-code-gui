/**
 * WebSocket Handler
 *
 * Handles real-time bidirectional communication for terminal streaming.
 * Provides WebSocket endpoints for terminal data, input, and control messages.
 */

import { Server as HttpServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import {
  WsMessage,
  WsMessageType,
  WsTerminalDataPayload,
  WsTerminalExitPayload,
  WsAuthPayload
} from './types'
import { validateToken } from './auth'
import { getServices } from './app'
import { removeSession } from './routes/terminal'

// =============================================================================
// Types
// =============================================================================

interface AuthenticatedClient {
  ws: WebSocket
  token: string
  subscribedTerminals: Set<string> // ptyIds this client is subscribed to
  lastPing: number
}

// =============================================================================
// WebSocket Handler Class
// =============================================================================

export class WebSocketHandler {
  private wss: WebSocketServer
  private clients: Map<WebSocket, AuthenticatedClient> = new Map()
  private terminalUnsubscribers: Map<string, () => void> = new Map() // ptyId -> unsubscribe fn
  private maxConnections: number
  private pingInterval: NodeJS.Timeout | null = null

  constructor(server: HttpServer, maxConnections: number = 10) {
    this.maxConnections = maxConnections

    // Create WebSocket server attached to HTTP server
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      maxPayload: 1024 * 1024 // 1MB max message size
    })

    this.wss.on('connection', this.handleConnection.bind(this))
    this.wss.on('error', (error) => {
      console.error('[WS Handler] Server error:', error)
    })

    // Start ping interval to detect dead connections
    this.pingInterval = setInterval(() => this.pingClients(), 30000)

    console.log('[WS Handler] WebSocket server initialized')
  }

  // ===========================================================================
  // Connection Handling
  // ===========================================================================

  private handleConnection(ws: WebSocket): void {
    // Check connection limit
    if (this.clients.size >= this.maxConnections) {
      this.sendError(ws, 'Connection limit reached')
      ws.close(1013, 'Connection limit reached')
      return
    }

    console.log('[WS Handler] New connection, awaiting authentication...')

    // Create unauthenticated client entry
    const client: AuthenticatedClient = {
      ws,
      token: '',
      subscribedTerminals: new Set(),
      lastPing: Date.now()
    }

    // Set authentication timeout
    const authTimeout = setTimeout(() => {
      if (!client.token) {
        console.log('[WS Handler] Authentication timeout')
        this.sendError(ws, 'Authentication timeout')
        ws.close(1008, 'Authentication timeout')
      }
    }, 10000) // 10 second auth timeout

    // Handle messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WsMessage

        // First message must be auth
        if (!client.token) {
          if (message.type === 'auth') {
            this.handleAuth(client, message.payload as WsAuthPayload, authTimeout)
          } else {
            this.sendError(ws, 'Authentication required')
          }
          return
        }

        // Handle authenticated messages
        this.handleMessage(client, message)
      } catch (error) {
        console.error('[WS Handler] Message parse error:', error)
        this.sendError(ws, 'Invalid message format')
      }
    })

    ws.on('close', () => {
      clearTimeout(authTimeout)
      this.handleDisconnect(client)
    })

    ws.on('error', (error) => {
      console.error('[WS Handler] Client error:', error)
    })

    ws.on('pong', () => {
      client.lastPing = Date.now()
    })
  }

  private handleAuth(
    client: AuthenticatedClient,
    payload: WsAuthPayload,
    authTimeout: NodeJS.Timeout
  ): void {
    if (!payload?.token) {
      this.sendError(client.ws, 'Token required')
      client.ws.close(1008, 'Token required')
      return
    }

    const token = validateToken(payload.token)
    if (!token) {
      this.send(client.ws, {
        type: 'auth:failure',
        payload: { error: 'Invalid or expired token' },
        timestamp: Date.now()
      })
      client.ws.close(1008, 'Invalid token')
      return
    }

    // Authentication successful
    clearTimeout(authTimeout)
    client.token = token.token
    this.clients.set(client.ws, client)

    console.log('[WS Handler] Client authenticated')

    this.send(client.ws, {
      type: 'auth:success',
      payload: { message: 'Authenticated successfully' },
      timestamp: Date.now()
    })
  }

  private handleDisconnect(client: AuthenticatedClient): void {
    console.log('[WS Handler] Client disconnected')

    // Unsubscribe from all terminals
    for (const ptyId of client.subscribedTerminals) {
      this.unsubscribeFromTerminal(client, ptyId)
    }

    this.clients.delete(client.ws)
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  private handleMessage(client: AuthenticatedClient, message: WsMessage): void {
    switch (message.type) {
      case 'ping':
        this.send(client.ws, { type: 'pong', timestamp: Date.now() })
        break

      case 'terminal:write':
        this.handleTerminalWrite(client, message)
        break

      case 'terminal:resize':
        this.handleTerminalResize(client, message)
        break

      default:
        // Check for subscribe/unsubscribe in payload
        if ((message as any).action === 'subscribe' && message.ptyId) {
          this.subscribeToTerminal(client, message.ptyId)
        } else if ((message as any).action === 'unsubscribe' && message.ptyId) {
          this.unsubscribeFromTerminal(client, message.ptyId)
        } else {
          this.sendError(client.ws, `Unknown message type: ${message.type}`)
        }
    }
  }

  private handleTerminalWrite(client: AuthenticatedClient, message: WsMessage): void {
    const services = getServices()

    if (!services.writePty) {
      this.sendError(client.ws, 'Terminal service not available')
      return
    }

    if (!message.ptyId) {
      this.sendError(client.ws, 'ptyId required for terminal:write')
      return
    }

    const payload = message.payload as WsTerminalDataPayload
    if (!payload?.data) {
      this.sendError(client.ws, 'data required in payload')
      return
    }

    services.writePty(message.ptyId, payload.data)
  }

  private handleTerminalResize(client: AuthenticatedClient, message: WsMessage): void {
    const services = getServices()

    if (!services.resizePty) {
      this.sendError(client.ws, 'Terminal service not available')
      return
    }

    if (!message.ptyId) {
      this.sendError(client.ws, 'ptyId required for terminal:resize')
      return
    }

    const payload = message.payload as { cols: number; rows: number }
    if (typeof payload?.cols !== 'number' || typeof payload?.rows !== 'number') {
      this.sendError(client.ws, 'cols and rows required in payload')
      return
    }

    services.resizePty(message.ptyId, payload.cols, payload.rows)
  }

  // ===========================================================================
  // Terminal Subscription
  // ===========================================================================

  private subscribeToTerminal(client: AuthenticatedClient, ptyId: string): void {
    const services = getServices()

    if (!services.onPtyData || !services.onPtyExit) {
      this.sendError(client.ws, 'Terminal service not available')
      return
    }

    // Check if already subscribed
    if (client.subscribedTerminals.has(ptyId)) {
      return
    }

    client.subscribedTerminals.add(ptyId)

    // Set up data listener if not already listening
    if (!this.terminalUnsubscribers.has(ptyId)) {
      const dataUnsub = services.onPtyData(ptyId, (data: string) => {
        this.broadcastToSubscribers(ptyId, {
          type: 'terminal:data',
          ptyId,
          payload: { data } as WsTerminalDataPayload,
          timestamp: Date.now()
        })
      })

      const exitUnsub = services.onPtyExit(ptyId, (code: number) => {
        this.broadcastToSubscribers(ptyId, {
          type: 'terminal:exit',
          ptyId,
          payload: { code } as WsTerminalExitPayload,
          timestamp: Date.now()
        })

        // Clean up
        removeSession(ptyId)
        this.terminalUnsubscribers.delete(ptyId)

        // Unsubscribe all clients from this terminal
        for (const [, client] of this.clients) {
          client.subscribedTerminals.delete(ptyId)
        }
      })

      // Store combined unsubscriber
      this.terminalUnsubscribers.set(ptyId, () => {
        dataUnsub()
        exitUnsub()
      })
    }

    console.log(`[WS Handler] Client subscribed to terminal ${ptyId}`)
  }

  private unsubscribeFromTerminal(client: AuthenticatedClient, ptyId: string): void {
    client.subscribedTerminals.delete(ptyId)

    // Check if any clients are still subscribed
    let anySubscribed = false
    for (const [, c] of this.clients) {
      if (c.subscribedTerminals.has(ptyId)) {
        anySubscribed = true
        break
      }
    }

    // If no clients subscribed, clean up listener
    if (!anySubscribed) {
      const unsub = this.terminalUnsubscribers.get(ptyId)
      if (unsub) {
        unsub()
        this.terminalUnsubscribers.delete(ptyId)
      }
    }

    console.log(`[WS Handler] Client unsubscribed from terminal ${ptyId}`)
  }

  private broadcastToSubscribers(ptyId: string, message: WsMessage): void {
    for (const [, client] of this.clients) {
      if (client.subscribedTerminals.has(ptyId) && client.ws.readyState === WebSocket.OPEN) {
        this.send(client.ws, message)
      }
    }
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  private send(ws: WebSocket, message: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  private sendError(ws: WebSocket, error: string): void {
    this.send(ws, {
      type: 'error',
      payload: { error },
      timestamp: Date.now()
    })
  }

  private pingClients(): void {
    const now = Date.now()
    const timeout = 60000 // 60 seconds

    for (const [ws, client] of this.clients) {
      if (now - client.lastPing > timeout) {
        console.log('[WS Handler] Terminating inactive client')
        ws.terminate()
        this.clients.delete(ws)
      } else if (ws.readyState === WebSocket.OPEN) {
        ws.ping()
      }
    }
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Get the number of connected clients
   */
  getConnectionCount(): number {
    return this.clients.size
  }

  /**
   * Broadcast a message to all authenticated clients
   */
  broadcast(message: WsMessage): void {
    for (const [, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        this.send(client.ws, message)
      }
    }
  }

  /**
   * Close all connections and clean up
   */
  closeAll(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }

    // Unsubscribe all terminal listeners
    for (const unsub of this.terminalUnsubscribers.values()) {
      unsub()
    }
    this.terminalUnsubscribers.clear()

    // Close all client connections
    for (const [ws] of this.clients) {
      ws.close(1001, 'Server shutting down')
    }
    this.clients.clear()

    // Close WebSocket server
    this.wss.close()

    console.log('[WS Handler] All connections closed')
  }
}
