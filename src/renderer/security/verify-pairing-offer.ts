import { verifyAsync as verifyEd25519 } from '@noble/ed25519'

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

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
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
  const encodedPublicKey = decodeBase64Url(offer.payload.signingPublicKey)
  const signature = decodeBase64Url(offer.signature)
  const message = new TextEncoder().encode(canonicalPayload(offer.payload))
  let valid: boolean
  try {
    const publicKey = await crypto.subtle.importKey('spki', encodedPublicKey.buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['verify'])
    valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      signature.buffer as ArrayBuffer,
      message.buffer as ArrayBuffer,
    )
  } catch (error) {
    const unsupported = error instanceof DOMException
      ? error.name === 'NotSupportedError'
      : error instanceof Error && /algorithm.*(unrecognized|unsupported)/i.test(error.message)
    const incompatibleBufferSource = error instanceof TypeError
      && /ArrayBuffer|TypedArray|DataView/i.test(error.message)
    if (!unsupported && !incompatibleBufferSource) throw error

    const spkiPrefix = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]
    if (encodedPublicKey.length !== 44 || !spkiPrefix.every((value, index) => encodedPublicKey[index] === value)) {
      throw new Error('Invalid pairing offer signing key')
    }
    valid = await verifyEd25519(signature, message, encodedPublicKey.slice(12))
  }
  if (!valid) throw new Error('Invalid pairing offer signature')
}
