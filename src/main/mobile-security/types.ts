/**
 * Mobile Security Types
 *
 * Shared type definitions for the mobile security module.
 */

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

export interface EndpointRateLimitEntry {
  count: number
  windowStart: number
}

export interface PathValidationResult {
  valid: boolean
  error?: string
  normalizedPath?: string
}

export interface PathValidationOptions {
  mustExist?: boolean
  mustBeDirectory?: boolean
  allowedBasePaths?: string[]
}
