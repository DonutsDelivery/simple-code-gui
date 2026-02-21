/**
 * Mobile Server Security Module
 *
 * Provides security utilities for the mobile server:
 * - IP classification (localhost, local_network, public)
 * - Rate limiting for failed auth attempts
 * - Server fingerprint generation (persistent identity)
 * - One-time handshake nonces for QR code security
 * - Token encryption for secure storage
 * - Path validation and sanitization
 */

// Types
export type { IpClass, RateLimitEntry, NonceEntry, PathValidationResult, PathValidationOptions } from './types.js'

// IP Classification
export { classifyIp, getClientIp } from './ip-classification.js'

// Auth Rate Limiting
export { checkRateLimit, recordFailedAuth, clearRateLimit, getRateLimitStatus, authRateLimitConfig } from './auth-rate-limit.js'

// Endpoint Rate Limiting
export { checkEndpointRateLimit, cleanupEndpointRateLimits, endpointRateLimitConfig } from './endpoint-rate-limit.js'

// Server Fingerprint (legacy - use certificate fingerprint for new code)
export { getOrCreateFingerprint, getFormattedFingerprint } from './fingerprint.js'

// TLS Certificate (for HTTPS with certificate pinning)
export {
  getOrCreateCertificate,
  getCertificateFingerprint,
  getFormattedCertFingerprint,
  getTlsOptions,
  regenerateCertificate,
  certificateExists
} from './certificate.js'
export type { CertificateData } from './certificate.js'

// Nonce Management
export { startNonceCleanup, stopNonceCleanup, createNonce, verifyNonce, getNonceInfo, nonceConfig } from './nonces.js'

// Token Encryption
export { encryptToken, decryptToken, writeSecureFile } from './encryption.js'

// Path Validation
export { validatePath, validateProjectPath, validateFilePath, validateDirectoryPath } from './path-validation.js'

// Combined security config for backwards compatibility
export const securityConfig = {
  RATE_LIMIT_MAX_ATTEMPTS: 5,
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  RATE_LIMIT_BLOCK_DURATION_MS: 15 * 60 * 1000,
  NONCE_EXPIRY_MS: 5 * 60 * 1000
} as const
