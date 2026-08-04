import { client, ready } from '@serenity-kit/opaque'

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

export async function redeemPairingOffer(
  offer: string,
  endpoint: string,
  deviceId: string,
  deviceName: string,
): Promise<HumanCodePairingResult> {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/auth/pairing-offer/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer, deviceId, deviceName }),
  })
  if (!response.ok) throw new Error('Pairing offer was rejected or expired')
  return response.json() as Promise<HumanCodePairingResult>
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
  const baseUrl = `http://${host}:${port}`
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
  return finishResponse.json() as Promise<HumanCodePairingResult>
}
