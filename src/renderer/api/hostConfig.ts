/**
 * Host Configuration Storage
 *
 * Handles storing and retrieving host configuration from localStorage
 * for connecting to the Claude Terminal API server.
 */

// =============================================================================
// Types
// =============================================================================

export interface HostConfig {
  host: string
  port: number
  token: string
  secure?: boolean // Use HTTPS/WSS
}

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = 'claude-terminal-host-config'

const DEFAULT_CONFIG: HostConfig = {
  host: 'localhost',
  port: 38470,
  token: '',
  secure: false
}

// =============================================================================
// Storage Functions
// =============================================================================

/**
 * Get the stored host configuration
 * Returns null if no configuration is stored
 */
export function getHostConfig(): HostConfig | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return null
    }

    const config = JSON.parse(stored) as HostConfig

    // Validate required fields
    if (!config.host || !config.port || !config.token) {
      return null
    }

    return config
  } catch (error) {
    console.error('[HostConfig] Failed to parse stored config:', error)
    return null
  }
}

/**
 * Save host configuration to localStorage
 */
export function saveHostConfig(config: HostConfig): void {
  try {
    // Validate required fields
    if (!config.host || !config.port || !config.token) {
      throw new Error('Host, port, and token are required')
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.error('[HostConfig] Failed to save config:', error)
    throw error
  }
}

/**
 * Clear stored host configuration
 */
export function clearHostConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Check if host configuration is stored
 */
export function hasHostConfig(): boolean {
  return getHostConfig() !== null
}

/**
 * Get the default configuration (without token)
 */
export function getDefaultConfig(): Omit<HostConfig, 'token'> {
  return {
    host: DEFAULT_CONFIG.host,
    port: DEFAULT_CONFIG.port,
    secure: DEFAULT_CONFIG.secure
  }
}

// =============================================================================
// URL Builders
// =============================================================================

/**
 * Validate port number - returns true if valid
 */
function isValidPort(port: number): boolean {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * Build the base HTTP URL for API requests
 */
export function buildBaseUrl(config: HostConfig): string {
  if (!isValidPort(config.port)) {
    console.error('[hostConfig] Invalid port for buildBaseUrl:', config.port)
    throw new Error(`Invalid port: ${config.port}`)
  }
  const protocol = config.secure ? 'https' : 'http'
  return `${protocol}://${config.host}:${config.port}`
}

/**
 * Build the WebSocket URL
 */
export function buildWsUrl(config: HostConfig): string {
  if (!isValidPort(config.port)) {
    console.error('[hostConfig] Invalid port for buildWsUrl:', config.port)
    throw new Error(`Invalid port: ${config.port}`)
  }
  const protocol = config.secure ? 'wss' : 'ws'
  return `${protocol}://${config.host}:${config.port}/ws`
}

/**
 * Build a full API endpoint URL
 */
export function buildApiUrl(config: HostConfig, endpoint: string): string {
  const base = buildBaseUrl(config)
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  return `${base}/api${path}`
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a host configuration object
 */
export function validateHostConfig(config: Partial<HostConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!config.host || typeof config.host !== 'string') {
    errors.push('Host is required and must be a string')
  } else if (!/^[a-zA-Z0-9.-]+$/.test(config.host)) {
    errors.push('Host contains invalid characters')
  }

  if (!config.port || typeof config.port !== 'number') {
    errors.push('Port is required and must be a number')
  } else if (config.port < 1 || config.port > 65535) {
    errors.push('Port must be between 1 and 65535')
  }

  if (!config.token || typeof config.token !== 'string') {
    errors.push('Token is required and must be a string')
  } else if (config.token.length < 8) {
    errors.push('Token must be at least 8 characters')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Parse a connection URL string (e.g., "http://192.168.1.100:38470?token=abc123")
 */
export function parseConnectionUrl(url: string): HostConfig | null {
  try {
    const parsed = new URL(url)

    const host = parsed.hostname
    const port = parseInt(parsed.port, 10) || (parsed.protocol === 'https:' ? 443 : 80)
    const token = parsed.searchParams.get('token') || ''
    const secure = parsed.protocol === 'https:'

    if (!host || !token) {
      return null
    }

    // Validate port
    if (!isValidPort(port)) {
      console.error('[hostConfig] parseConnectionUrl: Invalid port:', port)
      return null
    }

    return { host, port, token, secure }
  } catch {
    return null
  }
}

/**
 * Generate a connection URL string from config
 */
export function generateConnectionUrl(config: HostConfig): string {
  const protocol = config.secure ? 'https' : 'http'
  return `${protocol}://${config.host}:${config.port}?token=${encodeURIComponent(config.token)}`
}
