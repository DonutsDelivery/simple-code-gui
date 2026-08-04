import { describe, expect, it } from 'vitest'
import { parseConnectionUrl } from './QRScanner'
import { parseDeepLink } from './MobileApp/helpers'

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
