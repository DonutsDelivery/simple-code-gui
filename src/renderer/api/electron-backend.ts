/**
 * Electron Backend Implementation
 *
 * This module provides the Electron IPC implementation of the Api interface.
 * It delegates all calls to window.electronAPI which communicates with the
 * Electron main process via IPC.
 */

import {
  Api,
  ExtendedApi,
  Settings,
  Workspace,
  Session,
  PtyDataCallback,
  PtyExitCallback,
  PtyRecreatedCallback,
  ApiOpenSessionCallback,
  Unsubscribe
} from './types'

/**
 * Type declaration for the global electronAPI
 */
declare global {
  interface Window {
    electronAPI?: {
      // PTY Management
      spawnPty: (cwd: string, sessionId?: string, model?: string, backend?: string) => Promise<string>
      killPty: (id: string) => void
      writePty: (id: string, data: string) => void
      resizePty: (id: string, cols: number, rows: number) => void
      onPtyData: (id: string, callback: (data: string) => void) => () => void
      onPtyExit: (id: string, callback: (code: number) => void) => () => void
      onPtyRecreated: (callback: (data: { oldId: string; newId: string; backend: string }) => void) => () => void

      // Session Management
      discoverSessions: (projectPath: string, backend?: 'claude' | 'opencode') => Promise<Session[]>

      // Workspace Management
      getWorkspace: () => Promise<Workspace>
      saveWorkspace: (workspace: Workspace) => Promise<void>

      // Settings Management
      getSettings: () => Promise<Settings>
      saveSettings: (settings: Settings) => Promise<void>

      // Project Management
      addProject: () => Promise<string | null>

      // TTS
      ttsInstallInstructions: (projectPath: string) => Promise<{ success: boolean }>
      voiceSpeak: (text: string) => Promise<{ success: boolean; audioData?: string; error?: string }>
      voiceStopSpeaking: () => Promise<{ success: boolean }>

      // Events
      onApiOpenSession: (callback: (data: { projectPath: string; autoClose: boolean; model?: string }) => void) => () => void

      // Extended API (Desktop-only)
      selectDirectory: () => Promise<string | null>
      selectExecutable: () => Promise<string | null>
      windowMinimize: () => void
      windowMaximize: () => void
      windowClose: () => void
      windowIsMaximized: () => Promise<boolean>
      getPathForFile: (file: File) => string
      readClipboardImage: () => Promise<{ success: boolean; hasImage?: boolean; path?: string; error?: string }>
      getVersion: () => Promise<string>
      isDebugMode: () => Promise<boolean>
      refresh: () => Promise<void>
      openExternal: (url: string) => Promise<void>
      debugLog: (message: string) => void
    }
  }
}

/**
 * Electron backend implementation that delegates to window.electronAPI
 */
export class ElectronBackend implements ExtendedApi {
  /**
   * Check if the Electron API is available
   * @throws Error if electronAPI is not available
   */
  private checkApi(): void {
    if (!window.electronAPI) {
      throw new Error('Electron API not available. Are you running in Electron?')
    }
  }

  // ==========================================================================
  // PTY Management
  // ==========================================================================

  async spawnPty(cwd: string, sessionId?: string, model?: string, backend?: string): Promise<string> {
    this.checkApi()
    return window.electronAPI!.spawnPty(cwd, sessionId, model, backend)
  }

  killPty(id: string): void {
    this.checkApi()
    window.electronAPI!.killPty(id)
  }

  writePty(id: string, data: string): void {
    this.checkApi()
    window.electronAPI!.writePty(id, data)
  }

  resizePty(id: string, cols: number, rows: number): void {
    this.checkApi()
    window.electronAPI!.resizePty(id, cols, rows)
  }

  onPtyData(id: string, callback: PtyDataCallback): Unsubscribe {
    this.checkApi()
    return window.electronAPI!.onPtyData(id, callback)
  }

  onPtyExit(id: string, callback: PtyExitCallback): Unsubscribe {
    this.checkApi()
    return window.electronAPI!.onPtyExit(id, callback)
  }

  onPtyRecreated(callback: PtyRecreatedCallback): Unsubscribe {
    this.checkApi()
    return window.electronAPI!.onPtyRecreated(callback)
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  async discoverSessions(projectPath: string, backend?: 'claude' | 'opencode'): Promise<Session[]> {
    this.checkApi()
    return window.electronAPI!.discoverSessions(projectPath, backend)
  }

  // ==========================================================================
  // Workspace Management
  // ==========================================================================

  async getWorkspace(): Promise<Workspace> {
    this.checkApi()
    return window.electronAPI!.getWorkspace()
  }

  async saveWorkspace(workspace: Workspace): Promise<void> {
    this.checkApi()
    return window.electronAPI!.saveWorkspace(workspace)
  }

  // ==========================================================================
  // Settings Management
  // ==========================================================================

  async getSettings(): Promise<Settings> {
    this.checkApi()
    return window.electronAPI!.getSettings()
  }

  async saveSettings(settings: Settings): Promise<void> {
    this.checkApi()
    return window.electronAPI!.saveSettings(settings)
  }

  // ==========================================================================
  // Project Management
  // ==========================================================================

  async addProject(): Promise<string | null> {
    this.checkApi()
    return window.electronAPI!.addProject()
  }

  // ==========================================================================
  // TTS (Text-to-Speech)
  // ==========================================================================

  async ttsInstallInstructions(projectPath: string): Promise<{ success: boolean }> {
    this.checkApi()
    return window.electronAPI!.ttsInstallInstructions(projectPath)
  }

  async ttsSpeak(text: string): Promise<{ success: boolean; audioData?: string; error?: string }> {
    this.checkApi()
    return window.electronAPI!.voiceSpeak(text)
  }

  async ttsStop(): Promise<{ success: boolean }> {
    this.checkApi()
    return window.electronAPI!.voiceStopSpeaking()
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  onApiOpenSession(callback: ApiOpenSessionCallback): Unsubscribe {
    this.checkApi()
    return window.electronAPI!.onApiOpenSession(callback)
  }

  // ==========================================================================
  // Extended API (Desktop-only features)
  // ==========================================================================

  async selectDirectory(): Promise<string | null> {
    this.checkApi()
    return window.electronAPI!.selectDirectory()
  }

  async selectExecutable(): Promise<string | null> {
    this.checkApi()
    return window.electronAPI!.selectExecutable()
  }

  windowMinimize(): void {
    this.checkApi()
    window.electronAPI!.windowMinimize()
  }

  windowMaximize(): void {
    this.checkApi()
    window.electronAPI!.windowMaximize()
  }

  windowClose(): void {
    this.checkApi()
    window.electronAPI!.windowClose()
  }

  async windowIsMaximized(): Promise<boolean> {
    this.checkApi()
    return window.electronAPI!.windowIsMaximized()
  }

  getPathForFile(file: File): string {
    this.checkApi()
    return window.electronAPI!.getPathForFile(file)
  }

  async readClipboardImage(): Promise<{ success: boolean; hasImage?: boolean; path?: string; error?: string }> {
    this.checkApi()
    return window.electronAPI!.readClipboardImage()
  }

  async getVersion(): Promise<string> {
    this.checkApi()
    return window.electronAPI!.getVersion()
  }

  async isDebugMode(): Promise<boolean> {
    this.checkApi()
    return window.electronAPI!.isDebugMode()
  }

  async refresh(): Promise<void> {
    this.checkApi()
    return window.electronAPI!.refresh()
  }

  async openExternal(url: string): Promise<void> {
    this.checkApi()
    return window.electronAPI!.openExternal(url)
  }

  debugLog(message: string): void {
    this.checkApi()
    window.electronAPI!.debugLog(message)
  }
}

/**
 * Singleton instance of the Electron backend
 */
let instance: ElectronBackend | null = null

/**
 * Get the singleton instance of the Electron backend
 */
export function getElectronBackend(): ElectronBackend {
  if (!instance) {
    instance = new ElectronBackend()
  }
  return instance
}

/**
 * Check if the Electron API is available
 */
export function isElectronAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}
