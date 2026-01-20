/**
 * Mobile Server Security Module
 *
 * Provides security utilities for the mobile server:
 * - IP classification (localhost, local_network, public)
 * - Rate limiting for failed auth attempts
 * - Server fingerprint generation (persistent identity)
 * - One-time handshake nonces for QR code security
 */

import { randomBytes, createHash } from 'crypto'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// ============================================
// Types
// ============================================

export type IpClass = 'localhost' | 'local_network' | 'public'

export interface RateLimitEntry {
  attempts: number
  lastAttempt: number
  blockedUntil: number | null
}

export interface NonceEntry {
  nonce: string
  createdAt: number
  expiresAt: number
  used: boolean
}

// ============================================
// Constants
// ============================================

const RATE_LIMIT_MAX_ATTEMPTS = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const RATE_LIMIT_BLOCK_DURATION_MS = 15 * 60 * 1000 // 15 minutes

const NONCE_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes
const NONCE_CLEANUP_INTERVAL_MS = 60 * 1000 // 1 minute

// ============================================
// IP Classification
// ============================================

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

  return false
}

/**
 * Extract client IP from request, handling proxies
 */
export function getClientIp(req: { ip?: string; connection?: { remoteAddress?: string }; headers?: Record<string, string | string[] | undefined> }): string {
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

// ============================================
// Rate Limiting
// ============================================

const rateLimitStore = new Map<string, RateLimitEntry>()

/**
 * Check if an IP is rate limited
 * Returns { allowed: boolean, retryAfter?: number }
 */
export function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const entry = rateLimitStore.get(ip)

  if (!entry) {
    return { allowed: true }
  }

  // Check if currently blocked
  if (entry.blockedUntil && entry.blockedUntil > now) {
    return {
      allowed: false,
      retryAfter: Math.ceil((entry.blockedUntil - now) / 1000)
    }
  }

  // Check if window has expired - reset if so
  if (now - entry.lastAttempt > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.delete(ip)
    return { allowed: true }
  }

  return { allowed: true }
}

/**
 * Record a failed authentication attempt for an IP
 * Returns true if the IP is now blocked
 */
export function recordFailedAuth(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitStore.get(ip)

  if (!entry) {
    rateLimitStore.set(ip, {
      attempts: 1,
      lastAttempt: now,
      blockedUntil: null
    })
    return false
  }

  // Reset if window has expired
  if (now - entry.lastAttempt > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, {
      attempts: 1,
      lastAttempt: now,
      blockedUntil: null
    })
    return false
  }

  // Increment attempts
  entry.attempts++
  entry.lastAttempt = now

  // Block if too many attempts
  if (entry.attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
    entry.blockedUntil = now + RATE_LIMIT_BLOCK_DURATION_MS
    return true
  }

  return false
}

/**
 * Clear rate limit for an IP (call on successful auth)
 */
export function clearRateLimit(ip: string): void {
  rateLimitStore.delete(ip)
}

/**
 * Get rate limit status for debugging
 */
export function getRateLimitStatus(ip: string): RateLimitEntry | null {
  return rateLimitStore.get(ip) || null
}

// ============================================
// Server Fingerprint
// ============================================

let cachedFingerprint: string | null = null

/**
 * Get the fingerprint storage path
 */
function getFingerprintPath(): string {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'mobile-server-fingerprint')
}

/**
 * Get or create a persistent server fingerprint
 * This is like an SSH host key - used for TOFU (Trust On First Use)
 */
export function getOrCreateFingerprint(): string {
  if (cachedFingerprint) {
    return cachedFingerprint
  }

  const fingerprintPath = getFingerprintPath()

  // Try to load existing fingerprint
  if (existsSync(fingerprintPath)) {
    try {
      const data = readFileSync(fingerprintPath, 'utf-8')
      const parsed = JSON.parse(data)
      if (parsed.fingerprint && typeof parsed.fingerprint === 'string') {
        cachedFingerprint = parsed.fingerprint
        return parsed.fingerprint
      }
    } catch {
      // Corrupted file, will regenerate
    }
  }

  // Generate new fingerprint
  const randomData = randomBytes(32)
  const fingerprint = createHash('sha256')
    .update(randomData)
    .digest('hex')
    .slice(0, 32) // 32 character fingerprint

  // Save to disk
  try {
    const dir = join(app.getPath('userData'))
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(fingerprintPath, JSON.stringify({
      fingerprint,
      createdAt: Date.now()
    }), 'utf-8')
  } catch (err) {
    console.error('[MobileSecurity] Failed to save fingerprint:', err)
  }

  cachedFingerprint = fingerprint
  return fingerprint
}

/**
 * Get fingerprint formatted for display (groups of 4 chars)
 */
export function getFormattedFingerprint(): string {
  const fp = getOrCreateFingerprint()
  return fp.match(/.{1,4}/g)?.join('-') || fp
}

// ============================================
// Handshake Nonces
// ============================================

const nonceStore = new Map<string, NonceEntry>()
let cleanupInterval: ReturnType<typeof setInterval> | null = null

/**
 * Start the nonce cleanup interval
 */
export function startNonceCleanup(): void {
  if (cleanupInterval) return

  cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [nonce, entry] of nonceStore.entries()) {
      if (entry.expiresAt < now || entry.used) {
        nonceStore.delete(nonce)
      }
    }
  }, NONCE_CLEANUP_INTERVAL_MS)
}

/**
 * Stop the nonce cleanup interval
 */
export function stopNonceCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
}

/**
 * Create a new one-time nonce for QR code handshake
 */
export function createNonce(): { nonce: string; expiresAt: number } {
  const nonce = randomBytes(16).toString('hex')
  const now = Date.now()
  const expiresAt = now + NONCE_EXPIRY_MS

  nonceStore.set(nonce, {
    nonce,
    createdAt: now,
    expiresAt,
    used: false
  })

  return { nonce, expiresAt }
}

/**
 * Verify and consume a nonce
 * Returns true if nonce is valid and not yet used
 */
export function verifyNonce(nonce: string): boolean {
  const entry = nonceStore.get(nonce)

  if (!entry) {
    return false
  }

  const now = Date.now()

  // Check if expired
  if (entry.expiresAt < now) {
    nonceStore.delete(nonce)
    return false
  }

  // Check if already used
  if (entry.used) {
    return false
  }

  // Mark as used
  entry.used = true

  return true
}

/**
 * Get nonce info without consuming it (for debugging)
 */
export function getNonceInfo(nonce: string): NonceEntry | null {
  return nonceStore.get(nonce) || null
}

// ============================================
// Utility Exports
// ============================================

export const securityConfig = {
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_BLOCK_DURATION_MS,
  NONCE_EXPIRY_MS
} as const
