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
import { join } from 'path'
import { getRuntimeDataDir } from '../runtime-paths.js'
import { encryptToken, decryptToken, writeSecureFile } from '../mobile-security'
import { log } from './utils'

export interface PairedDevice {
  token: string
  deviceId: string
  name: string
  createdAt: number
  lastSeen: number
  revoked: boolean
  scopes: Array<'read' | 'write'>
}

// Public view (never leak the raw token to the renderer device list)
export interface PairedDeviceInfo {
  deviceId: string
  name: string
  createdAt: number
  lastSeen: number
  revoked: boolean
  scopes: Array<'read' | 'write'>
}

export class DeviceRegistry {
  private readonly devices = new Map<string, PairedDevice>()
  private readonly storePath: string

  constructor(dataDir: string) {
    this.storePath = join(dataDir, 'mobile-devices')
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.storePath)) return
      const decrypted = decryptToken(readFileSync(this.storePath, 'utf-8').trim())
      if (!decrypted) return
      const parsed = JSON.parse(decrypted) as PairedDevice[]
      if (Array.isArray(parsed)) {
        for (const device of parsed) {
          if (device && typeof device.token === 'string') this.devices.set(device.token, device)
        }
      }
    } catch (err) {
      log('Failed to load device registry', { error: String(err) })
    }
  }

  private persist(): void {
    try {
      writeSecureFile(this.storePath, encryptToken(JSON.stringify(Array.from(this.devices.values()))))
    } catch (err) {
      log('Failed to persist device registry', { error: String(err) })
    }
  }

  issueDeviceToken(deviceId: string, name: string, scopes: Array<'read' | 'write'> = ['read', 'write']): string {
    const now = Date.now()
    for (const device of this.devices.values()) {
      if (device.deviceId === deviceId && !device.revoked) {
        device.lastSeen = now
        if (name) device.name = name
        device.scopes = scopes
        this.persist()
        return device.token
      }
    }
    const token = randomBytes(32).toString('hex')
    this.devices.set(token, { token, deviceId, name: name || 'Mobile device', createdAt: now, lastSeen: now, revoked: false, scopes })
    this.persist()
    log('Issued per-device token', { deviceId, name })
    return token
  }

  isDeviceTokenValid(token: string): boolean {
    const device = token ? this.devices.get(token) : undefined
    return !!device && !device.revoked
  }

  deviceTokenAllows(token: string, scope: 'read' | 'write'): boolean {
    const device = this.devices.get(token)
    return !!device && !device.revoked && (device.scopes ?? ['read', 'write']).includes(scope)
  }

  touchDevice(token: string): void {
    const device = this.devices.get(token)
    if (device && !device.revoked) device.lastSeen = Date.now()
  }

  revokeDevice(deviceId: string): string[] {
    const revoked: string[] = []
    for (const device of this.devices.values()) {
      if (device.deviceId === deviceId && !device.revoked) {
        device.revoked = true
        revoked.push(device.token)
      }
    }
    if (revoked.length) this.persist()
    return revoked
  }

  listDevices(): PairedDeviceInfo[] {
    return Array.from(this.devices.values()).filter(device => !device.revoked).map(({ deviceId, name, createdAt, lastSeen, revoked, scopes }) => ({
      deviceId, name, createdAt, lastSeen, revoked, scopes: scopes ?? ['read', 'write']
    }))
  }
}

const deviceRegistries = new Map<string, DeviceRegistry>()

function getStorePath(): string {
  return join(getRuntimeDataDir(), 'mobile-devices')
}

function load(): DeviceRegistry {
  const path = getStorePath()
  const cached = deviceRegistries.get(path)
  if (cached) return cached

  const registry = new DeviceRegistry(getRuntimeDataDir())
  deviceRegistries.set(path, registry)
  return registry
}

export function clearDeviceRegistryCacheForTesting(): void {
  deviceRegistries.clear()
}

/**
 * Issue (or reuse) a per-device token for a paired device. Idempotent per
 * deviceId: re-pairing from the same device returns its existing, non-revoked
 * token so we don't accumulate stale credentials.
 */
export function issueDeviceToken(
  deviceId: string,
  name: string,
  scopes: Array<'read' | 'write'> = ['read', 'write'],
): string {
  return load().issueDeviceToken(deviceId, name, scopes)
}

export function isDeviceTokenValid(token: string): boolean {
  return load().isDeviceTokenValid(token)
}

export function deviceTokenAllows(token: string, scope: 'read' | 'write'): boolean {
  return load().deviceTokenAllows(token, scope)
}

export function touchDevice(token: string): void {
  load().touchDevice(token)
}

/**
 * Revoke a device by id. Returns the tokens that were revoked so the caller can
 * terminate their live sockets.
 */
export function revokeDevice(deviceId: string): string[] {
  return load().revokeDevice(deviceId)
}

export function listDevices(): PairedDeviceInfo[] {
  return load().listDevices()
}
