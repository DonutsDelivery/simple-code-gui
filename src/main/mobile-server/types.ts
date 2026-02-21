/**
 * Mobile Server Types
 */

import { WebSocket } from 'ws'

export interface MobileServerConfig {
  port?: number
}

export type EndpointAccess = 'admin' | 'write' | 'read'

export interface TerminalSubscription {
  ws: WebSocket
  ptyId: string
}

export interface LocalPty {
  ptyId: string
  projectPath: string
  dataCallbacks: Set<(data: string) => void>
  exitCallbacks: Set<(code: number) => void>
}

export interface PendingFile {
  id: string
  name: string
  path: string
  size: number
  mimeType: string
  createdAt: number
  expiresAt: number
  message?: string
}

export const DEFAULT_PORT = 38470
