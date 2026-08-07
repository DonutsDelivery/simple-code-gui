/**
 * PTY WebSocket Management
 *
 * Manages WebSocket connections for PTY data streaming.
 */

import { MAX_RECONNECT_ATTEMPTS, RECONNECT_DELAYS } from './constants'
import { PtyWebSocketState } from './types'
import { requestWebSocketTicket } from './websocket-ticket.js'

export class PtyWebSocketManager {
  private ptyWebsockets: Map<string, PtyWebSocketState> = new Map()
  private wsBaseUrl: string
  private token: string
  private connecting = new Set<string>()

  constructor(wsBaseUrl: string, token: string) {
    this.wsBaseUrl = wsBaseUrl
    this.token = token
  }

  getPtyWebsockets(): Map<string, PtyWebSocketState> {
    return this.ptyWebsockets
  }

  /**
   * Connect WebSocket for PTY data streaming
   */
  connectPtyStream(ptyId: string): void {
    void this.connectPtyStreamWithTicket(ptyId)
  }

  private async connectPtyStreamWithTicket(ptyId: string): Promise<void> {
    // Don't reconnect if already connected or connecting
    const existing = this.ptyWebsockets.get(ptyId)
    if (
      existing?.ws &&
      (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING)
    ) {
      return
    }
    if (this.connecting.has(ptyId)) return

    this.connecting.add(ptyId)
    let ticket: string
    try {
      ticket = await requestWebSocketTicket(this.wsBaseUrl, this.token, `/api/pty/${encodeURIComponent(ptyId)}/stream`)
    } catch {
      this.connecting.delete(ptyId)
      setTimeout(() => this.connectPtyStream(ptyId), RECONNECT_DELAYS[0])
      return
    }
    this.connecting.delete(ptyId)
    const url = `${this.wsBaseUrl}/api/pty/${ptyId}/stream`
    console.log('[HttpBackend] Connecting PTY stream:', ptyId)

    const ws = new WebSocket(url, [`ticket-${ticket}`])

    // Reuse the CURRENT state if available, otherwise create new. Note: the
    // `existing` snapshot taken before the ticket fetch is deliberately NOT
    // used here — the async ticket round-trip gives onPtyData/onPtyExit a
    // window to register callbacks on a fresh state entry (created with
    // ws:null), and reusing the stale snapshot would replace that entry with
    // an empty one, silently losing the callbacks and leaving the terminal
    // blank (data would buffer forever with no subscriber).
    const state: PtyWebSocketState = this.ptyWebsockets.get(ptyId) || {
      ws,
      dataCallbacks: new Set(),
      exitCallbacks: new Set(),
      reconnectAttempts: 0,
      reconnectTimer: null,
      dataBuffer: []
    }
    // Update the WebSocket reference
    state.ws = ws
    state.reconnectAttempts = state.reconnectAttempts || 0

    ws.onopen = () => {
      console.log('[HttpBackend] PTY stream connected:', ptyId)
      state.reconnectAttempts = 0
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

        switch (msg.type) {
          case 'data':
            // Buffer data if no callbacks registered yet
            if (state.dataCallbacks.size === 0) {
              state.dataBuffer.push(msg.data)
              // Limit buffer size to prevent memory issues
              if (state.dataBuffer.length > 1000) {
                state.dataBuffer.shift()
              }
            } else {
              // Forward data to all callbacks
              state.dataCallbacks.forEach((cb) => cb(msg.data))
            }
            break

          case 'exit':
            // Forward exit to all callbacks
            state.exitCallbacks.forEach((cb) => cb(msg.code))
            // Clean up after exit
            this.ptyWebsockets.delete(ptyId)
            break

          case 'connected':
            console.log(
              '[HttpBackend] PTY stream confirmed:',
              ptyId,
              'callbacks:',
              state.dataCallbacks.size,
              'buffered:',
              state.dataBuffer.length
            )
            break

          case 'pong':
            // Keep-alive response, nothing to do
            break

          default:
            console.log('[HttpBackend] Unknown PTY message type:', msg.type)
        }
      } catch (e) {
        console.error('[HttpBackend] Failed to parse PTY message:', e)
      }
    }

    ws.onerror = (event) => {
      console.error('[HttpBackend] PTY stream error:', ptyId, event)
    }

    ws.onclose = (event) => {
      console.log('[HttpBackend] PTY stream closed:', ptyId, event.code, event.reason)

      // Attempt reconnection if not a clean close and we still want this PTY
      if (!event.wasClean && state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay =
          RECONNECT_DELAYS[Math.min(state.reconnectAttempts, RECONNECT_DELAYS.length - 1)]
        console.log(`[HttpBackend] Reconnecting PTY stream in ${delay}ms...`)

        state.reconnectTimer = setTimeout(() => {
          state.reconnectAttempts++
          this.connectPtyStream(ptyId)
        }, delay)
      } else if (event.code !== 1000) {
        // Exit callback for abnormal closure
        state.exitCallbacks.forEach((cb) => cb(-1))
        this.ptyWebsockets.delete(ptyId)
      }
    }

    this.ptyWebsockets.set(ptyId, state)
  }

  /**
   * Disconnect PTY WebSocket stream
   */
  disconnectPtyStream(ptyId: string): void {
    const state = this.ptyWebsockets.get(ptyId)
    if (!state) return

    // Clear reconnect timer
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
    }

    // Close WebSocket
    if (
      state.ws &&
      (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)
    ) {
      state.ws.close(1000, 'Client requested close')
    }

    this.ptyWebsockets.delete(ptyId)
  }

  /**
   * Disconnect all PTY WebSocket connections
   */
  disconnectAll(): void {
    this.ptyWebsockets.forEach((state, ptyId) => {
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer)
      }
      if (
        state.ws &&
        (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)
      ) {
        state.ws.close(1000, 'Client disconnecting')
      }
    })
    this.ptyWebsockets.clear()
  }

  /**
   * Send data to a PTY via WebSocket
   */
  sendToPty(ptyId: string, message: object): boolean {
    const state = this.ptyWebsockets.get(ptyId)
    if (state && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(message))
      return true
    }
    return false
  }
}
