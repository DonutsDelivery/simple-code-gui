/**
 * IP Classification Module
 *
 * Classifies IP addresses as localhost, local_network, or public.
 */

import type { IpClass } from './types.js'

/**
 * Classify an IP address as localhost, local_network, or public
 */
export function classifyIp(ip: string): IpClass {
  // Handle IPv6 localhost
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    return 'localhost'
  }

  // Handle IPv4 localhost
  if (ip === '127.0.0.1' || ip.startsWith('127.')) {
    return 'localhost'
  }

  // Handle IPv4-mapped IPv6 addresses
  const ipv4Match = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  const ipToCheck = ipv4Match ? ipv4Match[1] : ip

  // Check for private/local network ranges (RFC 1918 + link-local)
  if (isPrivateIp(ipToCheck)) {
    return 'local_network'
  }

  return 'public'
}

/**
 * Check if an IP is in a private/local network range
 */
function isPrivateIp(ip: string): boolean {
  const parts = ip.split('.').map(Number)

  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return false
  }

  const [a, b] = parts

  // 10.0.0.0/8 - Class A private
  if (a === 10) return true

  // 172.16.0.0/12 - Class B private
  if (a === 172 && b >= 16 && b <= 31) return true

  // 192.168.0.0/16 - Class C private
  if (a === 192 && b === 168) return true

  // 169.254.0.0/16 - Link-local
  if (a === 169 && b === 254) return true

  // 100.64.0.0/10 - Tailscale CGNAT range (100.64.0.0 - 100.127.255.255)
  if (a === 100 && b >= 64 && b <= 127) return true

  return false
}

/**
 * Extract client IP from request, handling proxies
 */
export function getClientIp(req: {
  ip?: string
  connection?: { remoteAddress?: string }
  headers?: Record<string, string | string[] | undefined>
}): string {
  // Check X-Forwarded-For header (should only trust on localhost)
  const forwarded = req.headers?.['x-forwarded-for']
  if (forwarded) {
    const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim()
    // Only trust forwarded header if request comes from localhost
    const directIp = req.ip || req.connection?.remoteAddress || ''
    if (classifyIp(directIp) === 'localhost') {
      return forwardedIp
    }
  }

  return req.ip || req.connection?.remoteAddress || 'unknown'
}
