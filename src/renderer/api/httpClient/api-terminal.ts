/**
 * Terminal/PTY API
 *
 * API methods for terminal management and PTY operations.
 */

import { HostConfig } from '../hostConfig.js'
import { post, del } from './http-helpers.js'
import { WebSocketManager } from './websocket-manager.js'
import type { BackendId } from './types.js'

/**
 * Spawn a new PTY process
 */
export async function spawnPty(
  config: HostConfig,
  wsManager: WebSocketManager,
  cwd: string,
  sessionId?: string,
  model?: string,
  backend?: BackendId
): Promise<string> {
  // Ensure WebSocket is connected
  if (!wsManager.isConnected()) {
    await wsManager.connect()
  }

  const response = await post<{ ptyId: string }>(config, '/terminal/create', {
    projectPath: cwd,
    sessionId,
    model,
    backend
  })

  return response.ptyId
}

/**
 * Write data to a PTY
 */
export function writePty(
  config: HostConfig,
  wsManager: WebSocketManager,
  id: string,
  data: string
): void {
  if (wsManager.isConnected()) {
    wsManager.writeTerminal(id, data)
  } else {
    // Fallback to HTTP (less efficient)
    post(config, `/terminal/${id}/write`, { data }).catch((error) => {
      console.error('[HttpApiClient] writePty HTTP fallback failed:', error)
    })
  }
}

/**
 * Resize a PTY
 */
export function resizePty(
  config: HostConfig,
  wsManager: WebSocketManager,
  id: string,
  cols: number,
  rows: number
): void {
  if (wsManager.isConnected()) {
    wsManager.resizeTerminal(id, cols, rows)
  } else {
    // Fallback to HTTP
    post(config, `/terminal/${id}/resize`, { cols, rows }).catch((error) => {
      console.error('[HttpApiClient] resizePty HTTP fallback failed:', error)
    })
  }
}

/**
 * Kill a PTY process
 */
export function killPty(config: HostConfig, id: string): void {
  del(config, `/terminal/${id}`).catch((error) => {
    console.error('[HttpApiClient] killPty failed:', error)
  })
}
