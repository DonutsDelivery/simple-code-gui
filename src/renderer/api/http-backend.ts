/**
 * HTTP/WebSocket Backend Implementation
 *
 * This module implements the Api interface using HTTP requests and WebSocket
 * connections to communicate with the mobile server running on a desktop host.
 */

import {
  Api,
  ConnectionState,
  Settings,
  Workspace,
  Session,
  PtyDataCallback,
  PtyExitCallback,
  PtyRecreatedCallback,
  ApiOpenSessionCallback,
  Unsubscribe
} from './types'

// ============================================================================
// Types
// ============================================================================

interface HttpBackendConfig {
  host: string
  port: number
  token: string
}

interface PtyWebSocketState {
  ws: WebSocket
  dataCallbacks: Set<PtyDataCallback>
  exitCallbacks: Set<PtyExitCallback>
  reconnectAttempts: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  dataBuffer: string[]  // Buffer data before callbacks are registered
}

// ============================================================================
// Constants
// ============================================================================

const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if host is a local network address
 */
function isLocalNetwork(hostname: string): boolean {
  return /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)
}

// ============================================================================
// HttpBackend Class
// ============================================================================

export class HttpBackend implements Api {
  private baseUrl: string
  private wsBaseUrl: string
  private token: string
  private host: string
  private port: number

  // PTY WebSocket connections
  private ptyWebsockets: Map<string, PtyWebSocketState> = new Map()

  // Connection state management
  private connectionState: ConnectionState = 'disconnected'
  private stateListeners: Set<(state: ConnectionState) => void> = new Set()
  private connectionError: string | null = null

  // PTY recreated callbacks (global, not per-pty)
  private ptyRecreatedCallbacks: Set<PtyRecreatedCallback> = new Set()

  // API open session callbacks
  private apiOpenSessionCallbacks: Set<ApiOpenSessionCallback> = new Set()

  constructor(config: HttpBackendConfig) {
    this.host = config.host
    this.port = config.port
    this.token = config.token

    // Determine protocol based on whether host is local
    const httpProtocol = isLocalNetwork(config.host) ? 'http' : 'https'
    const wsProtocol = isLocalNetwork(config.host) ? 'ws' : 'wss'

    this.baseUrl = `${httpProtocol}://${config.host}:${config.port}`
    this.wsBaseUrl = `${wsProtocol}://${config.host}:${config.port}`
  }

  // ==========================================================================
  // Connection State Management
  // ==========================================================================

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  /**
   * Get connection error message if any
   */
  getConnectionError(): string | null {
    return this.connectionError
  }

  /**
   * Subscribe to connection state changes
   */
  onConnectionStateChange(callback: (state: ConnectionState) => void): Unsubscribe {
    this.stateListeners.add(callback)
    return () => {
      this.stateListeners.delete(callback)
    }
  }

  /**
   * Update connection state and notify listeners
   */
  private setConnectionState(state: ConnectionState, error?: string): void {
    this.connectionState = state
    this.connectionError = error || null
    this.stateListeners.forEach(cb => cb(state))
  }

  // ==========================================================================
  // HTTP Fetch Helper
  // ==========================================================================

  /**
   * Make an authenticated HTTP request
   */
  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...options?.headers
        }
      })

      // Update connection state on successful request
      if (this.connectionState !== 'connected') {
        this.setConnectionState('connected')
      }

      return response
    } catch (error) {
      // Network error - connection lost
      this.setConnectionState('error', error instanceof Error ? error.message : 'Network error')
      throw error
    }
  }

  /**
   * Make an authenticated HTTP request and parse JSON response
   */
  private async fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await this.fetch(path, options)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `HTTP ${response.status}`)
    }

    return response.json()
  }

  // ==========================================================================
  // PTY WebSocket Management
  // ==========================================================================

  /**
   * Connect WebSocket for PTY data streaming
   */
  private connectPtyStream(ptyId: string): void {
    // Don't reconnect if already connected or connecting
    const existing = this.ptyWebsockets.get(ptyId)
    if (existing?.ws && (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    const url = `${this.wsBaseUrl}/api/pty/${ptyId}/stream?token=${encodeURIComponent(this.token)}`
    console.log('[HttpBackend] Connecting PTY stream:', ptyId)

    const ws = new WebSocket(url)

    // Reuse existing state if available (preserves callbacks), otherwise create new
    const state: PtyWebSocketState = existing || {
      ws,
      dataCallbacks: new Set(),
      exitCallbacks: new Set(),
      reconnectAttempts: 0,
      reconnectTimer: null,
      dataBuffer: []
    }
    // Update the WebSocket reference
    state.ws = ws
    state.reconnectAttempts = existing?.reconnectAttempts || 0

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
              state.dataCallbacks.forEach(cb => cb(msg.data))
            }
            break

          case 'exit':
            // Forward exit to all callbacks
            state.exitCallbacks.forEach(cb => cb(msg.code))
            // Clean up after exit
            this.ptyWebsockets.delete(ptyId)
            break

          case 'connected':
            console.log('[HttpBackend] PTY stream confirmed:', ptyId, 'callbacks:', state.dataCallbacks.size, 'buffered:', state.dataBuffer.length)
            break

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

      // Attempt reconnection if not a clean close and we still want this PTY
      if (!event.wasClean && state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_DELAYS[Math.min(state.reconnectAttempts, RECONNECT_DELAYS.length - 1)]
        console.log(`[HttpBackend] Reconnecting PTY stream in ${delay}ms...`)

        state.reconnectTimer = setTimeout(() => {
          state.reconnectAttempts++
          this.connectPtyStream(ptyId)
        }, delay)
      } else if (event.code !== 1000) {
        // Exit callback for abnormal closure
        state.exitCallbacks.forEach(cb => cb(-1))
        this.ptyWebsockets.delete(ptyId)
      }
    }

    this.ptyWebsockets.set(ptyId, state)
  }

  /**
   * Disconnect PTY WebSocket stream
   */
  private disconnectPtyStream(ptyId: string): void {
    const state = this.ptyWebsockets.get(ptyId)
    if (!state) return

    // Clear reconnect timer
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
    }

    // Close WebSocket
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
      state.ws.close(1000, 'Client requested close')
    }

    this.ptyWebsockets.delete(ptyId)
  }

  // ==========================================================================
  // PTY Management (Api Interface)
  // ==========================================================================

  async spawnPty(cwd: string, sessionId?: string, model?: string, backend?: string): Promise<string> {
    this.setConnectionState('connecting')

    const data = await this.fetchJson<{ ptyId: string }>('/api/pty/spawn', {
      method: 'POST',
      body: JSON.stringify({
        projectPath: cwd,
        sessionId,
        model,
        backend
      })
    })

    // Connect WebSocket for this PTY's data stream
    this.connectPtyStream(data.ptyId)

    return data.ptyId
  }

  killPty(id: string): void {
    // Disconnect WebSocket first
    this.disconnectPtyStream(id)

    // Then send kill request (fire and forget)
    this.fetch(`/api/pty/${id}`, { method: 'DELETE' }).catch(err => {
      console.error('[HttpBackend] Failed to kill PTY:', err)
    })
  }

  writePty(id: string, data: string): void {
    const state = this.ptyWebsockets.get(id)

    // Prefer WebSocket if connected
    if (state && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'input', data }))
    } else {
      // Fall back to HTTP
      this.fetch(`/api/pty/${id}/write`, {
        method: 'POST',
        body: JSON.stringify({ data })
      }).catch(err => {
        console.error('[HttpBackend] Failed to write to PTY:', err)
      })
    }
  }

  resizePty(id: string, cols: number, rows: number): void {
    const state = this.ptyWebsockets.get(id)

    // Prefer WebSocket if connected
    if (state && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    } else {
      // Fall back to HTTP
      this.fetch(`/api/pty/${id}/resize`, {
        method: 'POST',
        body: JSON.stringify({ cols, rows })
      }).catch(err => {
        console.error('[HttpBackend] Failed to resize PTY:', err)
      })
    }
  }

  onPtyData(id: string, callback: PtyDataCallback): Unsubscribe {
    // Ensure WebSocket is connected
    let state = this.ptyWebsockets.get(id)
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
      this.ptyWebsockets.set(id, state)
    }

    state.dataCallbacks.add(callback)

    // Flush any buffered data to this callback
    if (state.dataBuffer.length > 0) {
      console.log('[HttpBackend] Flushing', state.dataBuffer.length, 'buffered messages to callback for PTY:', id)
      const bufferedData = [...state.dataBuffer]
      state.dataBuffer = []
      // Send buffered data to all callbacks (not just this one, in case multiple registered)
      for (const data of bufferedData) {
        state.dataCallbacks.forEach(cb => cb(data))
      }
    }

    // If WebSocket isn't connected, try to connect
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      this.connectPtyStream(id)
    }

    return () => {
      const s = this.ptyWebsockets.get(id)
      if (s) {
        s.dataCallbacks.delete(callback)
      }
    }
  }

  onPtyExit(id: string, callback: PtyExitCallback): Unsubscribe {
    let state = this.ptyWebsockets.get(id)
    if (!state) {
      state = {
        ws: null as any,
        dataCallbacks: new Set(),
        exitCallbacks: new Set(),
        reconnectAttempts: 0,
        reconnectTimer: null,
        dataBuffer: []
      }
      this.ptyWebsockets.set(id, state)
    }

    state.exitCallbacks.add(callback)

    return () => {
      const s = this.ptyWebsockets.get(id)
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

  // ==========================================================================
  // Session Management
  // ==========================================================================

  async discoverSessions(projectPath: string, backend?: 'claude' | 'opencode'): Promise<Session[]> {
    const params = new URLSearchParams({ path: projectPath })
    if (backend) {
      params.set('backend', backend)
    }

    const data = await this.fetchJson<{ sessions: Session[] }>(`/api/sessions?${params}`)
    return data.sessions
  }

  // ==========================================================================
  // Workspace Management
  // ==========================================================================

  async getWorkspace(): Promise<Workspace> {
    return this.fetchJson<Workspace>('/api/workspace')
  }

  async saveWorkspace(_workspace: Workspace): Promise<void> {
    // NO-OP: Browser/mobile should NOT save workspace back to desktop
    // The Electron desktop app is the source of truth for workspace data
    // This prevents browser from accidentally wiping desktop's projects
    console.log('[HttpBackend] saveWorkspace() ignored - desktop is source of truth')
  }

  // ==========================================================================
  // Settings Management
  // ==========================================================================

  async getSettings(): Promise<Settings> {
    return this.fetchJson<Settings>('/api/settings')
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.fetchJson('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings)
    })
  }

  // ==========================================================================
  // Project Management
  // ==========================================================================

  async addProject(): Promise<string | null> {
    // HTTP backend cannot open a native file dialog on the desktop
    // Instead, mobile clients should browse/select paths differently
    // This could be implemented via a file browser endpoint in the future
    console.warn('[HttpBackend] addProject() - Native dialogs not available via HTTP')
    return null
  }

  // ==========================================================================
  // TTS (Text-to-Speech)
  // ==========================================================================

  async ttsInstallInstructions(projectPath: string): Promise<{ success: boolean }> {
    // TTS instruction installation is a desktop-only feature
    // The mobile app uses the host's TTS directly
    console.warn('[HttpBackend] ttsInstallInstructions() - Desktop-only feature')
    return { success: false }
  }

  async ttsSpeak(text: string): Promise<{ success: boolean; audioData?: string; error?: string }> {
    try {
      const data = await this.fetchJson<{ success: boolean; audioData?: string; error?: string; format?: string }>(
        '/api/tts/speak',
        {
          method: 'POST',
          body: JSON.stringify({ text })
        }
      )
      return data
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'TTS failed'
      }
    }
  }

  async ttsStop(): Promise<{ success: boolean }> {
    try {
      return await this.fetchJson<{ success: boolean }>('/api/tts/stop', {
        method: 'POST'
      })
    } catch (error) {
      return { success: false }
    }
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  onApiOpenSession(callback: ApiOpenSessionCallback): Unsubscribe {
    // API open session events would come via WebSocket from the main connection
    // For now, this is primarily used in the desktop app
    // Mobile clients don't typically receive these events
    this.apiOpenSessionCallbacks.add(callback)
    return () => {
      this.apiOpenSessionCallbacks.delete(callback)
    }
  }

  // ==========================================================================
  // Connection Management
  // ==========================================================================

  /**
   * Test connection to the server
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      this.setConnectionState('connecting')
      const response = await fetch(`${this.baseUrl}/health`)

      if (!response.ok) {
        this.setConnectionState('error', `HTTP ${response.status}`)
        return { success: false, error: `HTTP ${response.status}` }
      }

      const data = await response.json()
      this.setConnectionState('connected')
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.setConnectionState('error', message)
      return { success: false, error: message }
    }
  }

  /**
   * Disconnect and clean up all resources
   */
  disconnect(): void {
    // Close all PTY WebSocket connections
    this.ptyWebsockets.forEach((state, ptyId) => {
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer)
      }
      if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
        state.ws.close(1000, 'Client disconnecting')
      }
    })
    this.ptyWebsockets.clear()

    this.setConnectionState('disconnected')
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an HttpBackend instance
 */
export function createHttpBackend(config: HttpBackendConfig): HttpBackend {
  return new HttpBackend(config)
}

export default HttpBackend
