interface BrowserPairingPayload {
  version: number
  serverId: string
  endpointHints: string[]
  certificateFingerprint: string
  expiresAt: number
  requestedScopes: string[]
  nonce: string
  signingPublicKey: string
}

interface BrowserSignedPairingOffer {
  payload: BrowserPairingPayload
  signature: string
}

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer as ArrayBuffer
}

function canonicalPayload(payload: BrowserPairingPayload): string {
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

export async function verifyPairingOfferInBrowser(encodedOffer: string): Promise<void> {
  const encoded = encodedOffer.trim().replace(/^donutcode:\/\/pair\//, '')
  const offer = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded))) as BrowserSignedPairingOffer
  if (offer.payload?.version !== 1 || !offer.payload.signingPublicKey || !offer.signature) throw new Error('Invalid pairing offer')
  if (offer.payload.expiresAt <= Date.now()) throw new Error('Pairing offer expired')
  const publicKey = await crypto.subtle.importKey('spki', decodeBase64Url(offer.payload.signingPublicKey), { name: 'Ed25519' }, false, ['verify'])
  const valid = await crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    decodeBase64Url(offer.signature),
    new TextEncoder().encode(canonicalPayload(offer.payload)).buffer as ArrayBuffer,
  )
  if (!valid) throw new Error('Invalid pairing offer signature')
}
