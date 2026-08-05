/**
 * API Module
 *
 * Provides a unified API client that works with both Electron IPC and HTTP transport.
 * Import from this module to get the appropriate client for your environment.
 */

import { Api } from './types'
import { ElectronBackend, isElectronAvailable } from './electron-backend'
import { HttpBackend } from './http-backend'

// =============================================================================
// API Instance Management
// =============================================================================

const apiInstances = new Map<string, Api>()

/**
 * Check if running in Electron environment with electronAPI available
 */
export function isElectronEnvironment(): boolean {
  return isElectronAvailable()
}

/**
 * Get the current API instance (may be null if not initialized)
 */
export function getApi(serverId: string): Api | null {
  return apiInstances.get(serverId) || null
}

/**
 * Initialize the API with the appropriate backend
 * - Remote connection config always uses HttpBackend (including inside Electron
 *   when pairing to an external Server)
 * - Local Electron without config uses ElectronBackend
 * - Browser/Capacitor requires config for HttpBackend
 */
export function initializeApi(config?: { host: string; port: number; token: string; secure?: boolean }): Api {
  if (config) {
    return new HttpBackend(config)
  }
  if (isElectronEnvironment()) {
    return new ElectronBackend()
  }
  throw new Error('HTTP backend requires connection config')
}

/**
 * Set the API instance directly (useful for testing or custom backends)
 */
export function setApi(api: Api): string {
  const serverId = api.getServerProtocol?.()?.serverId
  if (!serverId) throw new Error('Cannot register an API without a stable server ID')
  apiInstances.set(serverId, api)
  return serverId
}

/**
 * Clear the API instance
 */
export function clearApi(serverId: string): void {
  apiInstances.delete(serverId)
}

export function getConnectedServerIds(): string[] {
  return [...apiInstances.keys()]
}

// =============================================================================
// Re-export types and backends
// =============================================================================

export type { Api, ExtendedApi, ConnectionState, ApiBackendType } from './types'
export type {
  Settings,
  ProjectCategory,
  Project,
  OpenTab,
  TileLayout,
  Workspace,
  Session,
  VoiceSettings,
  PtyDataCallback,
  PtyExitCallback,
  PtyRecreatedCallback,
  ApiOpenSessionCallback,
  Unsubscribe,
  ApiContext
} from './types'

export { ElectronBackend, isElectronAvailable, getElectronBackend } from './electron-backend'
export { HttpBackend, createHttpBackend } from './http-backend'

// =============================================================================
// Host configuration - types and functions (legacy exports for compatibility)
// =============================================================================

export type { HostConfig } from './hostConfig'

export {
  getHostConfig,
  saveHostConfig,
  clearHostConfig,
  hasHostConfig,
  getDefaultConfig,
  buildBaseUrl,
  buildWsUrl,
  buildApiUrl,
  validateHostConfig,
  parseConnectionUrl,
  generateConnectionUrl
} from './hostConfig'

// =============================================================================
// HTTP Client exports (legacy compatibility)
// =============================================================================

export type { ApiClient } from './httpClient'

export {
  HttpApiClient,
  getElectronAPI,
  createApiClient,
  getApiClient,
  setHttpClient
} from './httpClient'
