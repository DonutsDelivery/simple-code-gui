/**
 * PTY WebSocket Management
 *
 * Manages WebSocket connections for PTY data streaming.
 */

import { MAX_RECONNECT_ATTEMPTS, RECONNECT_DELAYS } from './constants'
import { PtyWebSocketState } from './types'
import { requestWebSocketTicket } from './websocket-ticket.js'
import type { PtyGeometry } from '../../../common/pty-geometry.js'

function readGeometry(value: unknown): PtyGeometry | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PtyGeometry>
  if (!Number.isInteger(candidate.cols) || !Number.isInteger(candidate.rows)
    || !Number.isInteger(candidate.generation) || typeof candidate.canResize !== 'boolean') return null
  if ((candidate.cols ?? 0) < 1 || (candidate.rows ?? 0) < 1) return null
  return candidate as PtyGeometry
}

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
    // Keep an exhausted tombstone until explicit disconnect. Otherwise a
    // remount or authority poll recreates the dead PTY state and starts another
    // complete retry cycle forever.
    if (existing && existing.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return
    if (this.connecting.has(ptyId)) return

    this.connecting.add(ptyId)
    let ticket: string
    try {
      ticket = await requestWebSocketTicket(this.wsBaseUrl, this.token, `/api/pty/${encodeURIComponent(ptyId)}/stream`)
    } catch {
      this.connecting.delete(ptyId)
      // Only retry while the pty is still tracked. A failed ticket fetch is
      // often the server rate-limiting a reconnect storm — retrying blindly
      // here (no ownership check, no attempt cap) is an unbounded loop that
      // hammers the rate limiter and starves every other request. The tracked
      // state still exists, so a bounded retry is fine; an abandoned/untracked
      // pty must not reconnect at all.
      const state = this.ptyWebsockets.get(ptyId)
      if (state && state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        state.reconnectAttempts += 1
        setTimeout(() => this.connectPtyStream(ptyId), RECONNECT_DELAYS[0])
      }
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
      geometryCallbacks: new Set(),
      geometry: null,
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

          case 'connected': {
            const geometry = readGeometry(msg.geometry)
            if (geometry) {
              state.geometry = geometry
              state.geometryCallbacks.forEach(callback => callback(geometry))
            }
            console.log(
              '[HttpBackend] PTY stream confirmed:',
              ptyId,
              'callbacks:',
              state.dataCallbacks.size,
              'buffered:',
              state.dataBuffer.length
            )
            break
          }

          case 'geometry': {
            const geometry = readGeometry(msg.geometry)
            if (geometry && (!state.geometry || geometry.generation >= state.geometry.generation)) {
              state.geometry = geometry
              state.geometryCallbacks.forEach(callback => callback(geometry))
            }
            break
          }

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

      // Only the currently-tracked socket may schedule a reconnect. If
      // disconnectPtyStream() (e.g. after a harness switch or tab close) has
      // already removed this pty's entry, this socket is orphaned — its close
      // event is the tail end of a deliberate teardown and must NOT start a
      // reconnect loop against the dead/old pty (each attempt burns a rate
      // limit and keeps the stale tab alive).
      if (this.ptyWebsockets.get(ptyId) !== state) {
        return
      }

      // Attempt reconnection if not a clean close and we still want this PTY
      if (!event.wasClean && state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay =
          RECONNECT_DELAYS[Math.min(state.reconnectAttempts, RECONNECT_DELAYS.length - 1)]
        console.log(`[HttpBackend] Reconnecting PTY stream in ${delay}ms...`)

        state.reconnectTimer = setTimeout(() => {
          state.reconnectTimer = null
          state.reconnectAttempts++
          this.connectPtyStream(ptyId)
        }, delay)
      } else if (event.code !== 1000) {
        // Exit callback for abnormal closure
        state.exitCallbacks.forEach((cb) => cb(-1))
        state.reconnectAttempts = MAX_RECONNECT_ATTEMPTS
        state.reconnectTimer = null
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
