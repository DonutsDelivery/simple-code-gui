/**
 * API Module
 *
 * Provides a unified API client that works with both Electron IPC and HTTP transport.
 * Import from this module to get the appropriate client for your environment.
 */

// Host configuration - types
export type { HostConfig } from './hostConfig'

// Host configuration - functions
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

// HTTP Client - types
export type {
  ApiClient,
  Settings,
  Project,
  ProjectCategory,
  OpenTab,
  TileLayout,
  Workspace,
  Session,
  BeadsTask,
  BeadsCloseResult,
  VoiceSettings,
  GSDProgress
} from './httpClient'

// HTTP Client - classes and functions
export {
  HttpApiClient,
  isElectronEnvironment,
  getElectronAPI,
  createApiClient,
  getApiClient,
  setHttpClient
} from './httpClient'
