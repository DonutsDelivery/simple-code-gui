import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'crypto'

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
  signingPublicKey: string
}

export interface SignedPairingOffer {
  payload: PairingOfferPayload
  signature: string
}

export function canonicalPairingPayload(payload: PairingOfferPayload): string {
  return JSON.stringify({
    version: payload.version,
    serverId: payload.serverId,
    endpointHints: [...payload.endpointHints],
    certificateFingerprint: payload.certificateFingerprint,
    expiresAt: payload.expiresAt,
    requestedScopes: [...payload.requestedScopes],
    nonce: payload.nonce,
    signingPublicKey: payload.signingPublicKey,
  })
}

export function createPairingOffer(
  input: Omit<PairingOfferPayload, 'version' | 'nonce' | 'signingPublicKey'>,
  signingKeys: { publicKey: string; privateKey: string },
): SignedPairingOffer {
  const payload: PairingOfferPayload = {
    version: PAIRING_PROTOCOL_VERSION,
    ...input,
    nonce: randomBytes(24).toString('base64url'),
    signingPublicKey: signingKeys.publicKey,
  }
  return {
    payload,
    signature: sign(null, Buffer.from(canonicalPairingPayload(payload)), createPrivateKey(signingKeys.privateKey)).toString('base64url'),
  }
}

export function verifyPairingOffer(
  offer: SignedPairingOffer,
  expectedSigningPublicKey?: string,
  expectedFingerprint?: string,
  now = Date.now(),
): PairingOfferPayload {
  if (!offer?.payload || offer.payload.version !== PAIRING_PROTOCOL_VERSION) throw new Error('Unsupported pairing offer')
  if (offer.payload.expiresAt <= now) throw new Error('Pairing offer expired')
  if (expectedFingerprint && offer.payload.certificateFingerprint !== expectedFingerprint) {
    throw new Error('Pairing fingerprint mismatch')
  }
  if (expectedSigningPublicKey && offer.payload.signingPublicKey !== expectedSigningPublicKey) {
    throw new Error('Pairing signing identity mismatch')
  }
  const publicKey = createPublicKey({
    key: Buffer.from(offer.payload.signingPublicKey, 'base64url'),
    type: 'spki',
    format: 'der',
  })
  if (!verify(null, Buffer.from(canonicalPairingPayload(offer.payload)), publicKey, Buffer.from(offer.signature || '', 'base64url'))) {
    throw new Error('Invalid pairing offer signature')
  }
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
