/**
 * PTY API Methods
 *
 * PTY management methods for the HTTP backend.
 */

import {
  PtyDataCallback,
  PtyExitCallback,
  PtyRecreatedCallback,
  Unsubscribe,
  BackendId
} from '../types'
import { ConnectionManager } from './connection'
import { PtyWebSocketManager } from './pty-websocket'
import { PtyWebSocketState } from './types'

export class PtyApi {
  private connection: ConnectionManager
  private wsManager: PtyWebSocketManager
  private ptyRecreatedCallbacks: Set<PtyRecreatedCallback> = new Set()

  constructor(connection: ConnectionManager, wsManager: PtyWebSocketManager) {
    this.connection = connection
    this.wsManager = wsManager
  }

  async spawnPty(cwd: string, sessionId?: string, model?: string, backend?: BackendId): Promise<string> {
    this.connection.setConnectionState('connecting')

    const data = await this.connection.fetchJson<{ ptyId: string }>('/api/pty/spawn', {
      method: 'POST',
      body: JSON.stringify({
        projectPath: cwd,
        sessionId,
        model,
        backend
      })
    })

    // Connect WebSocket for this PTY's data stream
    this.wsManager.connectPtyStream(data.ptyId)

    return data.ptyId
  }

  killPty(id: string): void {
    // Disconnect WebSocket first
    this.wsManager.disconnectPtyStream(id)

    // Then send kill request (fire and forget)
    this.connection.fetch(`/api/pty/${id}`, { method: 'DELETE' }).catch((err) => {
      console.error('[HttpBackend] Failed to kill PTY:', err)
    })
  }

  writePty(id: string, data: string): void {
    // Prefer WebSocket if connected
    if (this.wsManager.sendToPty(id, { type: 'input', data })) {
      return
    }

    // Fall back to HTTP
    this.connection
      .fetch(`/api/pty/${id}/write`, {
        method: 'POST',
        body: JSON.stringify({ data })
      })
      .catch((err) => {
        console.error('[HttpBackend] Failed to write to PTY:', err)
      })
  }

  resizePty(id: string, cols: number, rows: number): void {
    // Prefer WebSocket if connected
    if (this.wsManager.sendToPty(id, { type: 'resize', cols, rows })) {
      return
    }

    // Fall back to HTTP
    this.connection
      .fetch(`/api/pty/${id}/resize`, {
        method: 'POST',
        body: JSON.stringify({ cols, rows })
      })
      .catch((err) => {
        console.error('[HttpBackend] Failed to resize PTY:', err)
      })
  }

  onPtyData(id: string, callback: PtyDataCallback): Unsubscribe {
    const ptyWebsockets = this.wsManager.getPtyWebsockets()

    // Ensure WebSocket is connected
    let state = ptyWebsockets.get(id)
    if (!state) {
      // Create state but don't connect yet (might be called before spawnPty returns)
      state = {
        ws: null as any, // Will be set by connectPtyStream
        dataCallbacks: new Set(),
        exitCallbacks: new Set(),
        reconnectAttempts: 0,
        reconnectTimer: null,
        dataBuffer: []
      }
      ptyWebsockets.set(id, state)
    }

    state.dataCallbacks.add(callback)

    // Flush any buffered data to this callback
    if (state.dataBuffer.length > 0) {
      console.log(
        '[HttpBackend] Flushing',
        state.dataBuffer.length,
        'buffered messages to callback for PTY:',
        id
      )
      const bufferedData = [...state.dataBuffer]
      state.dataBuffer = []
      // Send buffered data to all callbacks (not just this one, in case multiple registered)
      for (const data of bufferedData) {
        state.dataCallbacks.forEach((cb) => cb(data))
      }
    }

    // If WebSocket isn't connected, try to connect
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      this.wsManager.connectPtyStream(id)
    }

    return () => {
      const s = ptyWebsockets.get(id)
      if (s) {
        s.dataCallbacks.delete(callback)
      }
    }
  }

  onPtyExit(id: string, callback: PtyExitCallback): Unsubscribe {
    const ptyWebsockets = this.wsManager.getPtyWebsockets()

    let state = ptyWebsockets.get(id)
    if (!state) {
      state = {
        ws: null as any,
        dataCallbacks: new Set(),
        exitCallbacks: new Set(),
        reconnectAttempts: 0,
        reconnectTimer: null,
        dataBuffer: []
      }
      ptyWebsockets.set(id, state)
    }

    state.exitCallbacks.add(callback)

    return () => {
      const s = ptyWebsockets.get(id)
      if (s) {
        s.exitCallbacks.delete(callback)
      }
    }
  }

  onPtyRecreated(callback: PtyRecreatedCallback): Unsubscribe {
    this.ptyRecreatedCallbacks.add(callback)
    return () => {
      this.ptyRecreatedCallbacks.delete(callback)
    }
  }
}
