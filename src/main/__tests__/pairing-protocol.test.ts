import { describe, expect, it } from 'vitest'
import { client, ready } from '@serenity-kit/opaque'
import {
  createPairingOffer,
  decodePairingOffer,
  encodePairingOffer,
  pairingFingerprint,
  verifyPairingOffer,
} from '../../common/pairing-protocol'
import { consumeWebSocketTicket, issueWebSocketTicket, PakePairingAuthority } from '../mobile-server/routes/auth'

describe('secure pairing protocol', () => {
  it('round trips a signed offer and rejects expiry, tampering, and fingerprint mismatch', () => {
    const offer = createPairingOffer({
      serverId: 'server-a',
      endpointHints: ['https://host:38470'],
      certificateFingerprint: 'sha256:abc',
      expiresAt: 2000,
      requestedScopes: ['read', 'write'],
    }, 'secret')
    const decoded = decodePairingOffer(encodePairingOffer(offer))
    expect(verifyPairingOffer(decoded, 'secret', 'sha256:abc', 1000).serverId).toBe('server-a')
    expect(() => verifyPairingOffer(decoded, 'secret', 'sha256:abc', 2000)).toThrow('expired')
    expect(() => verifyPairingOffer(decoded, 'secret', 'sha256:other', 1000)).toThrow('fingerprint')
    decoded.payload.serverId = 'server-b'
    expect(() => verifyPairingOffer(decoded, 'secret', undefined, 1000)).toThrow('signature')
    expect(pairingFingerprint('server-a', 'sha256:abc')).toMatch(/^[0-9a-f]{4}(?:-[0-9a-f]{4}){5}$/)
  })

  it('uses audited OPAQUE PAKE for a human code without sending the code', async () => {
    await ready
    const authority = new PakePairingAuthority('server-a', 'correct horse battery staple')
    const started = client.startLogin({ password: 'correct horse battery staple' })
    const response = await authority.start(started.startLoginRequest, 'device-1', 'Laptop')
    const finished = client.finishLogin({
      clientLoginState: started.clientLoginState,
      loginResponse: response.loginResponse,
      password: 'correct horse battery staple',
      identifiers: { client: 'server-a', server: 'server-a' },
      keyStretching: 'rfc-recommended',
    })
    expect(finished).toBeDefined()
    const accepted = await authority.finish(response.attemptId, finished!.finishLoginRequest)
    expect(accepted).toMatchObject({ deviceId: 'device-1', deviceName: 'Laptop' })
    expect(accepted.sessionKey).toBe(finished!.sessionKey)
    await expect(authority.finish(response.attemptId, finished!.finishLoginRequest)).rejects.toThrow('expired')

    const wrong = client.startLogin({ password: 'wrong code' })
    const wrongResponse = await authority.start(wrong.startLoginRequest, 'device-2', 'Untrusted')
    expect(client.finishLogin({
      clientLoginState: wrong.clientLoginState,
      loginResponse: wrongResponse.loginResponse,
      password: 'wrong code',
      identifiers: { client: 'server-a', server: 'server-a' },
      keyStretching: 'rfc-recommended',
    })).toBeUndefined()
  })

  it('issues single-use expiring websocket tickets', () => {
    const ticket = issueWebSocketTicket('device-token')
    expect(consumeWebSocketTicket(ticket, '/api/pty/other/stream')).toBeNull()
    const validTicket = issueWebSocketTicket('device-token', '/ws')
    expect(consumeWebSocketTicket(validTicket, '/ws')).toBe('device-token')
    expect(consumeWebSocketTicket(validTicket, '/ws')).toBeNull()
    expect(consumeWebSocketTicket(issueWebSocketTicket('expired', '/ws', -1), '/ws')).toBeNull()
  })
})
