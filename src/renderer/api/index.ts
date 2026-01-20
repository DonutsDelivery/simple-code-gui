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

let apiInstance: Api | null = null

/**
 * Check if running in Electron environment with electronAPI available
 */
export function isElectronEnvironment(): boolean {
  return isElectronAvailable()
}

/**
 * Get the current API instance (may be null if not initialized)
 */
export function getApi(): Api | null {
  return apiInstance
}

/**
 * Initialize the API with the appropriate backend
 * - In Electron: Automatically uses ElectronBackend
 * - In browser/Capacitor: Requires config parameter for HttpBackend
 */
export function initializeApi(config?: { host: string; port: number; token: string }): Api {
  if (isElectronEnvironment()) {
    apiInstance = new ElectronBackend()
  } else if (config) {
    apiInstance = new HttpBackend(config)
  } else {
    throw new Error('HTTP backend requires connection config')
  }
  return apiInstance
}

/**
 * Set the API instance directly (useful for testing or custom backends)
 */
export function setApi(api: Api): void {
  apiInstance = api
}

/**
 * Clear the API instance
 */
export function clearApi(): void {
  apiInstance = null
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

export type {
  ApiClient,
  BeadsTask,
  BeadsCloseResult,
  GSDProgress
} from './httpClient'

export {
  HttpApiClient,
  getElectronAPI,
  createApiClient,
  getApiClient,
  setHttpClient
} from './httpClient'
