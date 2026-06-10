/**
 * Device Registry - per-device bearer tokens (H3)
 *
 * Each phone that completes the QR handshake is issued its OWN long-lived
 * bearer token, bound to a stable device id. This replaces the model where
 * every device shared one server token:
 *   - revoke is per-device (kill one phone without rotating the shared secret
 *     and forcing every other device to re-scan), and
 *   - a leaked/screenshotted QR only exposes the short-lived pairing nonce,
 *     not a permanent control credential.
 *
 * Trust-on-first-use: a successful handshake (valid single-use nonce) auto-
 * trusts the device, matching the existing fingerprint-TOFU model. The legacy
 * shared token stays valid during migration so already-paired devices keep
 * working without a re-scan.
 */

import { randomBytes } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'
import { encryptToken, decryptToken, writeSecureFile } from '../mobile-security'
import { log } from './utils'

export interface PairedDevice {
  token: string
  deviceId: string
  name: string
  createdAt: number
  lastSeen: number
  revoked: boolean
}

// Public view (never leak the raw token to the renderer device list)
export interface PairedDeviceInfo {
  deviceId: string
  name: string
  createdAt: number
  lastSeen: number
  revoked: boolean
}

let devices: Map<string, PairedDevice> | null = null

function getStorePath(): string {
  return join(app.getPath('userData'), 'mobile-devices')
}

function load(): Map<string, PairedDevice> {
  if (devices) return devices
  devices = new Map()
  try {
    const path = getStorePath()
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8').trim()
      const decrypted = decryptToken(raw)
      if (decrypted) {
        const parsed = JSON.parse(decrypted) as PairedDevice[]
        if (Array.isArray(parsed)) {
          for (const d of parsed) {
            if (d && typeof d.token === 'string') devices.set(d.token, d)
          }
        }
      }
    }
  } catch (err) {
    log('Failed to load device registry', { error: String(err) })
  }
  return devices
}

function persist(): void {
  if (!devices) return
  try {
    const json = JSON.stringify(Array.from(devices.values()))
    writeSecureFile(getStorePath(), encryptToken(json))
  } catch (err) {
    log('Failed to persist device registry', { error: String(err) })
  }
}

/**
 * Issue (or reuse) a per-device token for a paired device. Idempotent per
 * deviceId: re-pairing from the same device returns its existing, non-revoked
 * token so we don't accumulate stale credentials.
 */
export function issueDeviceToken(deviceId: string, name: string): string {
  const map = load()
  const now = Date.now()
  for (const d of map.values()) {
    if (d.deviceId === deviceId && !d.revoked) {
      d.lastSeen = now
      if (name) d.name = name
      persist()
      return d.token
    }
  }
  const token = randomBytes(32).toString('hex')
  map.set(token, {
    token,
    deviceId,
    name: name || 'Mobile device',
    createdAt: now,
    lastSeen: now,
    revoked: false
  })
  persist()
  log('Issued per-device token', { deviceId, name })
  return token
}

export function isDeviceTokenValid(token: string): boolean {
  if (!token) return false
  const d = load().get(token)
  return !!d && !d.revoked
}

export function touchDevice(token: string): void {
  const d = load().get(token)
  if (d && !d.revoked) {
    d.lastSeen = Date.now()
  }
}

/**
 * Revoke a device by id. Returns the tokens that were revoked so the caller can
 * terminate their live sockets.
 */
export function revokeDevice(deviceId: string): string[] {
  const map = load()
  const revoked: string[] = []
  for (const d of map.values()) {
    if (d.deviceId === deviceId && !d.revoked) {
      d.revoked = true
      revoked.push(d.token)
    }
  }
  if (revoked.length > 0) {
    persist()
    log('Revoked device', { deviceId, tokens: revoked.length })
  }
  return revoked
}

export function listDevices(): PairedDeviceInfo[] {
  return Array.from(load().values())
    .filter(d => !d.revoked)
    .map(({ deviceId, name, createdAt, lastSeen, revoked }) => ({
      deviceId,
      name,
      createdAt,
      lastSeen,
      revoked
    }))
}
