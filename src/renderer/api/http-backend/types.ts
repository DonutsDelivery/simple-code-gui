/**
 * HTTP Backend Types
 *
 * Interfaces and type definitions for the HTTP backend implementation.
 */

import { PtyDataCallback, PtyExitCallback } from '../types'
import type { PtyGeometry, PtyGeometryCallback } from '../../../common/pty-geometry.js'

export interface HttpBackendConfig {
  host: string
  port: number
  token: string
  secure?: boolean
}

export interface PtyWebSocketState {
  ws: WebSocket
  dataCallbacks: Set<PtyDataCallback>
  exitCallbacks: Set<PtyExitCallback>
  geometryCallbacks: Set<PtyGeometryCallback>
  geometry: PtyGeometry | null
  reconnectAttempts: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  dataBuffer: string[] // Buffer data before callbacks are registered
}
