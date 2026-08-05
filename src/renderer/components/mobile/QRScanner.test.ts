import { describe, expect, it } from 'vitest'
import { ensureGoogleBarcodeScannerModule, parseConnectionUrl } from './QRScanner'
import { parseDeepLink } from './MobileApp/helpers'
import { generateKeyPairSync } from 'crypto'
import { createPairingOffer, encodePairingOffer } from '../../../common/pairing-protocol'
import { verifyPairingOfferInBrowser } from '../../security/verify-pairing-offer'

const payload = {
  version: 3,
  host: '192.168.1.20',
  port: 38470,
  token: 'test-token',
  fingerprint: 'server-fingerprint',
  nonce: 'single-use',
  nonceExpires: Date.now() + 60_000,
}

describe('DonutCode connection compatibility', () => {
  it('installs the Android barcode module when it is unavailable', async () => {
    let installs = 0
    let installed = false
    await ensureGoogleBarcodeScannerModule({
      isGoogleBarcodeScannerModuleAvailable: async () => ({ available: installed }),
      installGoogleBarcodeScannerModule: async () => {
        installs += 1
        installed = true
      },
    }, 'android', async () => undefined)

    expect(installs).toBe(1)
  })

  it('does not install the Android barcode module when it is available', async () => {
    let installs = 0
    await ensureGoogleBarcodeScannerModule({
      isGoogleBarcodeScannerModuleAvailable: async () => ({ available: true }),
      installGoogleBarcodeScannerModule: async () => { installs += 1 },
    }, 'android')

    expect(installs).toBe(0)
  })

  it('parses credential-free signed pairing offers', () => {
    const envelope = {
      payload: {
        expiresAt: Date.now() + 60_000,
        endpointHints: ['http://192.168.1.20:38470'],
        certificateFingerprint: 'server-fingerprint',
      },
      signature: 'verified-by-server-on-redemption',
    }
    const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64url')
    expect(parseConnectionUrl(`donutcode://pair/${encoded}`)).toMatchObject({
      host: '192.168.1.20',
      port: 38470,
      pairingOffer: expect.stringContaining('donutcode://pair/'),
    })
  })

  it('rejects endpoint tampering before sending a signed offer', async () => {
    const generated = generateKeyPairSync('ed25519')
    const offer = createPairingOffer({
      serverId: 'server-a',
      endpointHints: ['https://server.example:38470'],
      certificateFingerprint: 'a'.repeat(64),
      expiresAt: Date.now() + 60_000,
      requestedScopes: ['read'],
    }, {
      publicKey: generated.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      privateKey: generated.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    })
    await expect(verifyPairingOfferInBrowser(encodePairingOffer(offer))).resolves.toBeUndefined()
    offer.payload.endpointHints = ['https://attacker.example']
    await expect(verifyPairingOfferInBrowser(encodePairingOffer(offer))).rejects.toThrow('signature')
  })

  it('parses newly emitted DonutCode QR payloads', () => {
    expect(parseConnectionUrl(JSON.stringify({ type: 'donutcode', ...payload }))).toMatchObject({
      host: payload.host,
      port: payload.port,
      token: payload.token,
      version: 3,
    })
  })

  it('continues to parse legacy Claude Terminal QR payloads', () => {
    expect(parseConnectionUrl(JSON.stringify({ type: 'claude-terminal', ...payload }))).toMatchObject({
      host: payload.host,
      port: payload.port,
      token: payload.token,
      version: 3,
    })
  })

  it('accepts both current and legacy deep-link schemes', () => {
    const query = 'token=test-token&nonce=single-use&fingerprint=server-fingerprint'
    expect(parseDeepLink(`donutcode://192.168.1.20:38470?${query}`)?.host).toBe('192.168.1.20')
    expect(parseDeepLink(`claude-terminal://192.168.1.20:38470?${query}`)?.host).toBe('192.168.1.20')
  })
})
