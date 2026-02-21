/**
 * HTTP Backend Types
 *
 * Interfaces and type definitions for the HTTP backend implementation.
 */

import { PtyDataCallback, PtyExitCallback } from '../types'

export interface HttpBackendConfig {
  host: string
  port: number
  token: string
}

export interface PtyWebSocketState {
  ws: WebSocket
  dataCallbacks: Set<PtyDataCallback>
  exitCallbacks: Set<PtyExitCallback>
  reconnectAttempts: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  dataBuffer: string[] // Buffer data before callbacks are registered
}
