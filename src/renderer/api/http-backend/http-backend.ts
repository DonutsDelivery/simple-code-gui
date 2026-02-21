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
  Unsubscribe,
  BackendId
} from '../types'
import { HttpBackendConfig } from './types'
import { DEFAULT_PORT } from './constants'
import { isLocalNetwork } from './helpers'
import { ConnectionManager } from './connection'
import { PtyWebSocketManager } from './pty-websocket'
import { PtyApi } from './pty-api'
import { WorkspaceApi } from './workspace-api'

export class HttpBackend implements Api {
  voiceGetInstalled?: () => Promise<
    Array<{
      key: string
      displayName: string
      source: 'builtin' | 'downloaded' | 'custom'
      quality?: string
      language?: string
    }>
  >
  xttsGetVoices?: () => Promise<
    Array<{ id: string; name: string; language: string; createdAt: number }>
  >
  voiceGetSettings?: () => Promise<{ ttsVoice?: string; ttsEngine?: string }>
  apiStart?: (
    projectPath: string,
    port: number
  ) => Promise<{ success: boolean; error?: string }>
  apiStop?: (projectPath: string) => Promise<{ success: boolean }>

  private host: string
  private port: number
  private connection: ConnectionManager
  private wsManager: PtyWebSocketManager
  private ptyApi: PtyApi
  private workspaceApi: WorkspaceApi

  constructor(config: HttpBackendConfig) {
    // Validate port to prevent requests to invalid addresses like localhost:1
    if (
      !config.port ||
      config.port < 1 ||
      config.port > 65535 ||
      !Number.isInteger(config.port)
    ) {
      console.error('[HttpBackend] Invalid port:', config.port, '- using default', DEFAULT_PORT)
      config.port = DEFAULT_PORT
    }
    if (config.port < 1024) {
      console.warn(
        '[HttpBackend] Port',
        config.port,
        'is a privileged port (< 1024), this may fail'
      )
    }

    this.host = config.host
    this.port = config.port

    // Determine protocol based on whether host is local
    const httpProtocol = isLocalNetwork(config.host) ? 'http' : 'https'
    const wsProtocol = isLocalNetwork(config.host) ? 'ws' : 'wss'

    const baseUrl = `${httpProtocol}://${config.host}:${config.port}`
    const wsBaseUrl = `${wsProtocol}://${config.host}:${config.port}`

    console.log('[HttpBackend] Initialized with baseUrl:', baseUrl)

    // Initialize managers
    this.connection = new ConnectionManager(baseUrl, config.token)
    this.wsManager = new PtyWebSocketManager(wsBaseUrl, config.token)
    this.ptyApi = new PtyApi(this.connection, this.wsManager)
    this.workspaceApi = new WorkspaceApi(this.connection)
  }

  // Connection State Management

  getConnectionState(): ConnectionState {
    return this.connection.getConnectionState()
  }

  getConnectionError(): string | null {
    return this.connection.getConnectionError()
  }

  onConnectionStateChange(callback: (state: ConnectionState) => void): Unsubscribe {
    return this.connection.onConnectionStateChange(callback)
  }

  // PTY Management

  spawnPty(cwd: string, sessionId?: string, model?: string, backend?: BackendId): Promise<string> {
    return this.ptyApi.spawnPty(cwd, sessionId, model, backend)
  }

  killPty(id: string): void {
    this.ptyApi.killPty(id)
  }

  writePty(id: string, data: string): void {
    this.ptyApi.writePty(id, data)
  }

  resizePty(id: string, cols: number, rows: number): void {
    this.ptyApi.resizePty(id, cols, rows)
  }

  onPtyData(id: string, callback: PtyDataCallback): Unsubscribe {
    return this.ptyApi.onPtyData(id, callback)
  }

  onPtyExit(id: string, callback: PtyExitCallback): Unsubscribe {
    return this.ptyApi.onPtyExit(id, callback)
  }

  onPtyRecreated(callback: PtyRecreatedCallback): Unsubscribe {
    return this.ptyApi.onPtyRecreated(callback)
  }

  // Session Management

  discoverSessions(projectPath: string, backend?: BackendId): Promise<Session[]> {
    return this.workspaceApi.discoverSessions(projectPath, backend)
  }

  // Workspace Management

  getWorkspace(): Promise<Workspace> {
    return this.workspaceApi.getWorkspace()
  }

  saveWorkspace(workspace: Workspace): Promise<void> {
    return this.workspaceApi.saveWorkspace(workspace)
  }

  // Settings Management

  getSettings(): Promise<Settings> {
    return this.workspaceApi.getSettings()
  }

  saveSettings(settings: Settings): Promise<void> {
    return this.workspaceApi.saveSettings(settings)
  }

  // Project Management

  addProject(): Promise<string | null> {
    return this.workspaceApi.addProject()
  }

  addProjectsFromParent(): Promise<Array<{ path: string; name: string }> | null> {
    return this.workspaceApi.addProjectsFromParent()
  }

  // TTS

  ttsInstallInstructions(projectPath: string): Promise<{ success: boolean }> {
    return this.workspaceApi.ttsInstallInstructions(projectPath)
  }

  ttsSpeak(text: string): Promise<{ success: boolean; audioData?: string; error?: string }> {
    return this.workspaceApi.ttsSpeak(text)
  }

  ttsStop(): Promise<{ success: boolean }> {
    return this.workspaceApi.ttsStop()
  }

  // Events

  onApiOpenSession(callback: ApiOpenSessionCallback): Unsubscribe {
    return this.workspaceApi.onApiOpenSession(callback)
  }

  // Connection Management

  getConnectionInfo(): { host: string; port: number; token: string } {
    return {
      host: this.host,
      port: this.port,
      token: this.connection.getToken()
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      this.connection.setConnectionState('connecting')
      const response = await fetch(`${this.connection.getBaseUrl()}/health`)

      if (!response.ok) {
        this.connection.setConnectionState('error', `HTTP ${response.status}`)
        return { success: false, error: `HTTP ${response.status}` }
      }

      await response.json()
      this.connection.setConnectionState('connected')
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.connection.setConnectionState('error', message)
      return { success: false, error: message }
    }
  }

  disconnect(): void {
    this.wsManager.disconnectAll()
    this.connection.setConnectionState('disconnected')
  }
}
