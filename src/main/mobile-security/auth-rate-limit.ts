/**
 * Authentication Rate Limiting Module
 *
 * Provides rate limiting for failed authentication attempts.
 */

import type { RateLimitEntry } from './types.js'

// Constants
const RATE_LIMIT_MAX_ATTEMPTS = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const RATE_LIMIT_BLOCK_DURATION_MS = 15 * 60 * 1000 // 15 minutes

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

export const authRateLimitConfig = {
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_BLOCK_DURATION_MS
} as const
