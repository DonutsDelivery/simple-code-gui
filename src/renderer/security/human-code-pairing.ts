import { client, ready } from '@serenity-kit/opaque'
import { probeAndTrustServerEndpoint } from './server-certificate-trust.js'

export interface HumanCodePairingResult {
  serverId: string
  deviceCredential: string
  scopes: string[]
}

export interface PairingApprovalDetails {
  serverId: string
  endpointHints: string[]
  certificateFingerprint: string
  requestedScopes: string[]
}

interface PendingApproval {
  serverId: string
  requestId: string
  requestSecret: string
  expiresAt: number
}

async function waitForPairingApproval(baseUrl: string, pending: PendingApproval): Promise<HumanCodePairingResult> {
  while (Date.now() < pending.expiresAt) {
    await new Promise(resolve => setTimeout(resolve, 1_000))
    const response = await fetch(`${baseUrl}/api/auth/pairing-offer/request/${encodeURIComponent(pending.requestId)}/status`, {
      headers: { 'X-Pairing-Request-Secret': pending.requestSecret },
    })
    if (!response.ok) throw new Error('Pairing request is no longer available')
    const status = await response.json() as {
      status: 'pending' | 'approved' | 'rejected'
      deviceCredential?: string
      scopes?: string[]
    }
    if (status.status === 'rejected') throw new Error('Pairing request was rejected')
    if (status.status === 'approved' && status.deviceCredential) {
      return { serverId: pending.serverId, deviceCredential: status.deviceCredential, scopes: status.scopes || [] }
    }
  }
  throw new Error('Pairing request expired before it was approved')
}

export async function redeemPairingOffer(
  offer: string,
  endpoint: string,
  deviceId: string,
  deviceName: string,
): Promise<HumanCodePairingResult> {
  const baseUrl = endpoint.replace(/\/$/, '')
  const response = await fetch(`${baseUrl}/api/auth/pairing-offer/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer, deviceId, deviceName }),
  })
  if (!response.ok) throw new Error('Pairing offer was rejected or expired')
  return waitForPairingApproval(baseUrl, await response.json() as PendingApproval)
}

export async function pairWithHumanCode(
  host: string,
  port: number,
  humanCode: string,
  deviceId: string,
  deviceName: string,
  approve?: (details: PairingApprovalDetails) => Promise<boolean> | boolean,
): Promise<HumanCodePairingResult> {
  await ready
  const baseUrl = `https://${host}:${port}`
  const probedFingerprint = await probeAndTrustServerEndpoint(baseUrl)
  const start = client.startLogin({ password: humanCode })
  const startResponse = await fetch(`${baseUrl}/api/auth/pake/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startLoginRequest: start.startLoginRequest, deviceId, deviceName }),
  })
  if (!startResponse.ok) throw new Error('Pairing code was rejected')
  const challenge = await startResponse.json() as {
    attemptId: string
    loginResponse: string
    serverId: string
    endpointHints: string[]
    certificateFingerprint: string
    requestedScopes: string[]
  }
  if (challenge.certificateFingerprint.replace(/^sha256:/i, '').toLowerCase() !== probedFingerprint.toLowerCase()) {
    throw new Error('Server certificate fingerprint changed during pairing')
  }
  if (approve && !await approve(challenge)) throw new Error('Pairing approval was cancelled')
  const finish = client.finishLogin({
    clientLoginState: start.clientLoginState,
    loginResponse: challenge.loginResponse,
    password: humanCode,
    identifiers: { client: challenge.serverId, server: challenge.serverId },
    keyStretching: 'rfc-recommended',
  })
  if (!finish) throw new Error('Pairing proof failed')
  const finishResponse = await fetch(`${baseUrl}/api/auth/pake/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attemptId: challenge.attemptId, finishLoginRequest: finish.finishLoginRequest }),
  })
  if (!finishResponse.ok) throw new Error('Pairing approval was rejected')
  return waitForPairingApproval(baseUrl, await finishResponse.json() as PendingApproval)
}
