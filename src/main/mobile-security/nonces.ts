/**
 * Nonce Management Module
 *
 * Manages one-time handshake nonces for QR code security.
 */

import { randomBytes } from 'crypto'
import type { NonceEntry } from './types.js'

const NONCE_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes
const NONCE_CLEANUP_INTERVAL_MS = 60 * 1000 // 1 minute

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

export const nonceConfig = {
  NONCE_EXPIRY_MS,
  NONCE_CLEANUP_INTERVAL_MS
} as const
