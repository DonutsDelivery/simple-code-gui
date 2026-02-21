// ============================================
// Helper Functions for useHostConnection
// ============================================

import type { HostConfig } from './types.js'
import { STORAGE_KEY } from './constants.js'

/**
 * Generate a unique ID for hosts
 */
export function generateId(): string {
  return `host-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Load hosts from localStorage
 */
export function loadHosts(): HostConfig[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []

    const hosts = JSON.parse(stored) as HostConfig[]

    // Convert date strings back to Date objects
    return hosts.map(host => ({
      ...host,
      lastConnected: host.lastConnected ? new Date(host.lastConnected) : undefined
    }))
  } catch {
    return []
  }
}

/**
 * Save hosts to localStorage
 */
export function saveHosts(hosts: HostConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hosts))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Check if host is a local/private network address
 * Includes: localhost, private IPv4 ranges, Tailscale CGNAT (100.64-127.x.x), and MagicDNS (*.ts.net)
 */
export function isLocalNetwork(hostname: string): boolean {
  // RFC 1918 private ranges + Tailscale CGNAT (100.64-127.x.x) + MagicDNS (*.ts.net)
  return /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(hostname) ||
         hostname.endsWith('.ts.net')
}

/**
 * Validate port number - returns true if valid
 */
export function isValidPort(port: number): boolean {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * Build WebSocket URL from host config
 * Token passed via query string for Capacitor WebView compatibility
 */
export function buildWebSocketUrl(host: HostConfig): string {
  // Validate port before building URL
  if (!isValidPort(host.port)) {
    console.error('[useHostConnection] Invalid port for WebSocket URL:', host.port)
    throw new Error(`Invalid port: ${host.port}`)
  }
  // Use wss:// if server has TLS enabled, otherwise ws:// for local networks
  // v3 servers always report secure flag; fallback to network-based for v2 compat
  const protocol = host.secure ?? !isLocalNetwork(host.host) ? 'wss' : 'ws'
  return `${protocol}://${host.host}:${host.port}/ws?token=${encodeURIComponent(host.token)}`
}

/**
 * Build HTTP URL from host config
 */
export function buildHttpUrl(host: HostConfig, path: string): string {
  // Validate port before building URL
  if (!isValidPort(host.port)) {
    console.error('[useHostConnection] Invalid port for HTTP URL:', host.port)
    throw new Error(`Invalid port: ${host.port}`)
  }
  // Use https:// if server has TLS enabled, otherwise http:// for local networks
  // v3 servers always report secure flag; fallback to network-based for v2 compat
  const protocol = host.secure ?? !isLocalNetwork(host.host) ? 'https' : 'http'
  return `${protocol}://${host.host}:${host.port}${path}`
}

/**
 * Verify handshake with server
 * Returns the server's fingerprint and TLS info if successful
 */
export async function verifyHandshake(host: HostConfig, nonce: string): Promise<{
  success: boolean
  fingerprint?: string
  certFingerprint?: string
  secure?: boolean
  error?: string
}> {
  try {
    const url = buildHttpUrl(host, '/verify-handshake')
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce })
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return { success: false, error: data.error || `HTTP ${response.status}` }
    }

    const data = await response.json()
    if (data.valid && data.fingerprint) {
      return {
        success: true,
        fingerprint: data.fingerprint,
        certFingerprint: data.certFingerprint,
        secure: data.secure
      }
    }

    return { success: false, error: 'Invalid handshake response' }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}
