/**
 * Types for ConnectionScreen components
 */

import type { HttpBackend } from '../../api/index.js'

export type ViewState = 'welcome' | 'scanning' | 'manual' | 'connecting' | 'error'

export interface ConnectionScreenProps {
  onConnected: (api: HttpBackend, config: ConnectionConfig) => void
  savedConfig?: { host: string; port: number; token: string } | null
}

export interface ConnectionConfig {
  host: string
  hosts?: string[]
  port: number
  token: string
}

export interface SavedHost {
  id: string
  name: string
  host: string
  hosts?: string[]
  port: number
  credentialRef: string
  /** Legacy migration input only; never written by current code. */
  token?: string
  lastConnected: string
}
