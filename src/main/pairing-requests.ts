import { randomBytes, randomUUID } from 'crypto'
import type { PairingOfferPayload } from '../common/pairing-protocol.js'
import { consumePairingOfferNonce, isPairingOfferNonceConsumed } from './pairing-offer-store.js'
import { issueDeviceToken } from './mobile-server/device-registry.js'

export interface PairingRequestSummary {
  requestId: string
  deviceId: string
  deviceName: string
  requestedScopes: Array<'read' | 'write'>
  createdAt: number
  expiresAt: number
}

interface PairingRequest extends PairingRequestSummary {
  requestSecret: string
  offerNonce: string
  status: 'pending' | 'approved' | 'rejected'
  deviceCredential?: string
}

export class PairingRequestStore {
  private readonly requests = new Map<string, PairingRequest>()

  private prune(now = Date.now()): void {
    for (const [id, request] of this.requests) {
      if (request.expiresAt <= now) this.requests.delete(id)
    }
  }

  create(payload: PairingOfferPayload, deviceId: string, deviceName: string): { requestId: string; requestSecret: string; expiresAt: number } {
    this.prune()
    if (isPairingOfferNonceConsumed(payload.nonce)) throw new Error('Pairing offer already used')
    const existing = [...this.requests.values()].find(request =>
      request.offerNonce === payload.nonce && request.deviceId === deviceId && request.status === 'pending',
    )
    if (existing) return { requestId: existing.requestId, requestSecret: existing.requestSecret, expiresAt: existing.expiresAt }
    if (this.requests.size >= 100) throw new Error('Too many pending pairing requests')
    const requestedScopes = payload.requestedScopes as Array<'read' | 'write'>
    const request: PairingRequest = {
      requestId: randomUUID(),
      requestSecret: randomBytes(32).toString('base64url'),
      offerNonce: payload.nonce,
      deviceId,
      deviceName: deviceName.slice(0, 200),
      requestedScopes,
      createdAt: Date.now(),
      expiresAt: payload.expiresAt,
      status: 'pending',
    }
    this.requests.set(request.requestId, request)
    return { requestId: request.requestId, requestSecret: request.requestSecret, expiresAt: request.expiresAt }
  }

  createPake(deviceId: string, deviceName: string, expiresAt = Date.now() + 60_000): { requestId: string; requestSecret: string; expiresAt: number } {
    return this.create({
      version: 1,
      serverId: '',
      endpointHints: [],
      certificateFingerprint: '',
      expiresAt,
      requestedScopes: ['read', 'write'],
      nonce: `pake:${randomBytes(24).toString('base64url')}`,
      signingPublicKey: '',
    }, deviceId, deviceName)
  }

  list(): PairingRequestSummary[] {
    this.prune()
    return [...this.requests.values()]
      .filter(request => request.status === 'pending')
      .map(({ requestId, deviceId, deviceName, requestedScopes, createdAt, expiresAt }) => ({
        requestId, deviceId, deviceName, requestedScopes, createdAt, expiresAt,
      }))
  }

  approve(requestId: string): boolean {
    this.prune()
    const request = this.requests.get(requestId)
    if (!request || request.status !== 'pending') return false
    if (!consumePairingOfferNonce(request.offerNonce, request.expiresAt)) {
      request.status = 'rejected'
      return false
    }
    request.deviceCredential = issueDeviceToken(request.deviceId, request.deviceName, request.requestedScopes)
    request.status = 'approved'
    for (const sibling of this.requests.values()) {
      if (sibling.requestId !== requestId && sibling.offerNonce === request.offerNonce && sibling.status === 'pending') {
        sibling.status = 'rejected'
      }
    }
    return true
  }

  reject(requestId: string): boolean {
    this.prune()
    const request = this.requests.get(requestId)
    if (!request || request.status !== 'pending') return false
    request.status = 'rejected'
    return true
  }

  status(requestId: string, requestSecret: string): { status: 'pending' | 'approved' | 'rejected'; deviceCredential?: string; scopes?: string[] } | null {
    this.prune()
    const request = this.requests.get(requestId)
    if (!request || request.requestSecret !== requestSecret) return null
    if (request.status === 'approved') {
      return { status: 'approved', deviceCredential: request.deviceCredential, scopes: request.requestedScopes }
    }
    return { status: request.status }
  }
}
