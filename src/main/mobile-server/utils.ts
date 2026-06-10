/**
 * Mobile Server Utilities
 */

import { appendFileSync } from 'fs'
import { app } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { networkInterfaces } from 'os'
import { timingSafeEqual } from 'crypto'

/**
 * Constant-time comparison of two secret strings (M4). Avoids leaking how many
 * leading characters of a guessed token match via response timing. Tokens here
 * are fixed-length hex, so the early length check leaks nothing useful.
 */
export function tokensEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function log(message: string, data?: any): void {
  const timestamp = new Date().toISOString()
  const logLine = data
    ? `[${timestamp}] ${message} ${JSON.stringify(data)}\n`
    : `[${timestamp}] ${message}\n`
  const logPath = join(app.getPath('userData'), 'mobile-server.log')
  appendFileSync(logPath, logLine)
  console.log('[MobileServer]', message, data || '')
}

/**
 * The server-side allowlist of directories a LAN/mobile client is permitted to
 * spawn a backend in or read files from: the roots of the user's registered
 * workspace projects. Returns [] when no store / no projects, which makes the
 * project-scoped path checks fail closed.
 */
export function getProjectRoots(sessionStore: any): string[] {
  try {
    const projects = sessionStore?.getWorkspace?.()?.projects
    if (!Array.isArray(projects)) return []
    return projects
      .map((p: any) => p?.path)
      .filter((p: any): p is string => typeof p === 'string' && p.length > 0)
  } catch {
    return []
  }
}

export function getRendererPath(): string {
  // Check if running in development
  if (process.env.NODE_ENV === 'development') {
    return resolve(__dirname, '../../../dist/renderer')
  }
  // Production - check common locations
  const appPath = app.getAppPath()
  // If running from asar, renderer is in dist/renderer inside the asar
  if (appPath.includes('.asar')) {
    return join(appPath, 'dist/renderer')
  }
  // Otherwise check relative paths
  const possiblePaths = [
    join(appPath, 'dist/renderer'),
    join(appPath, '../renderer'),
    resolve(__dirname, '../../../dist/renderer'),
    resolve(__dirname, '../../renderer')
  ]
  for (const p of possiblePaths) {
    if (existsSync(join(p, 'index.html'))) {
      return p
    }
  }
  // Fallback
  return join(appPath, 'dist/renderer')
}

export function isStaticPath(path: string): boolean {
  return path === '/' ||
         path === '/index.html' ||
         path.startsWith('/assets/') ||
         path.endsWith('.js') ||
         path.endsWith('.css') ||
         path.endsWith('.svg') ||
         path.endsWith('.png') ||
         path.endsWith('.ico') ||
         path.endsWith('.woff') ||
         path.endsWith('.woff2')
}

export function getLocalIPs(): string[] {
  const ips: string[] = []
  const interfaces = networkInterfaces()

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Skip internal and non-IPv4 addresses
      if (iface.internal || iface.family !== 'IPv4') continue
      ips.push(iface.address)
    }
  }

  return ips
}

export function getTailscaleHostname(): string | null {
  try {
    const { execSync } = require('child_process')
    const output = execSync('tailscale status --json', { encoding: 'utf-8', timeout: 5000 })
    const status = JSON.parse(output)
    // Get the DNS name for this machine
    if (status.Self && status.Self.DNSName) {
      // DNSName ends with a dot, remove it
      return status.Self.DNSName.replace(/\.$/, '')
    }
  } catch {
    // Tailscale not installed or not running
  }
  return null
}
