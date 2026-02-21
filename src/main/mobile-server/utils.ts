/**
 * Mobile Server Utilities
 */

import { appendFileSync } from 'fs'
import { app } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { networkInterfaces } from 'os'

export function log(message: string, data?: any): void {
  const timestamp = new Date().toISOString()
  const logLine = data
    ? `[${timestamp}] ${message} ${JSON.stringify(data)}\n`
    : `[${timestamp}] ${message}\n`
  const logPath = join(app.getPath('userData'), 'mobile-server.log')
  appendFileSync(logPath, logLine)
  console.log('[MobileServer]', message, data || '')
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
