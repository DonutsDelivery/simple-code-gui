/**
 * Mobile Server Security Module
 *
 * Provides security utilities for the mobile server:
 * - IP classification (localhost, local_network, public)
 * - Rate limiting for failed auth attempts
 * - Server fingerprint generation (persistent identity)
 * - One-time handshake nonces for QR code security
 */

import { randomBytes, createHash, createCipheriv, createDecipheriv, scryptSync } from 'crypto'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, chmodSync } from 'fs'
import { join, resolve, isAbsolute, normalize } from 'path'
import { homedir, hostname, userInfo } from 'os'

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

  // 100.64.0.0/10 - Tailscale CGNAT range (100.64.0.0 - 100.127.255.255)
  if (a === 100 && b >= 64 && b <= 127) return true

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
// Per-Endpoint Rate Limiting
// ============================================

interface EndpointRateLimitEntry {
  count: number
  windowStart: number
}

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
  'default': 60
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

// ============================================
// Token Encryption
// ============================================

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

// ============================================
// Path Sanitization
// ============================================

// Sensitive paths that should never be accessed
const BLOCKED_PATHS = [
  '/etc',
  '/var',
  '/usr',
  '/bin',
  '/sbin',
  '/boot',
  '/proc',
  '/sys',
  '/dev',
  '/root',
  '/lib',
  '/lib64',
  // Windows system paths
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  // macOS system paths
  '/System',
  '/Library',
  '/private'
]

export interface PathValidationResult {
  valid: boolean
  error?: string
  normalizedPath?: string
}

/**
 * Validate and sanitize a path parameter
 * Prevents path traversal attacks and access to sensitive directories
 */
export function validatePath(inputPath: string, options: {
  mustExist?: boolean
  mustBeDirectory?: boolean
  allowedBasePaths?: string[] // If provided, path must be under one of these
} = {}): PathValidationResult {
  // Check for empty or invalid input
  if (!inputPath || typeof inputPath !== 'string') {
    return { valid: false, error: 'Path is required and must be a string' }
  }

  // Trim whitespace
  const trimmedPath = inputPath.trim()
  if (trimmedPath.length === 0) {
    return { valid: false, error: 'Path cannot be empty' }
  }

  // Reject paths with null bytes (common injection technique)
  if (trimmedPath.includes('\0')) {
    return { valid: false, error: 'Path contains invalid characters' }
  }

  // Normalize the path to resolve . and .. segments
  let normalizedPath: string
  try {
    // If relative, resolve against home directory (safe default)
    if (!isAbsolute(trimmedPath)) {
      normalizedPath = resolve(homedir(), trimmedPath)
    } else {
      normalizedPath = resolve(trimmedPath)
    }
    normalizedPath = normalize(normalizedPath)
  } catch {
    return { valid: false, error: 'Invalid path format' }
  }

  // Check for path traversal attempts in the original input
  // Even after normalization, check if the original contained suspicious patterns
  if (trimmedPath.includes('..') && !normalizedPath.startsWith(resolve(trimmedPath.split('..')[0]))) {
    return { valid: false, error: 'Path traversal detected' }
  }

  // Check against blocked system paths
  const lowerPath = normalizedPath.toLowerCase()
  for (const blocked of BLOCKED_PATHS) {
    if (lowerPath.startsWith(blocked.toLowerCase())) {
      return { valid: false, error: 'Access to system directories is not allowed' }
    }
  }

  // If allowed base paths specified, verify path is under one of them
  if (options.allowedBasePaths && options.allowedBasePaths.length > 0) {
    const isUnderAllowed = options.allowedBasePaths.some(basePath => {
      const normalizedBase = normalize(resolve(basePath))
      return normalizedPath.startsWith(normalizedBase)
    })
    if (!isUnderAllowed) {
      return { valid: false, error: 'Path is not within allowed directories' }
    }
  }

  // Check existence if required
  if (options.mustExist) {
    if (!existsSync(normalizedPath)) {
      return { valid: false, error: 'Path does not exist' }
    }
  }

  // Check if directory if required
  if (options.mustBeDirectory) {
    try {
      const stats = statSync(normalizedPath)
      if (!stats.isDirectory()) {
        return { valid: false, error: 'Path must be a directory' }
      }
    } catch {
      return { valid: false, error: 'Unable to access path' }
    }
  }

  return { valid: true, normalizedPath }
}

/**
 * Quick validation for project paths (cwd, projectPath parameters)
 * Must exist and be a directory
 */
export function validateProjectPath(path: string): PathValidationResult {
  return validatePath(path, {
    mustExist: true,
    mustBeDirectory: true
  })
}
