/**
 * Types for ConnectionScreen components
 */

import type { HttpBackend } from '../../api/index.js'

export type ViewState = 'welcome' | 'scanning' | 'manual' | 'connecting' | 'error'

export interface ConnectionScreenProps {
  onConnected: (api: HttpBackend) => void
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
  token: string
  lastConnected: string
}
