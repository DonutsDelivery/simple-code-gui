/**
 * HTTP API Client
 *
 * Provides an HTTP/WebSocket-based API client that mirrors the electronAPI interface.
 * This allows the same UI code to work with either Electron IPC or HTTP transport.
 */

import { HostConfig } from '../hostConfig.js'
import { WebSocketManager } from './websocket-manager.js'
import * as workspace from './api-workspace.js'
import * as terminal from './api-terminal.js'
import * as beads from './api-beads.js'
import * as misc from './api-misc.js'
import type {
  BackendId,
  Workspace,
  Settings,
  Session,
  BeadsTask,
  BeadsCloseResult,
  GSDProgress,
  VoiceSettings
} from './types.js'

// Re-export all types
export * from './types.js'

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
  // Connection Management
  // ===========================================================================

  async connect(): Promise<void> {
    await this.wsManager.connect()
  }

  disconnect(): void {
    this.wsManager.disconnect()
  }

  isConnected(): boolean {
    return this.wsManager.isConnected()
  }

  onConnect(callback: () => void): () => void {
    return this.wsManager.onConnect(callback)
  }

  onDisconnect(callback: () => void): () => void {
    return this.wsManager.onDisconnect(callback)
  }

  // ===========================================================================
  // Workspace API
  // ===========================================================================

  getWorkspace(): Promise<Workspace> {
    return workspace.getWorkspace(this.config)
  }

  saveWorkspace(ws: Workspace): Promise<void> {
    return workspace.saveWorkspace(this.config, ws)
  }

  addProject(): Promise<string | null> {
    return misc.addProject()
  }

  // ===========================================================================
  // Sessions API
  // ===========================================================================

  discoverSessions(projectPath: string, backend?: BackendId): Promise<Session[]> {
    return workspace.discoverSessions(this.config, projectPath, backend)
  }

  // ===========================================================================
  // Settings API
  // ===========================================================================

  getSettings(): Promise<Settings> {
    return workspace.getSettings(this.config)
  }

  saveSettings(settings: Settings): Promise<void> {
    return workspace.saveSettings(this.config, settings)
  }

  selectDirectory(): Promise<string | null> {
    return misc.selectDirectory()
  }

  // ===========================================================================
  // Terminal/PTY API
  // ===========================================================================

  spawnPty(cwd: string, sessionId?: string, model?: string, backend?: BackendId): Promise<string> {
    return terminal.spawnPty(this.config, this.wsManager, cwd, sessionId, model, backend)
  }

  writePty(id: string, data: string): void {
    terminal.writePty(this.config, this.wsManager, id, data)
  }

  resizePty(id: string, cols: number, rows: number): void {
    terminal.resizePty(this.config, this.wsManager, id, cols, rows)
  }

  killPty(id: string): void {
    terminal.killPty(this.config, id)
  }

  setPtyBackend(id: string, backend: BackendId): Promise<void> {
    return misc.setPtyBackend(id, backend)
  }

  onPtyData(id: string, callback: (data: string) => void): () => void {
    return this.wsManager.onTerminalData(id, callback)
  }

  onPtyExit(id: string, callback: (code: number) => void): () => void {
    return this.wsManager.onTerminalExit(id, callback)
  }

  onPtyRecreated(callback: (data: { oldId: string; newId: string; backend: BackendId }) => void): () => void {
    return misc.onPtyRecreated(callback)
  }

  // ===========================================================================
  // CLI Status API
  // ===========================================================================

  claudeCheck(): Promise<{ installed: boolean; npmInstalled: boolean; gitBashInstalled: boolean }> {
    return misc.claudeCheck(this.config)
  }

  geminiCheck(): Promise<{ installed: boolean; npmInstalled: boolean }> {
    return misc.geminiCheck(this.config)
  }

  codexCheck(): Promise<{ installed: boolean; npmInstalled: boolean }> {
    return misc.codexCheck(this.config)
  }

  opencodeCheck(): Promise<{ installed: boolean; npmInstalled: boolean }> {
    return misc.opencodeCheck(this.config)
  }

  aiderCheck(): Promise<{ installed: boolean; pipInstalled: boolean }> {
    return misc.aiderCheck(this.config)
  }

  // ===========================================================================
  // Beads API
  // ===========================================================================

  beadsCheck(cwd: string): Promise<{ installed: boolean; initialized: boolean }> {
    return beads.beadsCheck(this.config, cwd)
  }

  beadsInit(cwd: string): Promise<{ success: boolean; error?: string }> {
    return beads.beadsInit(this.config, cwd)
  }

  beadsList(cwd: string): Promise<{ success: boolean; tasks?: BeadsTask[]; error?: string }> {
    return beads.beadsList(this.config, cwd)
  }

  beadsShow(cwd: string, taskId: string): Promise<{ success: boolean; task?: BeadsTask; error?: string }> {
    return beads.beadsShow(this.config, cwd, taskId)
  }

  beadsCreate(
    cwd: string,
    title: string,
    description?: string,
    priority?: number,
    type?: string,
    labels?: string
  ): Promise<{ success: boolean; task?: BeadsTask; error?: string }> {
    return beads.beadsCreate(this.config, cwd, title, description, priority, type, labels)
  }

  beadsComplete(cwd: string, taskId: string): Promise<{ success: boolean; result?: BeadsCloseResult; error?: string }> {
    return beads.beadsComplete(this.config, cwd, taskId)
  }

  beadsDelete(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    return beads.beadsDelete(this.config, cwd, taskId)
  }

  beadsStart(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    return beads.beadsStart(this.config, cwd, taskId)
  }

  beadsUpdate(
    cwd: string,
    taskId: string,
    status?: string,
    title?: string,
    description?: string,
    priority?: number
  ): Promise<{ success: boolean; error?: string }> {
    return beads.beadsUpdate(this.config, cwd, taskId, status, title, description, priority)
  }

  beadsWatch(cwd: string): Promise<{ success: boolean; error?: string }> {
    return misc.beadsWatch(cwd)
  }

  beadsUnwatch(cwd: string): Promise<{ success: boolean; error?: string }> {
    return misc.beadsUnwatch(cwd)
  }

  onBeadsTasksChanged(callback: (data: { cwd: string }) => void): () => void {
    return misc.onBeadsTasksChanged(callback)
  }

  // ===========================================================================
  // GSD API
  // ===========================================================================

  gsdProjectCheck(cwd: string): Promise<{ initialized: boolean }> {
    return misc.gsdProjectCheck(this.config, cwd)
  }

  gsdGetProgress(cwd: string): Promise<{ success: boolean; data?: GSDProgress; error?: string }> {
    return misc.gsdGetProgress(this.config, cwd)
  }

  // ===========================================================================
  // Voice API
  // ===========================================================================

  voiceGetSettings(): Promise<VoiceSettings> {
    return misc.voiceGetSettings(this.config)
  }

  voiceSpeak(text: string): Promise<{ success: boolean; audioData?: string; error?: string }> {
    return misc.voiceSpeak(this.config, text)
  }

  voiceStopSpeaking(): Promise<{ success: boolean }> {
    return misc.voiceStopSpeaking(this.config)
  }

  // ===========================================================================
  // Utility Methods (stubs for unsupported operations)
  // ===========================================================================

  createProject(name: string, parentDir: string): Promise<{ success: boolean; path?: string; error?: string }> {
    return misc.createProject(name, parentDir)
  }

  selectExecutable(): Promise<string | null> {
    return misc.selectExecutable()
  }

  runExecutable(executable: string, cwd: string): Promise<{ success: boolean; error?: string }> {
    return misc.runExecutable(executable, cwd)
  }

  claudeInstall(): Promise<{ success: boolean; error?: string }> {
    return misc.claudeInstall()
  }

  nodeInstall(): Promise<{ success: boolean; error?: string }> {
    return misc.nodeInstall()
  }

  gitInstall(): Promise<{ success: boolean; error?: string }> {
    return misc.gitInstall()
  }

  pythonInstall(): Promise<{ success: boolean; error?: string }> {
    return misc.pythonInstall()
  }

  geminiInstall(): Promise<{ success: boolean; error?: string }> {
    return misc.geminiInstall()
  }

  codexInstall(): Promise<{ success: boolean; error?: string }> {
    return misc.codexInstall()
  }

  opencodeInstall(): Promise<{ success: boolean; error?: string }> {
    return misc.opencodeInstall()
  }

  aiderInstall(): Promise<{ success: boolean; error?: string }> {
    return misc.aiderInstall()
  }

  onInstallProgress(callback: (data: { type: string; status: string; percent?: number }) => void): () => void {
    return misc.onInstallProgress(callback)
  }

  gsdCheck(): Promise<{ installed: boolean; npmInstalled: boolean }> {
    return misc.gsdCheck()
  }

  gsdInstall(): Promise<{ success: boolean; error?: string }> {
    return misc.gsdInstall()
  }

  beadsInstall(): Promise<{ success: boolean; error?: string }> {
    return misc.beadsInstall()
  }

  beadsReady(cwd: string): Promise<{ success: boolean; tasks?: BeadsTask[]; error?: string }> {
    return misc.beadsReady(cwd)
  }

  windowMinimize(): void {
    misc.windowMinimize()
  }

  windowMaximize(): void {
    misc.windowMaximize()
  }

  windowClose(): void {
    misc.windowClose()
  }

  windowIsMaximized(): Promise<boolean> {
    return misc.windowIsMaximized()
  }

  readClipboardImage(): Promise<{ success: boolean; hasImage?: boolean; path?: string; error?: string }> {
    return misc.readClipboardImage()
  }

  getPathForFile(file: File): string {
    return misc.getPathForFile(file)
  }

  debugLog(message: string): void {
    misc.debugLog(message)
  }

  isDebugMode(): Promise<boolean> {
    return misc.isDebugMode()
  }

  refresh(): Promise<void> {
    return misc.refresh()
  }

  openExternal(url: string): Promise<void> {
    return misc.openExternal(url)
  }

  getVersion(): Promise<string> {
    return misc.getVersion()
  }

  checkForUpdate(): Promise<{ success: boolean; version?: string; error?: string }> {
    return misc.checkForUpdate()
  }

  downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    return misc.downloadUpdate()
  }

  installUpdate(): void {
    misc.installUpdate()
  }

  onUpdaterStatus(callback: (data: { status: string; version?: string; progress?: number; error?: string }) => void): () => void {
    return misc.onUpdaterStatus(callback)
  }

  apiStart(projectPath: string, port: number): Promise<{ success: boolean; error?: string }> {
    return misc.apiStart(projectPath, port)
  }

  apiStop(projectPath: string): Promise<{ success: boolean }> {
    return misc.apiStop(projectPath)
  }

  apiStatus(projectPath: string): Promise<{ running: boolean; port?: number }> {
    return misc.apiStatus(projectPath)
  }

  onApiOpenSession(callback: (data: { projectPath: string; autoClose: boolean; model?: string }) => void): () => void {
    return misc.onApiOpenSession(callback)
  }
}

// =============================================================================
// Factory Functions
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
export function getElectronAPI(): unknown | null {
  if (isElectronEnvironment()) {
    return (window as unknown as Record<string, unknown>).electronAPI
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
export function createApiClient(hostConfig?: HostConfig): HttpApiClient | unknown | null {
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
export function getApiClient(): HttpApiClient | unknown | null {
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
