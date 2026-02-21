/**
 * Endpoint Rate Limiting Module
 *
 * Provides per-endpoint rate limiting for API requests.
 */

import type { EndpointRateLimitEntry } from './types.js'

// Store: ip:endpoint -> { count, windowStart }
const endpointRateLimitStore = new Map<string, EndpointRateLimitEntry>()

// Default limits per endpoint category (requests per minute)
const ENDPOINT_RATE_LIMITS: Record<string, number> = {
  // Write operations are more restricted
  'POST:/api/terminal/create': 10,
  'POST:/api/pty/spawn': 10,
  'POST:/api/pty/write': 120, // Higher limit for typing
  'POST:/api/tts/speak': 30,
  // Beads operations
  'POST:/projects/beads': 30,
  'PATCH:/projects/beads': 30,
  'DELETE:/projects/beads': 20,
  // Read operations have higher limits
  'GET:/api': 60,
  'GET:/projects': 60,
  // Default fallback
  default: 60
}

const ENDPOINT_RATE_WINDOW_MS = 60 * 1000 // 1 minute window

/**
 * Get the rate limit for an endpoint
 */
function getEndpointRateLimit(method: string, path: string): number {
  // Try exact match first
  const exactKey = `${method}:${path}`
  if (ENDPOINT_RATE_LIMITS[exactKey]) {
    return ENDPOINT_RATE_LIMITS[exactKey]
  }

  // Try prefix matches
  for (const [key, limit] of Object.entries(ENDPOINT_RATE_LIMITS)) {
    if (exactKey.startsWith(key)) {
      return limit
    }
  }

  return ENDPOINT_RATE_LIMITS['default']
}

/**
 * Check if a request is rate limited by endpoint
 * Returns { allowed: boolean, remaining: number, resetIn: number }
 */
export function checkEndpointRateLimit(
  ip: string,
  method: string,
  path: string
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now()
  const limit = getEndpointRateLimit(method, path)
  const key = `${ip}:${method}:${path}`

  const entry = endpointRateLimitStore.get(key)

  if (!entry) {
    // First request in this window
    endpointRateLimitStore.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: limit - 1, resetIn: ENDPOINT_RATE_WINDOW_MS }
  }

  // Check if window has expired
  if (now - entry.windowStart >= ENDPOINT_RATE_WINDOW_MS) {
    // Start new window
    endpointRateLimitStore.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: limit - 1, resetIn: ENDPOINT_RATE_WINDOW_MS }
  }

  // Within window - check count
  if (entry.count >= limit) {
    const resetIn = ENDPOINT_RATE_WINDOW_MS - (now - entry.windowStart)
    return { allowed: false, remaining: 0, resetIn }
  }

  // Increment count
  entry.count++
  const remaining = limit - entry.count
  const resetIn = ENDPOINT_RATE_WINDOW_MS - (now - entry.windowStart)
  return { allowed: true, remaining, resetIn }
}

/**
 * Clean up expired endpoint rate limit entries
 * Call periodically to prevent memory growth
 */
export function cleanupEndpointRateLimits(): void {
  const now = Date.now()
  for (const [key, entry] of endpointRateLimitStore.entries()) {
    if (now - entry.windowStart >= ENDPOINT_RATE_WINDOW_MS * 2) {
      endpointRateLimitStore.delete(key)
    }
  }
}

export const endpointRateLimitConfig = {
  ENDPOINT_RATE_LIMITS,
  ENDPOINT_RATE_WINDOW_MS
} as const
