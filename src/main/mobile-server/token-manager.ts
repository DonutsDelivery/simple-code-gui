/**
 * Token Manager - Token CRUD and encryption
 */

import { randomBytes } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'
import {
  encryptToken,
  decryptToken,
  writeSecureFile
} from '../mobile-security'
import { log } from './utils'

export function getTokenPath(): string {
  return join(app.getPath('userData'), 'mobile-server-token')
}

export function loadOrCreateToken(): string {
  const tokenPath = getTokenPath()
  try {
    if (existsSync(tokenPath)) {
      const storedData = readFileSync(tokenPath, 'utf-8').trim()

      // Try to decrypt (new encrypted format)
      const decrypted = decryptToken(storedData)
      if (decrypted && decrypted.length === 64) {
        log('Loaded existing encrypted token')
        return decrypted
      }

      // Fallback: check if it's an old unencrypted token (migration path)
      if (storedData.length === 64 && /^[a-f0-9]+$/.test(storedData)) {
        log('Migrating unencrypted token to encrypted storage')
        // Re-save with encryption
        const encrypted = encryptToken(storedData)
        writeSecureFile(tokenPath, encrypted)
        return storedData
      }
    }
  } catch (err) {
    log('Failed to load token, generating new one', { error: String(err) })
  }

  // Generate and save new token with encryption
  const token = randomBytes(32).toString('hex')
  try {
    const encrypted = encryptToken(token)
    writeSecureFile(tokenPath, encrypted)
    log('Generated and saved new encrypted token')
  } catch (err) {
    log('Failed to save token', { error: String(err) })
  }
  return token
}

export function saveToken(token: string): void {
  try {
    const encrypted = encryptToken(token)
    writeSecureFile(getTokenPath(), encrypted)
    log('Saved encrypted token')
  } catch (err) {
    log('Failed to save token', { error: String(err) })
  }
}

export function regenerateToken(): string {
  const token = randomBytes(32).toString('hex')
  try {
    const encrypted = encryptToken(token)
    writeSecureFile(getTokenPath(), encrypted)
    log('Regenerated and saved encrypted token')
  } catch (err) {
    log('Failed to save regenerated token', { error: String(err) })
  }
  return token
}
