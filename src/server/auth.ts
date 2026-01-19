/**
 * Authentication Module for Mobile API Server
 *
 * Provides token-based authentication for securing API endpoints.
 * Tokens are generated on server startup and displayed for QR code scanning.
 */

import * as crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import type { AuthToken, AuthenticatedRequest } from './types'

// =============================================================================
// Token Storage
// =============================================================================

// Active tokens (in production, consider using a more persistent store)
const activeTokens: Map<string, AuthToken> = new Map()

// The primary server token (displayed for QR code)
let primaryToken: AuthToken | null = null

// =============================================================================
// Token Generation
// =============================================================================

/**
 * Generate a cryptographically secure random token
 */
function generateTokenString(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Create a new auth token
 * @param expiryMs - Token expiry in milliseconds from now (null = never expires)
 */
export function createToken(expiryMs: number | null = null): AuthToken {
  const token: AuthToken = {
    token: generateTokenString(),
    createdAt: Date.now(),
    expiresAt: expiryMs ? Date.now() + expiryMs : null
  }

  activeTokens.set(token.token, token)
  return token
}

/**
 * Generate the primary server token (called on server startup)
 * This token is displayed for QR code scanning by mobile clients
 */
export function generatePrimaryToken(): AuthToken {
  // Revoke existing primary token if any
  if (primaryToken) {
    activeTokens.delete(primaryToken.token)
  }

  primaryToken = createToken(null) // Never expires
  return primaryToken
}

/**
 * Get the current primary token
 */
export function getPrimaryToken(): AuthToken | null {
  return primaryToken
}

/**
 * Regenerate the primary token (for security rotation)
 */
export function regeneratePrimaryToken(): AuthToken {
  return generatePrimaryToken()
}

// =============================================================================
// Token Validation
// =============================================================================

/**
 * Validate a token string
 * @param tokenString - The token to validate
 * @returns The AuthToken if valid, null if invalid or expired
 */
export function validateToken(tokenString: string): AuthToken | null {
  if (!tokenString) {
    return null
  }

  const token = activeTokens.get(tokenString)
  if (!token) {
    return null
  }

  // Check expiry
  if (token.expiresAt !== null && Date.now() > token.expiresAt) {
    // Token expired, remove it
    activeTokens.delete(tokenString)
    return null
  }

  return token
}

/**
 * Revoke a specific token
 */
export function revokeToken(tokenString: string): boolean {
  return activeTokens.delete(tokenString)
}

/**
 * Revoke all tokens (useful for security incidents)
 */
export function revokeAllTokens(): void {
  activeTokens.clear()
  primaryToken = null
}

/**
 * Clean up expired tokens (call periodically)
 */
export function cleanupExpiredTokens(): number {
  const now = Date.now()
  let cleaned = 0

  for (const [tokenString, token] of activeTokens) {
    if (token.expiresAt !== null && now > token.expiresAt) {
      activeTokens.delete(tokenString)
      cleaned++
    }
  }

  return cleaned
}

// =============================================================================
// Express Middleware
// =============================================================================

/**
 * Extract token from request
 * Supports: Authorization header (Bearer), query param (?token=), or body
 */
function extractToken(req: Request): string | null {
  // 1. Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  // 2. Check query parameter
  if (req.query.token && typeof req.query.token === 'string') {
    return req.query.token
  }

  // 3. Check request body (for POST requests)
  if (req.body && req.body.token && typeof req.body.token === 'string') {
    return req.body.token
  }

  return null
}

/**
 * Authentication middleware for Express routes
 * Validates the token and attaches auth info to the request
 */
export function authMiddleware(
  req: Request & { auth?: AuthenticatedRequest },
  res: Response,
  next: NextFunction
): void {
  const tokenString = extractToken(req)

  if (!tokenString) {
    res.status(401).json({
      success: false,
      error: 'Authentication required. Provide token via Authorization header (Bearer), query param (?token=), or request body.',
      timestamp: Date.now()
    })
    return
  }

  const token = validateToken(tokenString)
  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
      timestamp: Date.now()
    })
    return
  }

  // Attach auth info to request for downstream handlers
  req.auth = {
    token: token.token
  }

  next()
}

/**
 * Optional authentication middleware
 * Validates token if provided but doesn't require it
 */
export function optionalAuthMiddleware(
  req: Request & { auth?: AuthenticatedRequest },
  res: Response,
  next: NextFunction
): void {
  const tokenString = extractToken(req)

  if (tokenString) {
    const token = validateToken(tokenString)
    if (token) {
      req.auth = {
        token: token.token
      }
    }
  }

  next()
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get connection info for display (QR code generation)
 */
export function getConnectionInfo(host: string, port: number): {
  token: string
  url: string
  wsUrl: string
  qrData: string
} {
  const token = primaryToken?.token || ''
  const url = `http://${host}:${port}`
  const wsUrl = `ws://${host}:${port}/ws`

  // QR data format: JSON with connection details
  const qrData = JSON.stringify({
    type: 'claude-terminal-mobile',
    version: 1,
    url,
    wsUrl,
    token
  })

  return { token, url, wsUrl, qrData }
}

/**
 * Mask a token for safe logging (shows first 8 chars only)
 */
export function maskToken(token: string): string {
  if (token.length <= 8) {
    return '********'
  }
  return token.slice(0, 8) + '...'
}
