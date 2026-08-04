import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

export const PAIRING_PROTOCOL_VERSION = 1
export const DEFAULT_PAIRING_TTL_MS = 5 * 60_000

export type PairingScope = 'read' | 'write' | 'admin'

export interface PairingOfferPayload {
  version: typeof PAIRING_PROTOCOL_VERSION
  serverId: string
  endpointHints: string[]
  certificateFingerprint: string
  expiresAt: number
  requestedScopes: PairingScope[]
  nonce: string
}

export interface SignedPairingOffer {
  payload: PairingOfferPayload
  signature: string
}

function canonicalPayload(payload: PairingOfferPayload): string {
  return JSON.stringify({
    version: payload.version,
    serverId: payload.serverId,
    endpointHints: [...payload.endpointHints],
    certificateFingerprint: payload.certificateFingerprint,
    expiresAt: payload.expiresAt,
    requestedScopes: [...payload.requestedScopes],
    nonce: payload.nonce,
  })
}

export function createPairingOffer(
  input: Omit<PairingOfferPayload, 'version' | 'nonce'>,
  signingSecret: string,
): SignedPairingOffer {
  const payload: PairingOfferPayload = {
    version: PAIRING_PROTOCOL_VERSION,
    ...input,
    nonce: randomBytes(24).toString('base64url'),
  }
  return {
    payload,
    signature: createHmac('sha256', signingSecret).update(canonicalPayload(payload)).digest('base64url'),
  }
}

export function verifyPairingOffer(
  offer: SignedPairingOffer,
  signingSecret: string,
  expectedFingerprint?: string,
  now = Date.now(),
): PairingOfferPayload {
  if (!offer?.payload || offer.payload.version !== PAIRING_PROTOCOL_VERSION) throw new Error('Unsupported pairing offer')
  if (offer.payload.expiresAt <= now) throw new Error('Pairing offer expired')
  if (expectedFingerprint && offer.payload.certificateFingerprint !== expectedFingerprint) {
    throw new Error('Pairing fingerprint mismatch')
  }
  const actual = Buffer.from(offer.signature || '', 'base64url')
  const expected = createHmac('sha256', signingSecret).update(canonicalPayload(offer.payload)).digest()
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid pairing offer signature')
  return offer.payload
}

export function encodePairingOffer(offer: SignedPairingOffer): string {
  return `donutcode://pair/${Buffer.from(JSON.stringify(offer)).toString('base64url')}`
}

export function decodePairingOffer(value: string): SignedPairingOffer {
  const encoded = value.trim().replace(/^donutcode:\/\/pair\//, '')
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedPairingOffer
  } catch {
    throw new Error('Invalid pairing offer')
  }
}

export function pairingFingerprint(serverId: string, certificateFingerprint: string): string {
  return createHash('sha256').update(`${serverId}\0${certificateFingerprint}`).digest('hex').match(/.{1,4}/g)!.slice(0, 6).join('-')
}
