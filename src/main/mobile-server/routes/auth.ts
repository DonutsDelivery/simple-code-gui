import { randomBytes } from 'crypto'
import { client, ready, server } from '@serenity-kit/opaque'
import type { Express, Request, Response } from 'express'
import { issueDeviceToken } from '../device-registry.js'
import { getClientIp } from '../../mobile-security/index.js'
import { log } from '../utils.js'

interface PendingLogin {
  serverLoginState: string
  deviceId: string
  deviceName: string
  expiresAt: number
}

export class PakePairingAuthority {
  private serverSetup = ''
  private registrationRecord = ''
  private readonly pending = new Map<string, PendingLogin>()
  private initialized: Promise<void>

  constructor(
    private readonly serverId: string,
    private readonly humanCode: string,
    private readonly ttlMs = 60_000,
  ) {
    this.initialized = this.initialize()
  }

  private async initialize(): Promise<void> {
    await ready
    this.serverSetup = server.createSetup()
    const registration = client.startRegistration({ password: this.humanCode })
    const response = server.createRegistrationResponse({
      serverSetup: this.serverSetup,
      userIdentifier: this.serverId,
      registrationRequest: registration.registrationRequest,
    })
    this.registrationRecord = client.finishRegistration({
      password: this.humanCode,
      registrationResponse: response.registrationResponse,
      clientRegistrationState: registration.clientRegistrationState,
      identifiers: { client: this.serverId, server: this.serverId },
      keyStretching: 'rfc-recommended',
    }).registrationRecord
  }

  async start(startLoginRequest: string, deviceId: string, deviceName: string): Promise<{ attemptId: string; loginResponse: string }> {
    await this.initialized
    this.prune()
    const result = server.startLogin({
      serverSetup: this.serverSetup,
      registrationRecord: this.registrationRecord,
      startLoginRequest,
      userIdentifier: this.serverId,
      identifiers: { client: this.serverId, server: this.serverId },
    })
    const attemptId = randomBytes(18).toString('base64url')
    this.pending.set(attemptId, {
      serverLoginState: result.serverLoginState,
      deviceId,
      deviceName,
      expiresAt: Date.now() + this.ttlMs,
    })
    return { attemptId, loginResponse: result.loginResponse }
  }

  async finish(attemptId: string, finishLoginRequest: string): Promise<{ deviceId: string; deviceName: string; sessionKey: string }> {
    await this.initialized
    const pending = this.pending.get(attemptId)
    this.pending.delete(attemptId)
    if (!pending || pending.expiresAt <= Date.now()) throw new Error('Pairing attempt expired')
    const result = server.finishLogin({
      serverLoginState: pending.serverLoginState,
      finishLoginRequest,
      identifiers: { client: this.serverId, server: this.serverId },
    })
    return { deviceId: pending.deviceId, deviceName: pending.deviceName, sessionKey: result.sessionKey }
  }

  private prune(): void {
    const now = Date.now()
    for (const [id, pending] of this.pending) if (pending.expiresAt <= now) this.pending.delete(id)
  }
}

interface WebSocketTicket {
  token: string
  purpose: string
  expiresAt: number
}

const websocketTickets = new Map<string, WebSocketTicket>()

export function issueWebSocketTicket(token: string, purpose = '/ws', ttlMs = 30_000): string {
  const ticket = randomBytes(24).toString('base64url')
  websocketTickets.set(ticket, { token, purpose, expiresAt: Date.now() + ttlMs })
  return ticket
}

export function consumeWebSocketTicket(ticket: string, purpose = '/ws'): string | null {
  const record = websocketTickets.get(ticket)
  websocketTickets.delete(ticket)
  if (!record || record.expiresAt <= Date.now() || record.purpose !== purpose) return null
  return record.token
}

export interface AuthRouteOptions {
  serverId: string
  humanCode: string
  certificateFingerprint: () => string
  endpointHints: () => string[]
}

export function setupAuthRoutes(app: Express, options: AuthRouteOptions): void {
  const authority = new PakePairingAuthority(options.serverId, options.humanCode)

  app.post('/api/auth/websocket-ticket', (req: Request, res: Response) => {
    const token = (req as Request & { authToken?: string }).authToken
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const purpose = req.body?.purpose
    if (purpose !== '/ws' && !(typeof purpose === 'string' && /^\/api\/pty\/[^/]+\/stream$/.test(purpose))) {
      return res.status(400).json({ error: 'Invalid WebSocket ticket purpose' })
    }
    res.json({ ticket: issueWebSocketTicket(token, purpose), expiresInMs: 30_000 })
  })

  app.post('/api/auth/pake/start', async (req: Request, res: Response) => {
    const { startLoginRequest, deviceId, deviceName } = req.body ?? {}
    if (![startLoginRequest, deviceId, deviceName].every(value => typeof value === 'string' && value.length > 0)) {
      return res.status(400).json({ error: 'Invalid PAKE start request' })
    }
    try {
      const response = await authority.start(startLoginRequest, deviceId, deviceName)
      log('PAKE pairing started', { deviceId, clientIp: getClientIp(req) })
      res.json({
        ...response,
        serverId: options.serverId,
        endpointHints: options.endpointHints(),
        certificateFingerprint: options.certificateFingerprint(),
        requestedScopes: ['read', 'write'],
      })
    } catch {
      log('PAKE pairing start rejected', { deviceId, clientIp: getClientIp(req) })
      res.status(429).json({ error: 'Pairing attempt rejected' })
    }
  })

  app.post('/api/auth/pake/finish', async (req: Request, res: Response) => {
    const { attemptId, finishLoginRequest } = req.body ?? {}
    if (typeof attemptId !== 'string' || typeof finishLoginRequest !== 'string') {
      return res.status(400).json({ error: 'Invalid PAKE finish request' })
    }
    try {
      const accepted = await authority.finish(attemptId, finishLoginRequest)
      log('PAKE pairing approved', { deviceId: accepted.deviceId, clientIp: getClientIp(req) })
      res.json({
        serverId: options.serverId,
        deviceCredential: issueDeviceToken(accepted.deviceId, accepted.deviceName),
        scopes: ['read', 'write'],
      })
    } catch {
      log('PAKE pairing proof rejected', { clientIp: getClientIp(req) })
      res.status(403).json({ error: 'Pairing proof rejected' })
    }
  })
}
