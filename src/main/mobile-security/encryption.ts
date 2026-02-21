/**
 * Token Encryption Module
 *
 * Provides machine-specific encryption for secure token storage.
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto'
import { writeFileSync, chmodSync } from 'fs'
import { homedir, hostname, userInfo } from 'os'

// Salt for key derivation (app-specific, not secret)
const TOKEN_ENCRYPTION_SALT = 'claude-terminal-token-v1'
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'

/**
 * Derive a machine-specific encryption key
 * This makes the encrypted token non-portable to other machines
 */
function deriveEncryptionKey(): Buffer {
  // Combine machine-specific values to create a unique key
  // This prevents the token from being useful if copied to another machine
  const machineId = [
    hostname(),
    userInfo().username,
    homedir(),
    process.platform,
    process.arch
  ].join(':')

  // Use scrypt to derive a 32-byte key
  return scryptSync(machineId, TOKEN_ENCRYPTION_SALT, 32)
}

/**
 * Encrypt a token for secure storage
 * Returns base64-encoded encrypted data with IV and auth tag
 */
export function encryptToken(token: string): string {
  const key = deriveEncryptionKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv)

  let encrypted = cipher.update(token, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // Format: iv:authTag:encrypted (all hex encoded)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * Decrypt a stored token
 * Returns null if decryption fails (e.g., wrong machine, corrupted data)
 */
export function decryptToken(encryptedData: string): string | null {
  try {
    const parts = encryptedData.split(':')
    if (parts.length !== 3) {
      return null
    }

    const [ivHex, authTagHex, encrypted] = parts
    const key = deriveEncryptionKey()
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')

    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch {
    // Decryption failed - token may be corrupted or from different machine
    return null
  }
}

/**
 * Securely write a file with restricted permissions
 * On Unix, sets permissions to owner-only (0600)
 */
export function writeSecureFile(filePath: string, content: string): void {
  writeFileSync(filePath, content, 'utf-8')

  // Set restrictive file permissions (owner read/write only)
  try {
    chmodSync(filePath, 0o600)
  } catch {
    // Ignore chmod errors on Windows
  }
}
