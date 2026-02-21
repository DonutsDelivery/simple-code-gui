/**
 * Server Fingerprint Module
 *
 * Generates and manages a persistent server fingerprint.
 * This is like an SSH host key - used for TOFU (Trust On First Use).
 */

import { randomBytes, createHash } from 'crypto'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

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
    writeFileSync(
      fingerprintPath,
      JSON.stringify({
        fingerprint,
        createdAt: Date.now()
      }),
      'utf-8'
    )
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
