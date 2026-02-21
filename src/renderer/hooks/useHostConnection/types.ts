// ============================================
// Types and Interfaces for useHostConnection
// ============================================

export interface HostConfig {
  id: string
  name: string // User nickname or auto-generated
  host: string
  port: number
  token: string
  lastConnected?: Date
  // v2 security fields
  fingerprint?: string // Server fingerprint (TOFU - stored after first verify)
  pendingNonce?: string // Nonce to verify on connect
  nonceExpires?: number // When the nonce expires
  // v3 security fields (TLS certificate pinning)
  secure?: boolean // Use HTTPS/WSS (server has TLS enabled)
  certFingerprint?: string // SHA256 of server's TLS certificate for pinning
}

export type ConnectionState = 'disconnected' | 'connecting' | 'verifying' | 'connected' | 'error'
export type ConnectionMethod = 'none' | 'websocket' | 'http-polling'

// File pushed from desktop for download
export interface PendingFile {
  id: string
  name: string
  size: number
  mimeType: string
  message?: string
}

export interface HostConnectionState {
  hosts: HostConfig[]
  currentHost: HostConfig | null
  connectionState: ConnectionState
  connectionMethod: ConnectionMethod // Shows whether using WebSocket or HTTP polling
  error: string | null
  fingerprintWarning: string | null // Set when fingerprint mismatch detected
  pendingFiles: PendingFile[] // Files pushed from desktop for download
}

export interface HostConnectionActions {
  addHost: (config: Omit<HostConfig, 'id'>) => HostConfig
  removeHost: (id: string) => void
  updateHost: (id: string, updates: Partial<Omit<HostConfig, 'id'>>) => void
  connect: (hostId: string, options?: { nonce?: string; fingerprint?: string; token?: string; host?: string; port?: number }) => void
  disconnect: () => void
  reconnect: () => void
  acceptFingerprint: () => void // Accept a new/changed fingerprint
  clearPendingFile: (fileId: string) => void // Remove a pending file from the list
  clearAllPendingFiles: () => void // Clear all pending files
}

export type UseHostConnectionReturn = HostConnectionState & HostConnectionActions

// Connect options type for convenience
export interface ConnectOptions {
  nonce?: string
  fingerprint?: string
  certFingerprint?: string
  secure?: boolean
  token?: string
  host?: string
  port?: number
}
