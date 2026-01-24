/**
 * HTTP API Client
 *
 * Provides an HTTP/WebSocket-based API client that mirrors the electronAPI interface.
 * This allows the same UI code to work with either Electron IPC or HTTP transport.
 */

import {
  HostConfig,
  buildBaseUrl,
  buildWsUrl,
  buildApiUrl
} from './hostConfig'

// =============================================================================
// Types (mirror preload types)
// =============================================================================

export type BackendId = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'

export interface Settings {
  defaultProjectDir: string
  theme: string
  voiceOutputEnabled?: boolean
  voiceVolume?: number
  voiceSpeed?: number
  voiceSkipOnNew?: boolean
  autoAcceptTools?: string[]
  permissionMode?: string
  backend?: 'default' | BackendId
}

export interface ProjectCategory {
  id: string
  name: string
  collapsed: boolean
  order: number
}

export interface Project {
  path: string
  name: string
  executable?: string
  apiPort?: number
  apiAutoStart?: boolean
  apiSessionMode?: 'existing' | 'new-keep' | 'new-close'
  apiModel?: 'default' | 'opus' | 'sonnet' | 'haiku'
  autoAcceptTools?: string[]
  permissionMode?: string
  color?: string
  ttsVoice?: string
  ttsEngine?: 'piper' | 'xtts'
  backend?: 'default' | BackendId
  categoryId?: string
  order?: number
}

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  ptyId: string
  backend?: BackendId
}

export interface TileLayout {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface Workspace {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
  viewMode?: 'tabs' | 'tiled'
  tileLayout?: TileLayout[]
  categories: ProjectCategory[]
}

export interface Session {
  sessionId: string
  slug: string
}

export interface BeadsTask {
  id: string
  title: string
  status: string
  priority?: number
  created?: string
  blockers?: string[]
  description?: string
  issue_type?: string
  created_at?: string
  updated_at?: string
  dependency_count?: number
  dependent_count?: number
}

export interface BeadsCloseResult {
  taskId: string
  status: string
}

export interface VoiceSettings {
  whisperModel?: string
  ttsEngine?: 'piper' | 'xtts' | 'openvoice'
  ttsVoice?: string
  ttsSpeed?: number
  microphoneId?: string | null
  readBehavior?: 'immediate' | 'pause' | 'manual'
  skipOnNew?: boolean
  xttsTemperature?: number
  xttsTopK?: number
  xttsTopP?: number
  xttsRepetitionPenalty?: number
}

export interface GSDProgress {
  initialized: boolean
  currentPhase: string | null
  currentPhaseNumber: number | null
  totalPhases: number
  completedPhases: number
  phases: Array<{
    number: number
    title: string
    completed: boolean
  }>
}

// API Response wrapper
interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  timestamp: number
}

// WebSocket message types
type WsMessageType =
  | 'terminal:data'
  | 'terminal:exit'
  | 'terminal:write'
  | 'terminal:resize'
  | 'ping'
  | 'pong'
  | 'error'
  | 'auth'
  | 'auth:success'
  | 'auth:failure'

interface WsMessage<T = unknown> {
  type: WsMessageType
  ptyId?: string
  action?: string
  payload?: T
  timestamp: number
}

// =============================================================================
// WebSocket Manager
// =============================================================================

type TerminalDataCallback = (ptyId: string, data: string) => void
type TerminalExitCallback = (ptyId: string, code: number) => void

class WebSocketManager {
  private ws: WebSocket | null = null
  private config: HostConfig
  private authenticated = false
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null

  // Callbacks
  private terminalDataCallbacks: Map<string, Set<(data: string) => void>> = new Map()
  private terminalExitCallbacks: Map<string, Set<(code: number) => void>> = new Map()
  private globalDataCallbacks: Set<TerminalDataCallback> = new Set()
  private globalExitCallbacks: Set<TerminalExitCallback> = new Set()
  private onConnectCallbacks: Set<() => void> = new Set()
  private onDisconnectCallbacks: Set<() => void> = new Set()

  // Pending messages while connecting
  private pendingMessages: WsMessage[] = []

  constructor(config: HostConfig) {
    this.config = config
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      const wsUrl = buildWsUrl(this.config)
      console.log('[WS] Connecting to:', wsUrl)

      try {
        this.ws = new WebSocket(wsUrl)
      } catch (error) {
        reject(error)
        return
      }

      const connectionTimeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          this.ws?.close()
          reject(new Error('WebSocket connection timeout'))
        }
      }, 10000)

      this.ws.onopen = () => {
        console.log('[WS] Connected, authenticating...')
        // Send auth message
        this.send({
          type: 'auth',
          payload: { token: this.config.token },
          timestamp: Date.now()
        })
      }

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WsMessage

          if (message.type === 'auth:success') {
            console.log('[WS] Authenticated successfully')
            clearTimeout(connectionTimeout)
            this.authenticated = true
            this.reconnectAttempts = 0
            this.startPingInterval()

            // Send pending messages
            for (const msg of this.pendingMessages) {
              this.send(msg)
            }
            this.pendingMessages = []

            // Notify connect callbacks
            for (const cb of this.onConnectCallbacks) {
              cb()
            }

            resolve()
          } else if (message.type === 'auth:failure') {
            clearTimeout(connectionTimeout)
            this.ws?.close()
            reject(new Error('Authentication failed'))
          } else {
            this.handleMessage(message)
          }
        } catch (error) {
          console.error('[WS] Failed to parse message:', error)
        }
      }

      this.ws.onclose = (event) => {
        console.log('[WS] Disconnected:', event.code, event.reason)
        clearTimeout(connectionTimeout)
        this.authenticated = false
        this.stopPingInterval()

        // Notify disconnect callbacks
        for (const cb of this.onDisconnectCallbacks) {
          cb()
        }

        // Attempt reconnection
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error)
      }
    })
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.stopPingInterval()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempts = this.maxReconnectAttempts // Prevent auto-reconnect
    this.ws?.close(1000, 'Client disconnect')
    this.ws = null
    this.authenticated = false
  }

  /**
   * Check if connected and authenticated
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated
  }

  /**
   * Send a message to the server
   */
  private send(message: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else if (!this.authenticated && message.type !== 'auth') {
      // Queue message for later
      this.pendingMessages.push(message)
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: WsMessage): void {
    switch (message.type) {
      case 'terminal:data':
        if (message.ptyId && message.payload) {
          const data = (message.payload as { data: string }).data

          // Call ptyId-specific callbacks
          const dataCallbacks = this.terminalDataCallbacks.get(message.ptyId)
          if (dataCallbacks) {
            for (const cb of dataCallbacks) {
              cb(data)
            }
          }

          // Call global callbacks
          for (const cb of this.globalDataCallbacks) {
            cb(message.ptyId, data)
          }
        }
        break

      case 'terminal:exit':
        if (message.ptyId && message.payload) {
          const code = (message.payload as { code: number }).code

          // Call ptyId-specific callbacks
          const exitCallbacks = this.terminalExitCallbacks.get(message.ptyId)
          if (exitCallbacks) {
            for (const cb of exitCallbacks) {
              cb(code)
            }
          }

          // Call global callbacks
          for (const cb of this.globalExitCallbacks) {
            cb(message.ptyId, code)
          }

          // Clean up callbacks for this ptyId
          this.terminalDataCallbacks.delete(message.ptyId)
          this.terminalExitCallbacks.delete(message.ptyId)
        }
        break

      case 'pong':
        // Server responded to ping
        break

      case 'error':
        console.error('[WS] Server error:', message.payload)
        break
    }
  }

  /**
   * Subscribe to a terminal
   */
  subscribeToTerminal(ptyId: string): void {
    this.send({
      type: 'ping', // Using ping as a carrier, action determines behavior
      action: 'subscribe',
      ptyId,
      timestamp: Date.now()
    } as WsMessage)
  }

  /**
   * Unsubscribe from a terminal
   */
  unsubscribeFromTerminal(ptyId: string): void {
    this.send({
      type: 'ping',
      action: 'unsubscribe',
      ptyId,
      timestamp: Date.now()
    } as WsMessage)
  }

  /**
   * Write to a terminal
   */
  writeTerminal(ptyId: string, data: string): void {
    this.send({
      type: 'terminal:write',
      ptyId,
      payload: { data },
      timestamp: Date.now()
    })
  }

  /**
   * Resize a terminal
   */
  resizeTerminal(ptyId: string, cols: number, rows: number): void {
    this.send({
      type: 'terminal:resize',
      ptyId,
      payload: { cols, rows },
      timestamp: Date.now()
    })
  }

  /**
   * Register callback for terminal data
   */
  onTerminalData(ptyId: string, callback: (data: string) => void): () => void {
    if (!this.terminalDataCallbacks.has(ptyId)) {
      this.terminalDataCallbacks.set(ptyId, new Set())
      // Subscribe to terminal when first callback is registered
      this.subscribeToTerminal(ptyId)
    }
    this.terminalDataCallbacks.get(ptyId)!.add(callback)

    return () => {
      const callbacks = this.terminalDataCallbacks.get(ptyId)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.terminalDataCallbacks.delete(ptyId)
          this.unsubscribeFromTerminal(ptyId)
        }
      }
    }
  }

  /**
   * Register callback for terminal exit
   */
  onTerminalExit(ptyId: string, callback: (code: number) => void): () => void {
    if (!this.terminalExitCallbacks.has(ptyId)) {
      this.terminalExitCallbacks.set(ptyId, new Set())
    }
    this.terminalExitCallbacks.get(ptyId)!.add(callback)

    return () => {
      const callbacks = this.terminalExitCallbacks.get(ptyId)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.terminalExitCallbacks.delete(ptyId)
        }
      }
    }
  }

  /**
   * Register global callback for all terminal data
   */
  onAnyTerminalData(callback: TerminalDataCallback): () => void {
    this.globalDataCallbacks.add(callback)
    return () => this.globalDataCallbacks.delete(callback)
  }

  /**
   * Register global callback for all terminal exits
   */
  onAnyTerminalExit(callback: TerminalExitCallback): () => void {
    this.globalExitCallbacks.add(callback)
    return () => this.globalExitCallbacks.delete(callback)
  }

  /**
   * Register callback for connection events
   */
  onConnect(callback: () => void): () => void {
    this.onConnectCallbacks.add(callback)
    return () => this.onConnectCallbacks.delete(callback)
  }

  /**
   * Register callback for disconnection events
   */
  onDisconnect(callback: () => void): () => void {
    this.onDisconnectCallbacks.add(callback)
    return () => this.onDisconnectCallbacks.delete(callback)
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts)
    console.log(`[WS] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectAttempts++
      this.connect().catch((error) => {
        console.error('[WS] Reconnect failed:', error)
      })
    }, delay)
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    this.stopPingInterval()
    this.pingTimer = setInterval(() => {
      this.send({
        type: 'ping',
        timestamp: Date.now()
      })
    }, 25000) // Ping every 25 seconds
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }
}

// =============================================================================
// HTTP API Client Class
// =============================================================================

export class HttpApiClient {
  private config: HostConfig
  private wsManager: WebSocketManager

  constructor(config: HostConfig) {
    this.config = config
    this.wsManager = new WebSocketManager(config)
  }

  // ===========================================================================
  // HTTP Request Helpers
  // ===========================================================================

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = buildApiUrl(this.config, endpoint)

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.token}`
    }

    const options: RequestInit = {
      method,
      headers
    }

    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)
    const data: ApiResponse<T> = await response.json()

    if (!data.success) {
      throw new Error(data.error || `HTTP ${response.status}: Request failed`)
    }

    return data.data as T
  }

  private async get<T>(endpoint: string): Promise<T> {
    return this.request<T>('GET', endpoint)
  }

  private async post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', endpoint, body)
  }

  private async put<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', endpoint, body)
  }

  private async patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', endpoint, body)
  }

  private async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>('DELETE', endpoint)
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Connect WebSocket for real-time terminal streaming
   */
  async connect(): Promise<void> {
    await this.wsManager.connect()
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    this.wsManager.disconnect()
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.wsManager.isConnected()
  }

  /**
   * Register callback for connection events
   */
  onConnect(callback: () => void): () => void {
    return this.wsManager.onConnect(callback)
  }

  /**
   * Register callback for disconnection events
   */
  onDisconnect(callback: () => void): () => void {
    return this.wsManager.onDisconnect(callback)
  }

  // ===========================================================================
  // Workspace API
  // ===========================================================================

  async getWorkspace(): Promise<Workspace> {
    return this.get<Workspace>('/projects')
  }

  async saveWorkspace(workspace: Workspace): Promise<void> {
    await this.put<void>('/projects', workspace)
  }

  // Note: addProject requires file dialog, not available via HTTP
  async addProject(): Promise<string | null> {
    console.warn('[HttpApiClient] addProject not available via HTTP - requires file dialog')
    return null
  }

  // ===========================================================================
  // Sessions API
  // ===========================================================================

  async discoverSessions(projectPath: string, backend?: BackendId): Promise<Session[]> {
    const encodedPath = encodeURIComponent(projectPath)
    let url = `/terminal/discover/${encodedPath}`
    if (backend) {
      url += `?backend=${backend}`
    }
    return this.get<Session[]>(url)
  }

  // ===========================================================================
  // Settings API
  // ===========================================================================

  async getSettings(): Promise<Settings> {
    return this.get<Settings>('/settings')
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.put<void>('/settings', settings)
  }

  // Note: selectDirectory requires file dialog, not available via HTTP
  async selectDirectory(): Promise<string | null> {
    console.warn('[HttpApiClient] selectDirectory not available via HTTP - requires file dialog')
    return null
  }

  // ===========================================================================
  // Terminal/PTY API
  // ===========================================================================

  async spawnPty(
    cwd: string,
    sessionId?: string,
    model?: string,
    backend?: BackendId
  ): Promise<string> {
    // Ensure WebSocket is connected
    if (!this.wsManager.isConnected()) {
      await this.connect()
    }

    const response = await this.post<{ ptyId: string }>('/terminal/create', {
      projectPath: cwd,
      sessionId,
      model,
      backend
    })

    return response.ptyId
  }

  writePty(id: string, data: string): void {
    if (this.wsManager.isConnected()) {
      this.wsManager.writeTerminal(id, data)
    } else {
      // Fallback to HTTP (less efficient)
      this.post(`/terminal/${id}/write`, { data }).catch((error) => {
        console.error('[HttpApiClient] writePty HTTP fallback failed:', error)
      })
    }
  }

  resizePty(id: string, cols: number, rows: number): void {
    if (this.wsManager.isConnected()) {
      this.wsManager.resizeTerminal(id, cols, rows)
    } else {
      // Fallback to HTTP
      this.post(`/terminal/${id}/resize`, { cols, rows }).catch((error) => {
        console.error('[HttpApiClient] resizePty HTTP fallback failed:', error)
      })
    }
  }

  killPty(id: string): void {
    this.delete(`/terminal/${id}`).catch((error) => {
      console.error('[HttpApiClient] killPty failed:', error)
    })
  }

  // Note: setPtyBackend not available via HTTP currently
  async setPtyBackend(_id: string, _backend: BackendId): Promise<void> {
    console.warn('[HttpApiClient] setPtyBackend not implemented in HTTP API')
  }

  onPtyData(id: string, callback: (data: string) => void): () => void {
    return this.wsManager.onTerminalData(id, callback)
  }

  onPtyExit(id: string, callback: (code: number) => void): () => void {
    return this.wsManager.onTerminalExit(id, callback)
  }

  // Note: onPtyRecreated not available via HTTP currently
  onPtyRecreated(_callback: (data: { oldId: string; newId: string; backend: BackendId }) => void): () => void {
    console.warn('[HttpApiClient] onPtyRecreated not implemented in HTTP API')
    return () => {}
  }

  // ===========================================================================
  // CLI Status API
  // ===========================================================================

  async claudeCheck(): Promise<{ installed: boolean; npmInstalled: boolean; gitBashInstalled: boolean }> {
    return this.get<{ installed: boolean; npmInstalled: boolean; gitBashInstalled: boolean }>('/settings/cli/claude')
  }

  async geminiCheck(): Promise<{ installed: boolean; npmInstalled: boolean }> {
    return this.get<{ installed: boolean; npmInstalled: boolean }>('/settings/cli/gemini')
  }

  async codexCheck(): Promise<{ installed: boolean; npmInstalled: boolean }> {
    return this.get<{ installed: boolean; npmInstalled: boolean }>('/settings/cli/codex')
  }

  async opencodeCheck(): Promise<{ installed: boolean; npmInstalled: boolean }> {
    return this.get<{ installed: boolean; npmInstalled: boolean }>('/settings/cli/opencode')
  }

  async aiderCheck(): Promise<{ installed: boolean; pipInstalled: boolean }> {
    return this.get<{ installed: boolean; pipInstalled: boolean }>('/settings/cli/aider')
  }

  // ===========================================================================
  // Beads API
  // ===========================================================================

  async beadsCheck(cwd: string): Promise<{ installed: boolean; initialized: boolean }> {
    return this.get<{ installed: boolean; initialized: boolean }>(`/projects/beads/check?cwd=${encodeURIComponent(cwd)}`)
  }

  async beadsInit(cwd: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.post('/projects/beads/init', { cwd })
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async beadsList(cwd: string): Promise<{ success: boolean; tasks?: BeadsTask[]; error?: string }> {
    try {
      const tasks = await this.get<BeadsTask[]>(`/projects/beads/tasks?cwd=${encodeURIComponent(cwd)}`)
      return { success: true, tasks }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async beadsShow(cwd: string, taskId: string): Promise<{ success: boolean; task?: BeadsTask; error?: string }> {
    try {
      const task = await this.get<BeadsTask>(`/projects/beads/tasks/${taskId}?cwd=${encodeURIComponent(cwd)}`)
      return { success: true, task }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async beadsCreate(
    cwd: string,
    title: string,
    description?: string,
    priority?: number,
    type?: string,
    labels?: string
  ): Promise<{ success: boolean; task?: BeadsTask; error?: string }> {
    try {
      const task = await this.post<BeadsTask>('/projects/beads/tasks', {
        cwd,
        title,
        description,
        priority,
        type,
        labels
      })
      return { success: true, task }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async beadsComplete(cwd: string, taskId: string): Promise<{ success: boolean; result?: BeadsCloseResult; error?: string }> {
    try {
      await this.post(`/projects/beads/tasks/${taskId}/complete`, { cwd })
      return { success: true, result: { taskId, status: 'completed' } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async beadsDelete(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.delete(`/projects/beads/tasks/${taskId}?cwd=${encodeURIComponent(cwd)}`)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async beadsStart(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.post(`/projects/beads/tasks/${taskId}/start`, { cwd })
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async beadsUpdate(
    cwd: string,
    taskId: string,
    status?: string,
    title?: string,
    description?: string,
    priority?: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.patch(`/projects/beads/tasks/${taskId}`, {
        cwd,
        status,
        title,
        description,
        priority
      })
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  // Note: beadsWatch/beadsUnwatch use file watchers, not available via HTTP
  async beadsWatch(_cwd: string): Promise<{ success: boolean; error?: string }> {
    console.warn('[HttpApiClient] beadsWatch not available via HTTP')
    return { success: false, error: 'Not available via HTTP' }
  }

  async beadsUnwatch(_cwd: string): Promise<{ success: boolean; error?: string }> {
    console.warn('[HttpApiClient] beadsUnwatch not available via HTTP')
    return { success: false, error: 'Not available via HTTP' }
  }

  onBeadsTasksChanged(_callback: (data: { cwd: string }) => void): () => void {
    console.warn('[HttpApiClient] onBeadsTasksChanged not available via HTTP')
    return () => {}
  }

  // ===========================================================================
  // GSD API
  // ===========================================================================

  async gsdProjectCheck(cwd: string): Promise<{ initialized: boolean }> {
    return this.get<{ initialized: boolean }>(`/projects/gsd/check?cwd=${encodeURIComponent(cwd)}`)
  }

  async gsdGetProgress(cwd: string): Promise<{
    success: boolean
    data?: GSDProgress
    error?: string
  }> {
    try {
      const data = await this.get<GSDProgress>(`/projects/gsd/progress?cwd=${encodeURIComponent(cwd)}`)
      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  // ===========================================================================
  // Voice API
  // ===========================================================================

  async voiceGetSettings(): Promise<VoiceSettings> {
    return this.get<VoiceSettings>('/settings/voice')
  }

  async voiceSpeak(text: string): Promise<{ success: boolean; audioData?: string; error?: string }> {
    try {
      const result = await this.post<{ audioData?: string }>('/settings/voice/speak', { text })
      return { success: true, audioData: result.audioData }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async voiceStopSpeaking(): Promise<{ success: boolean }> {
    try {
      await this.post('/settings/voice/stop')
      return { success: true }
    } catch {
      return { success: false }
    }
  }

  // ===========================================================================
  // Utility Methods (stubs for unsupported operations)
  // ===========================================================================

  // These methods require Electron-specific functionality and are not available via HTTP

  async createProject(_name: string, _parentDir: string): Promise<{ success: boolean; path?: string; error?: string }> {
    return { success: false, error: 'Not available via HTTP - requires file system access' }
  }

  async selectExecutable(): Promise<string | null> {
    console.warn('[HttpApiClient] selectExecutable not available via HTTP')
    return null
  }

  async runExecutable(_executable: string, _cwd: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Not available via HTTP' }
  }

  // Installation methods not available via HTTP
  async claudeInstall(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Installation not available via HTTP' }
  }

  async nodeInstall(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Installation not available via HTTP' }
  }

  async gitInstall(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Installation not available via HTTP' }
  }

  async pythonInstall(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Installation not available via HTTP' }
  }

  async geminiInstall(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Installation not available via HTTP' }
  }

  async codexInstall(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Installation not available via HTTP' }
  }

  async opencodeInstall(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Installation not available via HTTP' }
  }

  async aiderInstall(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Installation not available via HTTP' }
  }

  onInstallProgress(_callback: (data: { type: string; status: string; percent?: number }) => void): () => void {
    return () => {}
  }

  // GSD installation
  async gsdCheck(): Promise<{ installed: boolean; npmInstalled: boolean }> {
    return { installed: false, npmInstalled: false }
  }

  async gsdInstall(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Installation not available via HTTP' }
  }

  // Beads installation
  async beadsInstall(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Installation not available via HTTP' }
  }

  async beadsReady(_cwd: string): Promise<{ success: boolean; tasks?: BeadsTask[]; error?: string }> {
    return { success: false, error: 'Not available via HTTP' }
  }

  // Window controls not available
  windowMinimize(): void {}
  windowMaximize(): void {}
  windowClose(): void {}
  async windowIsMaximized(): Promise<boolean> { return false }

  // Clipboard not available
  async readClipboardImage(): Promise<{ success: boolean; hasImage?: boolean; path?: string; error?: string }> {
    return { success: false, error: 'Not available via HTTP' }
  }

  // File utilities
  getPathForFile(_file: File): string {
    return ''
  }

  // Debug
  debugLog(message: string): void {
    console.log('[Debug]', message)
  }

  async isDebugMode(): Promise<boolean> {
    return false
  }

  async refresh(): Promise<void> {
    window.location.reload()
  }

  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank')
  }

  // Version/Updates not available
  async getVersion(): Promise<string> {
    return 'HTTP Client'
  }

  async checkForUpdate(): Promise<{ success: boolean; version?: string; error?: string }> {
    return { success: false, error: 'Not available via HTTP' }
  }

  async downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Not available via HTTP' }
  }

  installUpdate(): void {}

  onUpdaterStatus(_callback: (data: { status: string; version?: string; progress?: number; error?: string }) => void): () => void {
    return () => {}
  }

  // API Server (meta - we ARE the API client)
  async apiStart(_projectPath: string, _port: number): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Cannot start API server from HTTP client' }
  }

  async apiStop(_projectPath: string): Promise<{ success: boolean }> {
    return { success: false }
  }

  async apiStatus(_projectPath: string): Promise<{ running: boolean; port?: number }> {
    return { running: false }
  }

  onApiOpenSession(_callback: (data: { projectPath: string; autoClose: boolean; model?: string }) => void): () => void {
    return () => {}
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Check if running in Electron environment with electronAPI available
 */
export function isElectronEnvironment(): boolean {
  return typeof window !== 'undefined' && 'electronAPI' in window
}

/**
 * Get the electronAPI if available
 */
export function getElectronAPI(): any | null {
  if (isElectronEnvironment()) {
    return (window as any).electronAPI
  }
  return null
}

// Singleton HTTP client instance
let httpClientInstance: HttpApiClient | null = null

/**
 * Create or get an API client
 *
 * - If running in Electron, returns electronAPI
 * - If hostConfig is provided, creates/returns HttpApiClient
 * - Returns null if neither is available
 */
export function createApiClient(hostConfig?: HostConfig): HttpApiClient | any | null {
  // Check for Electron first
  const electronAPI = getElectronAPI()
  if (electronAPI && !hostConfig) {
    return electronAPI
  }

  // Create HTTP client if config provided
  if (hostConfig) {
    httpClientInstance = new HttpApiClient(hostConfig)
    return httpClientInstance
  }

  // Return existing HTTP client if available
  if (httpClientInstance) {
    return httpClientInstance
  }

  return null
}

/**
 * Get the current API client instance
 */
export function getApiClient(): HttpApiClient | any | null {
  const electronAPI = getElectronAPI()
  if (electronAPI) {
    return electronAPI
  }
  return httpClientInstance
}

/**
 * Set the HTTP client instance (for testing or manual configuration)
 */
export function setHttpClient(client: HttpApiClient | null): void {
  httpClientInstance = client
}

// =============================================================================
// Type Export for ApiClient interface
// =============================================================================

/**
 * Unified API Client interface
 * This is a subset of the full electronAPI that's available via HTTP
 */
export interface ApiClient {
  // Terminal
  spawnPty(cwd: string, sessionId?: string, model?: string, backend?: BackendId): Promise<string>
  writePty(id: string, data: string): void
  resizePty(id: string, cols: number, rows: number): void
  killPty(id: string): void
  onPtyData(id: string, callback: (data: string) => void): () => void
  onPtyExit(id: string, callback: (code: number) => void): () => void

  // Projects
  getWorkspace(): Promise<Workspace>
  saveWorkspace(workspace: Workspace): Promise<void>

  // Settings
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>

  // Sessions
  discoverSessions(projectPath: string, backend?: BackendId): Promise<Session[]>

  // Backend switching (not available via HTTP)
  setPtyBackend?(id: string, backend: BackendId): Promise<void>

  // Beads
  beadsCheck(cwd: string): Promise<{ installed: boolean; initialized: boolean }>
  beadsList(cwd: string): Promise<{ success: boolean; tasks?: BeadsTask[]; error?: string }>
  beadsCreate(cwd: string, title: string, description?: string, priority?: number, type?: string, labels?: string): Promise<{ success: boolean; task?: BeadsTask; error?: string }>
  beadsComplete(cwd: string, taskId: string): Promise<{ success: boolean; result?: BeadsCloseResult; error?: string }>
  beadsDelete(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }>
  beadsStart(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }>
  beadsUpdate(cwd: string, taskId: string, status?: string, title?: string, description?: string, priority?: number): Promise<{ success: boolean; error?: string }>

  // GSD
  gsdProjectCheck(cwd: string): Promise<{ initialized: boolean }>
  gsdGetProgress(cwd: string): Promise<{ success: boolean; data?: GSDProgress; error?: string }>

  // CLI Status
  claudeCheck(): Promise<{ installed: boolean; npmInstalled: boolean; gitBashInstalled: boolean }>
  geminiCheck(): Promise<{ installed: boolean; npmInstalled: boolean }>
  codexCheck(): Promise<{ installed: boolean; npmInstalled: boolean }>
  opencodeCheck(): Promise<{ installed: boolean; npmInstalled: boolean }>
  aiderCheck(): Promise<{ installed: boolean; pipInstalled: boolean }>

  // Voice
  voiceSpeak(text: string): Promise<{ success: boolean; audioData?: string; error?: string }>
  voiceStopSpeaking(): Promise<{ success: boolean }>

  // Connection (HTTP only)
  connect?(): Promise<void>
  disconnect?(): void
  isConnected?(): boolean
}
