/**
 * HTTP Backend Module
 *
 * Re-exports the HTTP backend implementation and factory function.
 */

import { HttpBackend } from './http-backend'

export { HttpBackend } from './http-backend'
export type { HttpBackendConfig, PtyWebSocketState } from './types'
export { MAX_RECONNECT_ATTEMPTS, RECONNECT_DELAYS, DEFAULT_PORT } from './constants'
export { isLocalNetwork } from './helpers'
export { ConnectionManager } from './connection'
export { PtyWebSocketManager } from './pty-websocket'
export { PtyApi } from './pty-api'
export { WorkspaceApi } from './workspace-api'

/**
 * Create an HttpBackend instance
 */
export function createHttpBackend(config: {
  host: string
  port: number
  token: string
}): HttpBackend {
  return new HttpBackend(config)
}

export default HttpBackend
