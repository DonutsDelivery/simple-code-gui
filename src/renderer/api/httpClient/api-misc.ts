/**
 * Miscellaneous API
 *
 * CLI checks, GSD, Voice, and stub methods for unsupported operations.
 */

import { HostConfig } from '../hostConfig.js'
import { get, post } from './http-helpers.js'
import type { VoiceSettings, GSDProgress, BeadsTask, BackendId } from './types.js'

// =============================================================================
// CLI Status API
// =============================================================================

export function claudeCheck(
  config: HostConfig
): Promise<{ installed: boolean; npmInstalled: boolean; gitBashInstalled: boolean }> {
  return get<{ installed: boolean; npmInstalled: boolean; gitBashInstalled: boolean }>(
    config,
    '/settings/cli/claude'
  )
}

export function geminiCheck(
  config: HostConfig
): Promise<{ installed: boolean; npmInstalled: boolean }> {
  return get<{ installed: boolean; npmInstalled: boolean }>(config, '/settings/cli/gemini')
}

export function codexCheck(
  config: HostConfig
): Promise<{ installed: boolean; npmInstalled: boolean }> {
  return get<{ installed: boolean; npmInstalled: boolean }>(config, '/settings/cli/codex')
}

export function opencodeCheck(
  config: HostConfig
): Promise<{ installed: boolean; npmInstalled: boolean }> {
  return get<{ installed: boolean; npmInstalled: boolean }>(config, '/settings/cli/opencode')
}

export function aiderCheck(
  config: HostConfig
): Promise<{ installed: boolean; pipInstalled: boolean }> {
  return get<{ installed: boolean; pipInstalled: boolean }>(config, '/settings/cli/aider')
}

// =============================================================================
// GSD API
// =============================================================================

export function gsdProjectCheck(
  config: HostConfig,
  cwd: string
): Promise<{ initialized: boolean }> {
  return get<{ initialized: boolean }>(
    config,
    `/projects/gsd/check?cwd=${encodeURIComponent(cwd)}`
  )
}

export async function gsdGetProgress(
  config: HostConfig,
  cwd: string
): Promise<{ success: boolean; data?: GSDProgress; error?: string }> {
  try {
    const data = await get<GSDProgress>(
      config,
      `/projects/gsd/progress?cwd=${encodeURIComponent(cwd)}`
    )
    return { success: true, data }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

// =============================================================================
// Voice API
// =============================================================================

export function voiceGetSettings(config: HostConfig): Promise<VoiceSettings> {
  return get<VoiceSettings>(config, '/settings/voice')
}

export async function voiceSpeak(
  config: HostConfig,
  text: string
): Promise<{ success: boolean; audioData?: string; error?: string }> {
  try {
    const result = await post<{ audioData?: string }>(config, '/settings/voice/speak', { text })
    return { success: true, audioData: result.audioData }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

export async function voiceStopSpeaking(config: HostConfig): Promise<{ success: boolean }> {
  try {
    await post(config, '/settings/voice/stop')
    return { success: true }
  } catch {
    return { success: false }
  }
}

// =============================================================================
// Stub Methods (Unsupported via HTTP)
// =============================================================================

// File dialog operations
export function addProject(): Promise<string | null> {
  console.warn('[HttpApiClient] addProject not available via HTTP - requires file dialog')
  return Promise.resolve(null)
}

export function selectDirectory(): Promise<string | null> {
  console.warn('[HttpApiClient] selectDirectory not available via HTTP - requires file dialog')
  return Promise.resolve(null)
}

export function selectExecutable(): Promise<string | null> {
  console.warn('[HttpApiClient] selectExecutable not available via HTTP')
  return Promise.resolve(null)
}

// PTY backend switching
export function setPtyBackend(_id: string, _backend: BackendId): Promise<void> {
  console.warn('[HttpApiClient] setPtyBackend not implemented in HTTP API')
  return Promise.resolve()
}

// PTY recreated callback
export function onPtyRecreated(
  _callback: (data: { oldId: string; newId: string; backend: BackendId }) => void
): () => void {
  console.warn('[HttpApiClient] onPtyRecreated not implemented in HTTP API')
  return () => {}
}

// Project creation
export function createProject(
  _name: string,
  _parentDir: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  return Promise.resolve({ success: false, error: 'Not available via HTTP - requires file system access' })
}

// Executable running
export function runExecutable(
  _executable: string,
  _cwd: string
): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Not available via HTTP' })
}

// Installation methods
export function claudeInstall(): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Installation not available via HTTP' })
}

export function nodeInstall(): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Installation not available via HTTP' })
}

export function gitInstall(): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Installation not available via HTTP' })
}

export function pythonInstall(): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Installation not available via HTTP' })
}

export function geminiInstall(): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Installation not available via HTTP' })
}

export function codexInstall(): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Installation not available via HTTP' })
}

export function opencodeInstall(): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Installation not available via HTTP' })
}

export function aiderInstall(): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Installation not available via HTTP' })
}

export function onInstallProgress(
  _callback: (data: { type: string; status: string; percent?: number }) => void
): () => void {
  return () => {}
}

// GSD installation
export function gsdCheck(): Promise<{ installed: boolean; npmInstalled: boolean }> {
  return Promise.resolve({ installed: false, npmInstalled: false })
}

export function gsdInstall(): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Installation not available via HTTP' })
}

// Beads installation and watch
export function beadsInstall(): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Installation not available via HTTP' })
}

export function beadsReady(_cwd: string): Promise<{ success: boolean; tasks?: BeadsTask[]; error?: string }> {
  return Promise.resolve({ success: false, error: 'Not available via HTTP' })
}

export function beadsWatch(_cwd: string): Promise<{ success: boolean; error?: string }> {
  console.warn('[HttpApiClient] beadsWatch not available via HTTP')
  return Promise.resolve({ success: false, error: 'Not available via HTTP' })
}

export function beadsUnwatch(_cwd: string): Promise<{ success: boolean; error?: string }> {
  console.warn('[HttpApiClient] beadsUnwatch not available via HTTP')
  return Promise.resolve({ success: false, error: 'Not available via HTTP' })
}

export function onBeadsTasksChanged(_callback: (data: { cwd: string }) => void): () => void {
  console.warn('[HttpApiClient] onBeadsTasksChanged not available via HTTP')
  return () => {}
}

// Window controls
export function windowMinimize(): void {}
export function windowMaximize(): void {}
export function windowClose(): void {}
export function windowIsMaximized(): Promise<boolean> {
  return Promise.resolve(false)
}

// Clipboard
export function readClipboardImage(): Promise<{ success: boolean; hasImage?: boolean; path?: string; error?: string }> {
  return Promise.resolve({ success: false, error: 'Not available via HTTP' })
}

// File utilities
export function getPathForFile(_file: File): string {
  return ''
}

// Debug
export function debugLog(message: string): void {
  console.log('[Debug]', message)
}

export function isDebugMode(): Promise<boolean> {
  return Promise.resolve(false)
}

export function refresh(): Promise<void> {
  window.location.reload()
  return Promise.resolve()
}

export function openExternal(url: string): Promise<void> {
  window.open(url, '_blank')
  return Promise.resolve()
}

// Version/Updates
export function getVersion(): Promise<string> {
  return Promise.resolve('HTTP Client')
}

export function checkForUpdate(): Promise<{ success: boolean; version?: string; error?: string }> {
  return Promise.resolve({ success: false, error: 'Not available via HTTP' })
}

export function downloadUpdate(): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Not available via HTTP' })
}

export function installUpdate(): void {}

export function onUpdaterStatus(
  _callback: (data: { status: string; version?: string; progress?: number; error?: string }) => void
): () => void {
  return () => {}
}

// API Server (meta - we ARE the API client)
export function apiStart(_projectPath: string, _port: number): Promise<{ success: boolean; error?: string }> {
  return Promise.resolve({ success: false, error: 'Cannot start API server from HTTP client' })
}

export function apiStop(_projectPath: string): Promise<{ success: boolean }> {
  return Promise.resolve({ success: false })
}

export function apiStatus(_projectPath: string): Promise<{ running: boolean; port?: number }> {
  return Promise.resolve({ running: false })
}

export function onApiOpenSession(
  _callback: (data: { projectPath: string; autoClose: boolean; model?: string }) => void
): () => void {
  return () => {}
}
