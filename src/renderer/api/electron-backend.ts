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
import type { BackendId } from './types'

/**
 * Type declaration for the global electronAPI
 */
declare global {
  interface Window {
    electronAPI?: {
      // PTY Management
      spawnPty: (cwd: string, sessionId?: string, model?: string, backend?: BackendId) => Promise<string>
      killPty: (id: string) => void
      writePty: (id: string, data: string) => void
      resizePty: (id: string, cols: number, rows: number) => void
      onPtyData: (id: string, callback: (data: string) => void) => () => void
      onPtyExit: (id: string, callback: (code: number) => void) => () => void
      onPtyRecreated: (callback: (data: { oldId: string; newId: string; backend: BackendId }) => void) => () => void
      setPtyBackend: (id: string, backend: BackendId) => Promise<void>
      setAutoAccept?: (id: string, enabled: boolean) => void
      getAutoAcceptStatus?: (id: string) => Promise<boolean>


      // Session Management
      discoverSessions: (projectPath: string, backend?: BackendId) => Promise<Session[]>

      // Workspace Management
      getWorkspace: () => Promise<Workspace>
      saveWorkspace: (workspace: Workspace) => Promise<void>

      // Settings Management
      getSettings: () => Promise<Settings>
      saveSettings: (settings: Settings) => Promise<void>

      // Project Management
      addProject: () => Promise<string | null>
      addProjectsFromParent: () => Promise<Array<{ path: string; name: string }> | null>

      // TTS
      ttsInstallInstructions: (projectPath: string, aiBackend?: string) => Promise<{ success: boolean }>
      ttsRemoveInstructions?: (projectPath: string, aiBackend?: string) => Promise<{ success: boolean }>

      // Global instruction injection
      globalInstructionInject?: (projectPath: string, instructionContent: string, aiBackends?: string[]) => Promise<{ success: boolean; results: Record<string, boolean> }>
      globalInstructionRemove?: (projectPath: string, aiBackends?: string[]) => Promise<{ success: boolean; results: Record<string, boolean> }>
      globalInstructionInjectAll?: (projects: Array<{ path: string }>, instructionContent: string, aiBackends?: string[]) => Promise<{ success: boolean; applied: number; failed: number; error?: string }>
      globalInstructionRemoveAll?: (projects: Array<{ path: string }>, aiBackends?: string[]) => Promise<{ success: boolean; removed: number; failed: number }>
      voiceGetInstalled?: () => Promise<Array<{ key: string; displayName: string; source: 'builtin' | 'downloaded' | 'custom'; quality?: string; language?: string }>>
      xttsGetVoices?: () => Promise<Array<{ id: string; name: string; language: string; createdAt: number }>>
      voiceGetSettings?: () => Promise<{ ttsVoice?: string; ttsEngine?: string; ttsSpeed?: number; xttsTemperature?: number; xttsTopK?: number; xttsTopP?: number; xttsRepetitionPenalty?: number; tadaVoiceSample?: string | null }>
      voiceCheckWhisper?: () => Promise<{ installed: boolean; models: string[]; currentModel: string | null }>
      voiceCheckTTS?: () => Promise<{ installed: boolean; engine: string | null; voices: string[]; currentVoice: string | null }>
      voiceInstallWhisper?: (model: string) => Promise<{ success: boolean; error?: string }>
      voiceApplySettings?: (settings: { ttsVoice?: string; ttsEngine?: string; ttsSpeed?: number; xttsTemperature?: number; xttsTopK?: number; xttsTopP?: number; xttsRepetitionPenalty?: number; tadaVoiceSample?: string | null }) => Promise<{ success: boolean }>
      voiceSetVoice?: (voice: string | { voice: string; engine: 'piper' | 'xtts' | 'tada' }) => Promise<{ success: boolean }>
      extensionsGetInstalled?: () => Promise<Array<{ id: string; name: string; type: string }>>
      voiceSpeak: (text: string) => Promise<{ success: boolean; audioData?: string; error?: string }>
      voiceStopSpeaking: () => Promise<{ success: boolean }>

      // TADA (neural voice cloning)
      tadaInstall?: () => Promise<{ success: boolean; error?: string }>
      tadaCheck?: () => Promise<{ installed: boolean; pythonPath: string | null; venvExists: boolean; hfAuthenticated?: boolean; error?: string }>
      tadaLoginHuggingFace?: (token: string) => Promise<{ success: boolean; error?: string }>
      tadaSelectVoiceSample?: () => Promise<{ success: boolean; path?: string; error?: string }>
      tadaSetVoiceSample?: (samplePath: string) => Promise<{ success: boolean; error?: string }>
      tadaGetVoiceSample?: () => Promise<{ path: string | null }>
      tadaSpeak?: (text: string) => Promise<{ success: boolean; audioData?: string; error?: string }>
      tadaGetSampleVoices?: () => Promise<Array<{ id: string; name: string; description: string; available: boolean }>>
      tadaUseSampleVoice?: (sampleId: string) => Promise<{ success: boolean; path?: string; error?: string }>

      // XTTS speech synthesis
      xttsSpeak?: (text: string, voiceId: string, language?: string) => Promise<{ success: boolean; audioData?: string; error?: string }>

      // Events
      onApiOpenSession: (callback: (data: { projectPath: string; autoClose: boolean; model?: string }) => void) => () => void

      // API Server
      apiStart?: (projectPath: string, port: number) => Promise<{ success: boolean; error?: string }>
      apiStop?: (projectPath: string) => Promise<{ success: boolean }>

      // Extended API (Desktop-only)
      selectDirectory: () => Promise<string | null>
      selectExecutable: () => Promise<string | null>
      windowMinimize: () => void
      windowMaximize: () => void
      windowClose: () => void
      windowIsMaximized: () => Promise<boolean>
      getPathForFile: (file: File) => string
      readClipboardImage: () => Promise<{ success: boolean; hasImage?: boolean; path?: string; error?: string }>
      writeClipboardText: (text: string) => Promise<{ success: boolean; error?: string }>
      getVersion: () => Promise<string>
      isDebugMode: () => Promise<boolean>
      refresh: () => Promise<void>
      openExternal: (url: string) => Promise<void>
      debugLog: (message: string) => void

      // Beads
      beadsCheck: (cwd: string) => Promise<{ installed: boolean; initialized: boolean }>
      beadsInit: (cwd: string) => Promise<{ success: boolean; error?: string }>
      beadsInstall: () => Promise<{ success: boolean; error?: string; method?: string; needsPython?: boolean }>
      beadsReady: (cwd: string) => Promise<{ success: boolean; tasks?: unknown[]; error?: string }>
      beadsList: (cwd: string) => Promise<{ success: boolean; tasks?: unknown[]; error?: string }>
      beadsShow: (cwd: string, taskId: string) => Promise<{ success: boolean; task?: unknown; error?: string }>
      beadsCreate: (cwd: string, title: string, description?: string, priority?: number, type?: string, labels?: string) => Promise<{ success: boolean; task?: unknown; error?: string }>
      beadsComplete: (cwd: string, taskId: string) => Promise<{ success: boolean; result?: unknown; error?: string }>
      beadsDelete: (cwd: string, taskId: string) => Promise<{ success: boolean; error?: string }>
      beadsStart: (cwd: string, taskId: string) => Promise<{ success: boolean; error?: string }>
      beadsUpdate: (cwd: string, taskId: string, status?: string, title?: string, description?: string, priority?: number) => Promise<{ success: boolean; error?: string }>
      beadsWatch: (cwd: string) => Promise<{ success: boolean; error?: string }>
      beadsUnwatch: (cwd: string) => Promise<{ success: boolean; error?: string }>
      onBeadsTasksChanged: (callback: (data: { cwd: string }) => void) => () => void

      // Kspec
      kspecCheck: (cwd: string) => Promise<{ exists: boolean }>
      kspecInit: (cwd: string) => Promise<{ success: boolean; error?: string }>
      kspecEnsureDaemon: (cwd: string) => Promise<{ success: boolean; alreadyRunning?: boolean; error?: string }>
      kspecCheckCli: () => Promise<{ installed: boolean; version?: string }>
      kspecInstallCli: () => Promise<{ success: boolean; error?: string }>
      kspecMigrateFromBeads: (cwd: string) => Promise<{ success: boolean; migrated: number; error?: string }>
      kspecDispatchStart: (cwd: string) => Promise<{ success: boolean; error?: string }>
      kspecDispatchStop: (cwd: string) => Promise<{ success: boolean; error?: string }>
      kspecDispatchStatus: (cwd: string) => Promise<{ running: boolean; [key: string]: unknown }>

      // Install progress
      pythonInstall: () => Promise<{ success: boolean; error?: string; method?: string }>
      onInstallProgress: (callback: (data: { type: string; status: string; percent?: number }) => void) => () => void
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

  async spawnPty(cwd: string, sessionId?: string, model?: string, backend?: BackendId): Promise<string> {
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

  setPtyBackend(id: string, backend: BackendId): Promise<void> {
    this.checkApi()
    return window.electronAPI!.setPtyBackend(id, backend)
  }

  setAutoAccept(id: string, enabled: boolean): void {
    window.electronAPI?.setAutoAccept?.(id, enabled)
  }

  getAutoAcceptStatus(id: string): Promise<boolean> {
    return window.electronAPI?.getAutoAcceptStatus?.(id) ?? Promise.resolve(false)
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  async discoverSessions(projectPath: string, backend?: BackendId): Promise<Session[]> {
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

  async addProjectsFromParent(): Promise<Array<{ path: string; name: string }> | null> {
    this.checkApi()
    return window.electronAPI!.addProjectsFromParent()
  }

  // ==========================================================================
  // TTS (Text-to-Speech)
  // ==========================================================================

  async ttsInstallInstructions(projectPath: string, aiBackend?: string): Promise<{ success: boolean }> {
    this.checkApi()
    return window.electronAPI!.ttsInstallInstructions(projectPath, aiBackend)
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
