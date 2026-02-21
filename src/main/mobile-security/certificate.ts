/**
 * TLS Certificate Module
 *
 * Generates and manages self-signed TLS certificates for secure mobile connections.
 * Uses certificate pinning (like Syncthing) - the certificate fingerprint is shared
 * via QR code and verified by the mobile app during TLS handshake.
 *
 * Security model:
 * - Server generates self-signed certificate at first startup
 * - Certificate fingerprint (SHA256 of DER) = device identity
 * - Mobile app verifies fingerprint matches QR code before trusting connection
 * - All traffic encrypted with TLS 1.2/1.3
 */

import { createHash } from 'crypto'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { generate } from 'selfsigned'

export interface CertificateData {
  privateKey: string
  certificate: string
  fingerprint: string
  createdAt: number
}

let cachedCertificate: CertificateData | null = null

/**
 * Get the certificate storage directory
 */
function getCertificatePath(): string {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'tls')
}

/**
 * Compute SHA256 fingerprint of certificate in DER format
 * This matches how Syncthing computes device IDs
 */
function computeCertFingerprint(certPem: string): string {
  // Convert PEM to DER by removing headers and decoding base64
  const pemContent = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '')

  const derBuffer = Buffer.from(pemContent, 'base64')
  return createHash('sha256').update(derBuffer).digest('hex')
}

/**
 * Generate a new self-signed TLS certificate
 */
async function generateCertificate(): Promise<CertificateData> {
  const attrs = [
    { name: 'commonName', value: 'claude-terminal' },
    { name: 'organizationName', value: 'Claude Terminal' }
  ]

  // Generate certificate with selfsigned library
  // Using RSA 2048 for broad compatibility with mobile TLS libraries
  const pems = await generate(attrs, {
    keySize: 2048,
    days: 3650, // 10 years - we're pinning, not trusting CAs
    algorithm: 'sha256',
    extensions: [
      {
        name: 'basicConstraints',
        cA: false
      },
      {
        name: 'keyUsage',
        keyCertSign: false,
        digitalSignature: true,
        keyEncipherment: true
      },
      {
        name: 'extKeyUsage',
        serverAuth: true
      },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' }, // DNS
          { type: 7, ip: '127.0.0.1' }, // IP
          { type: 7, ip: '0.0.0.0' } // Any IP (for local network)
        ]
      }
    ]
  })

  const fingerprint = computeCertFingerprint(pems.cert)

  return {
    privateKey: pems.private,
    certificate: pems.cert,
    fingerprint,
    createdAt: Date.now()
  }
}

/**
 * Load certificate from disk
 */
function loadCertificate(): CertificateData | null {
  const certPath = getCertificatePath()
  const keyFile = join(certPath, 'key.pem')
  const certFile = join(certPath, 'cert.pem')
  const metaFile = join(certPath, 'meta.json')

  if (!existsSync(keyFile) || !existsSync(certFile)) {
    return null
  }

  try {
    const privateKey = readFileSync(keyFile, 'utf-8')
    const certificate = readFileSync(certFile, 'utf-8')
    const fingerprint = computeCertFingerprint(certificate)

    let createdAt = Date.now()
    if (existsSync(metaFile)) {
      try {
        const meta = JSON.parse(readFileSync(metaFile, 'utf-8'))
        createdAt = meta.createdAt || createdAt
      } catch {
        // Ignore meta parse errors
      }
    }

    return { privateKey, certificate, fingerprint, createdAt }
  } catch (err) {
    console.error('[Certificate] Failed to load certificate:', err)
    return null
  }
}

/**
 * Save certificate to disk with secure permissions
 */
function saveCertificate(data: CertificateData): void {
  const certPath = getCertificatePath()

  // Create directory if needed
  if (!existsSync(certPath)) {
    mkdirSync(certPath, { recursive: true, mode: 0o700 })
  }

  const keyFile = join(certPath, 'key.pem')
  const certFile = join(certPath, 'cert.pem')
  const metaFile = join(certPath, 'meta.json')

  // Write files with secure permissions (owner-only)
  writeFileSync(keyFile, data.privateKey, { encoding: 'utf-8', mode: 0o600 })
  writeFileSync(certFile, data.certificate, { encoding: 'utf-8', mode: 0o644 })
  writeFileSync(
    metaFile,
    JSON.stringify({ createdAt: data.createdAt, fingerprint: data.fingerprint }, null, 2),
    { encoding: 'utf-8', mode: 0o644 }
  )

  // Ensure permissions are correct even if file existed
  try {
    chmodSync(keyFile, 0o600)
    chmodSync(certPath, 0o700)
  } catch {
    // Ignore chmod errors on Windows
  }

  console.log(`[Certificate] Saved to ${certPath}`)
  console.log(`[Certificate] Fingerprint: ${data.fingerprint.slice(0, 16)}...`)
}

/**
 * Get or create TLS certificate
 * Returns cached certificate if available, otherwise loads from disk or generates new
 */
export async function getOrCreateCertificate(): Promise<CertificateData> {
  // Return cached certificate if available
  if (cachedCertificate) {
    return cachedCertificate
  }

  // Try to load from disk
  const loaded = loadCertificate()
  if (loaded) {
    cachedCertificate = loaded
    console.log(`[Certificate] Loaded existing certificate, fingerprint: ${loaded.fingerprint.slice(0, 16)}...`)
    return loaded
  }

  // Generate new certificate
  console.log('[Certificate] Generating new TLS certificate...')
  const generated = await generateCertificate()
  saveCertificate(generated)
  cachedCertificate = generated
  console.log(`[Certificate] Generated new certificate, fingerprint: ${generated.fingerprint.slice(0, 16)}...`)

  return generated
}

/**
 * Get certificate fingerprint (SHA256 of DER-encoded certificate)
 * This is what gets shared in the QR code for certificate pinning
 */
export async function getCertificateFingerprint(): Promise<string> {
  const cert = await getOrCreateCertificate()
  return cert.fingerprint
}

/**
 * Get certificate fingerprint formatted for display (groups of 4 chars with dashes)
 */
export async function getFormattedCertFingerprint(): Promise<string> {
  const fingerprint = await getCertificateFingerprint()
  return fingerprint.match(/.{1,4}/g)?.join('-') || fingerprint
}

/**
 * Get TLS options for HTTPS server
 */
export async function getTlsOptions(): Promise<{ key: string; cert: string }> {
  const cert = await getOrCreateCertificate()
  return {
    key: cert.privateKey,
    cert: cert.certificate
  }
}

/**
 * Regenerate certificate (creates new identity)
 * Use with caution - mobile apps will need to re-scan QR code
 */
export async function regenerateCertificate(): Promise<CertificateData> {
  console.log('[Certificate] Regenerating TLS certificate...')
  const generated = await generateCertificate()
  saveCertificate(generated)
  cachedCertificate = generated
  return generated
}

/**
 * Check if certificate exists
 */
export function certificateExists(): boolean {
  const certPath = getCertificatePath()
  const keyFile = join(certPath, 'key.pem')
  const certFile = join(certPath, 'cert.pem')
  return existsSync(keyFile) && existsSync(certFile)
}
