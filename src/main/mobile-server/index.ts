/**
 * Mobile Server - Exposes IPC handlers as HTTP/WebSocket endpoints
 * for mobile app to connect to the desktop host
 */

import express, { Express, Request, Response } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { createServer as createHttpServer, Server as HttpServer } from 'http'
import { createServer as createHttpsServer, Server as HttpsServer } from 'https'
import { randomInt } from 'crypto'
import {
  getClientIp,
  getOrCreateFingerprint,
  getFormattedFingerprint,
  getCertificateFingerprint,
  getFormattedCertFingerprint,
  getTlsOptions,
  createNonce,
  verifyNonce,
  startNonceCleanup,
  stopNonceCleanup,
  recordFailedAuth,
  clearRateLimit,
  cleanupEndpointRateLimits
} from '../mobile-security'

import { MobileServerConfig, LocalPty, PendingFile, DEFAULT_PORT } from './types'
import type {
  AgentSessionSignalEvent,
  AgentSessionSignalMessage
} from '../../common/agent-session-signal'
import { createServerProtocolDescriptor } from '../../common/server-protocol'
import { createPairingOffer, decodePairingOffer, encodePairingOffer, verifyPairingOffer } from '../../common/pairing-protocol'
import type { EnvironmentCommandRouter } from '../environment-command-router.js'
import type { SessionRuntimeRegistry } from '../session-runtime-registry.js'
import { loadOrCreateToken, regenerateToken as regenerateTokenFn, saveToken } from './token-manager'
import {
  issueDeviceToken,
  isDeviceTokenValid,
  revokeDevice as revokeDeviceFn,
  listDevices as listDevicesFn,
  type PairedDeviceInfo
} from './device-registry'
import { setupAuthRoutes } from './routes/auth'
import { consumePairingOfferNonce } from '../pairing-offer-store.js'
import { log, getRendererPath, getLocalIPs, getTailscaleHostname, tokensEqual } from './utils'
import {
  setupCorsMiddleware,
  setupStaticMiddleware,
  setupJsonMiddleware,
  setupRateLimitMiddleware,
  setupAuthMiddleware,
  setupIpAccessMiddleware,
  setupEndpointRateLimitMiddleware
} from './middleware'
import {
  setupTerminalRoutes,
  setupWorkspaceRoutes,
  setupFilesRoutes,
  setupPtyRoutes,
  setupTtsRoutes,
  setupProtocolRoutes,
  setupEnvironmentRoutes
} from './routes/index'
import {
  setupWebSocket,
  broadcastTerminalData as wsBroadcastTerminalData,
  broadcastPtyExit as wsBroadcastPtyExit
} from './websocket-manager'
import {
  sendFileToMobile as filePushSendFile,
  getPendingFilesList,
  removePendingFile as filePushRemovePendingFile,
  cleanupExpiredFiles
} from './file-push'

export class MobileServer {
  private app: Express
  private server: HttpServer | HttpsServer | null = null
  private wss: WebSocketServer | null = null
  private token: string
  private port: number
  private host: string
  private serverVersion: string
  private serverId: string
  private startupNonce?: string
  private terminalSubscriptions: Map<string, Set<WebSocket>> = new Map()
  private ptyStreams: Map<string, Set<WebSocket>> = new Map()
  private ptyDataBuffer: Map<string, string[]> = new Map()

  private ptyManager: any = null
  private runtimeRegistry: SessionRuntimeRegistry | null = null
  private unsubscribeAgentSessionSignals: (() => void) | null = null
  private unsubscribeEnvironmentEvents: (() => void) | null = null
  private environmentRouter: EnvironmentCommandRouter | null = null
  private sessionStore: any = null
  private voiceManager: any = null

  private localPtys: Map<string, LocalPty> = new Map()
  private pendingFiles: Map<string, PendingFile> = new Map()
  private connectedClients: Set<WebSocket> = new Set()

  private rendererPath: string
  private rateLimitCleanupInterval: ReturnType<typeof setInterval> | null = null
  private useTls: boolean = false // TODO: Enable once mobile app has cert pinning
  private certFingerprint: string = ''
  private readonly pairingCode = `${randomInt(1000, 10_000)}-${randomInt(1000, 10_000)}`


  constructor(config: MobileServerConfig = {}) {
    this.port = config.port ?? DEFAULT_PORT
    this.host = config.host || '0.0.0.0'
    this.serverVersion = config.serverVersion || 'unknown'
    this.serverId = config.serverId || getOrCreateFingerprint()
    this.startupNonce = config.startupNonce
    this.token = loadOrCreateToken()
    this.rendererPath = getRendererPath()
    this.app = express()
    this.setupMiddleware()
    this.setupRoutes()
  }

  private setupMiddleware(): void {
    setupCorsMiddleware(this.app)
    setupStaticMiddleware(this.app, this.rendererPath, () => this.token)
    setupJsonMiddleware(this.app)
    setupRateLimitMiddleware(this.app)
    setupAuthMiddleware(this.app, () => this.token)
    setupIpAccessMiddleware(this.app)
    setupEndpointRateLimitMiddleware(this.app)
  }

  private setupRoutes(): void {
    setupAuthRoutes(this.app, {
      serverId: this.serverId,
      humanCode: this.pairingCode,
      certificateFingerprint: () => this.certFingerprint,
      endpointHints: () => getLocalIPs().map(ip => `${this.useTls ? 'https' : 'http'}://${ip}:${this.port}`),
    })
    this.app.post('/api/auth/pairing-offer/redeem', (req: Request, res: Response) => {
      const { offer, deviceId, deviceName } = req.body ?? {}
      if (![offer, deviceId, deviceName].every(value => typeof value === 'string' && value.length > 0)) {
        return res.status(400).json({ error: 'Invalid pairing offer request' })
      }
      try {
        const verified = verifyPairingOffer(decodePairingOffer(offer), this.token, this.certFingerprint)
        if (verified.serverId !== this.serverId) throw new Error('Server identity mismatch')
        if (!consumePairingOfferNonce(verified.nonce, verified.expiresAt)) throw new Error('Pairing offer already used')
        log('Pairing offer approved', { deviceId, clientIp: getClientIp(req) })
        res.json({
          serverId: this.serverId,
          deviceCredential: issueDeviceToken(deviceId, deviceName),
          scopes: verified.requestedScopes,
        })
      } catch {
        log('Pairing offer rejected', { deviceId, clientIp: getClientIp(req) })
        res.status(403).json({ error: 'Pairing offer rejected' })
      }
    })

    // Health check (unauthenticated)
    this.app.get('/health', (req: Request, res: Response) => {
      log('Health check', { clientIp: getClientIp(req) })
      res.json({
        status: 'ok',
        version: this.serverVersion,
        serverId: this.serverId,
        ...(this.startupNonce ? { startupNonce: this.startupNonce } : {}),
      })
    })

    // Connection info for QR code (unauthenticated)
    this.app.get('/connect', (_req: Request, res: Response) => {
      const ips = getLocalIPs()
      res.json({
        port: this.port,
        ips,
        fingerprint: getFormattedFingerprint(),
        certFingerprint: this.certFingerprint,
        secure: this.useTls
      })
    })

    // Authenticated clients can mint a credential-free offer for paste, SSH,
    // trusted-device approval, or one-time pairing-file workflows.
    this.app.post('/api/auth/pairing-offer', (_req: Request, res: Response) => {
      const info = this.getConnectionInfo()
      res.json({ offer: info.qrData, expiresAt: info.nonceExpires })
    })

    // Verify handshake nonce (unauthenticated)
    this.app.post('/verify-handshake', (req: Request, res: Response) => {
      const { nonce } = req.body
      log('Verify handshake request', { nonce: nonce?.slice(0, 8), clientIp: getClientIp(req) })

      if (!nonce || typeof nonce !== 'string') {
        return res.status(400).json({ error: 'Missing nonce' })
      }

      const valid = verifyNonce(nonce)

      if (!valid) {
        const clientIp = getClientIp(req)
        recordFailedAuth(clientIp)
        return res.status(403).json({
          valid: false,
          error: 'Invalid or expired nonce'
        })
      }

      // H3: a valid single-use nonce is the pairing moment. If the device
      // identifies itself, issue it a per-device token (trust-on-first-use) so
      // it can stop using the shared QR token. Devices that don't send a
      // deviceId (older clients) keep working with the shared token.
      let deviceToken: string | undefined
      const deviceId = req.body?.deviceId
      if (typeof deviceId === 'string' && deviceId.length > 0) {
        const deviceName = typeof req.body?.deviceName === 'string' ? req.body.deviceName : ''
        deviceToken = issueDeviceToken(deviceId, deviceName)
      }

      res.json({
        valid: true,
        fingerprint: getOrCreateFingerprint(),
        certFingerprint: this.certFingerprint,
        secure: this.useTls,
        ...(deviceToken ? { deviceToken } : {})
      })
    })

    // Set up route modules
    setupProtocolRoutes(this.app, () => createServerProtocolDescriptor(
      this.serverVersion,
      this.serverId,
      process.platform as 'linux' | 'darwin' | 'win32'
    ))

    setupTerminalRoutes(
      this.app,
      () => this.ptyManager,
      () => this.runtimeRegistry,
      () => this.sessionStore,
      () => this.terminalSubscriptions,
      (ptyId, data) => this.broadcastTerminalData(ptyId, data)
    )

    setupWorkspaceRoutes(this.app, () => this.sessionStore, () => this.environmentRouter)
    setupEnvironmentRoutes(this.app, () => this.environmentRouter)

    setupFilesRoutes(
      this.app,
      () => this.pendingFiles,
      (filePath, message) => this.sendFileToMobile(filePath, message),
      (fileId) => this.removePendingFile(fileId),
      () => this.connectedClients.size,
      () => this.sessionStore
    )

    setupPtyRoutes(
      this.app,
      () => this.ptyManager,
      () => this.runtimeRegistry,
      () => this.sessionStore,
      () => this.localPtys,
      () => this.ptyStreams,
      (ptyId, code) => this.broadcastPtyExit(ptyId, code)
    )

    setupTtsRoutes(this.app, () => this.voiceManager)
  }

  private setupWebSocket(): void {
    if (!this.server) return

    this.wss = setupWebSocket(this.server, {
      getToken: () => this.token,
      getPtyManager: () => this.ptyManager,
      getRuntimeRegistry: () => this.runtimeRegistry,
      getPort: () => this.port,
      getTerminalSubscriptions: () => this.terminalSubscriptions,
      getPtyStreams: () => this.ptyStreams,
      getPtyDataBuffer: () => this.ptyDataBuffer,
      getConnectedClients: () => this.connectedClients,
      getPendingFiles: () => this.pendingFiles,
      getLocalPtys: () => this.localPtys,
      getEnvironmentSnapshot: () => this.environmentRouter?.getSnapshot() ?? null,
    })
  }

  private broadcastTerminalData(ptyId: string, data: string): void {
    wsBroadcastTerminalData(ptyId, data, this.terminalSubscriptions)
  }


  private broadcastPtyExit(ptyId: string, code: number): void {
    wsBroadcastPtyExit(ptyId, code, this.ptyStreams, this.terminalSubscriptions, this.ptyDataBuffer)
  }

  private subscribeAgentSessionSignals(): void {
    if (
      this.unsubscribeAgentSessionSignals
      || typeof this.ptyManager?.onAgentSessionSignal !== 'function'
    ) {
      return
    }

    this.unsubscribeAgentSessionSignals = this.ptyManager.onAgentSessionSignal(
      (signal: AgentSessionSignalEvent) => {
        const event: AgentSessionSignalMessage = {
          type: 'agent-session-signal',
          signal
        }
        const message = JSON.stringify(event)
        for (const client of this.connectedClients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message)
          }
        }
      }
    )
  }

  // Service handlers
  setPtyManager(manager: any): void {
    this.unsubscribeAgentSessionSignals?.()
    this.unsubscribeAgentSessionSignals = null
    this.ptyManager = manager
    this.subscribeAgentSessionSignals()
  }

  setRuntimeRegistry(registry: SessionRuntimeRegistry): void {
    this.runtimeRegistry = registry
  }

  setSessionStore(store: any): void {
    this.sessionStore = store
  }

  setEnvironmentRouter(router: EnvironmentCommandRouter): void {
    this.unsubscribeEnvironmentEvents?.()
    this.environmentRouter = router
    this.unsubscribeEnvironmentEvents = router.onEvent((event) => {
      const message = JSON.stringify({ type: 'environment-event', event })
      for (const client of this.connectedClients) {
        if (client.readyState === WebSocket.OPEN) client.send(message)
      }
    })
  }

  setVoiceManager(manager: any): void {
    this.voiceManager = manager
  }

  // Token management
  regenerateToken(): string {
    this.token = regenerateTokenFn()
    // H3: a real revoke must drop live sockets, not just reject new ones.
    // Rotating the shared token invalidates any socket still holding the old
    // one; per-device-token sockets stay valid and are left connected.
    this.closeSockets((token) => !tokensEqual(token, this.token) && !isDeviceTokenValid(token))
    return this.token
  }

  // Per-device revoke (H3): mark the device revoked and forcibly close any of
  // its live WebSocket sessions so a removed phone stops streaming immediately.
  revokeDevice(deviceId: string): { revoked: number } {
    const tokens = new Set(revokeDeviceFn(deviceId))
    if (tokens.size > 0) {
      this.closeSockets((token) => tokens.has(token))
    }
    return { revoked: tokens.size }
  }

  listDevices(): PairedDeviceInfo[] {
    return listDevicesFn()
  }

  // Close every live socket whose auth token matches the predicate. Covers both
  // the main /ws clients and per-PTY stream sockets.
  private closeSockets(shouldClose: (token: string) => boolean): void {
    const closeIfMatch = (ws: WebSocket): void => {
      const token = (ws as WebSocket & { __authToken?: string }).__authToken || ''
      if (shouldClose(token)) {
        try {
          ws.close(1008, 'Access revoked')
        } catch {
          try { ws.terminate() } catch { /* ignore */ }
        }
      }
    }
    this.connectedClients.forEach(closeIfMatch)
    this.ptyStreams.forEach((sockets) => sockets.forEach(closeIfMatch))
  }

  // Connection info for QR code
  getConnectionInfo(): {
    url: string
    token: string
    port: number
    ips: string[]
    fingerprint: string
    formattedFingerprint: string
    certFingerprint: string
    secure: boolean
    nonce: string
    nonceExpires: number
    qrData: string
    pairingCode: string
  } {
    const ips = getLocalIPs()
    const primaryIp = ips[0] || 'localhost'
    const fingerprint = getOrCreateFingerprint()
    const { nonce, expiresAt } = createNonce()

    const tailscaleHostname = getTailscaleHostname()
    const allHosts = tailscaleHostname ? [...ips, tailscaleHostname] : ips

    const offer = createPairingOffer({
      serverId: this.serverId,
      endpointHints: allHosts.map(host => `${this.useTls ? 'https' : 'http'}://${host}:${this.port}`),
      certificateFingerprint: this.certFingerprint || fingerprint,
      requestedScopes: ['read', 'write'],
      expiresAt,
    }, this.token)

    const encodedOffer = encodePairingOffer(offer)
    return {
      url: encodedOffer,
      token: '',
      port: this.port,
      ips,
      fingerprint,
      formattedFingerprint: getFormattedFingerprint(),
      certFingerprint: this.certFingerprint,
      secure: this.useTls,
      nonce,
      nonceExpires: expiresAt,
      qrData: encodedOffer,
      pairingCode: this.pairingCode
    }
  }

  generateNonce(): { nonce: string; expiresAt: number } {
    return createNonce()
  }

  // File push methods
  sendFileToMobile(filePath: string, message?: string): { success: boolean; fileId?: string; error?: string } {
    return filePushSendFile(filePath, message, this.pendingFiles, this.connectedClients)
  }

  getPendingFiles(): PendingFile[] {
    return getPendingFilesList(this.pendingFiles)
  }

  removePendingFile(fileId: string): boolean {
    return filePushRemovePendingFile(fileId, this.pendingFiles)
  }

  getConnectedClientCount(): number {
    return this.connectedClients.size
  }

  async start(): Promise<void> {
    this.subscribeAgentSessionSignals()
    try {
      // Get TLS certificate (generates on first run)
      if (this.useTls) {
        log('Initializing TLS certificate...')
        const tlsOptions = await getTlsOptions()
        this.certFingerprint = await getCertificateFingerprint()
        this.server = createHttpsServer(tlsOptions, this.app)
        log(`TLS enabled, cert fingerprint: ${this.certFingerprint.slice(0, 16)}...`)
      } else {
        this.server = createHttpServer(this.app)
        log('TLS disabled, using HTTP')
      }

      this.setupWebSocket()
      startNonceCleanup()

      this.rateLimitCleanupInterval = setInterval(() => {
        cleanupEndpointRateLimits()
      }, 2 * 60 * 1000)

      return new Promise((resolve, reject) => {
        this.server!.listen(this.port, this.host, () => {
          const address = this.server?.address()
          if (address && typeof address !== 'string') this.port = address.port
          const protocol = this.useTls ? 'HTTPS' : 'HTTP'
          log(`Started ${protocol} server on port ${this.port}`)
          if (this.useTls) {
            log(`Cert fingerprint: ${this.certFingerprint.slice(0, 32)}...`)
          }
          resolve()
        })

        this.server!.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            log(`Port ${this.port} in use, trying ${this.port + 1}`)
            this.port++
            this.server?.close()
            this.start().then(resolve).catch(reject)
          } else {
            log('Server error', { error: String(err) })
            reject(err)
          }
        })
      })
    } catch (error) {
      log('Failed to start server', { error: String(error) })
      throw error
    }
  }

  getEndpoint(): { host: string; port: number; secure: boolean } {
    return { host: this.host, port: this.port, secure: this.useTls }
  }

  setHost(host: string): void {
    if (this.isRunning()) throw new Error('Cannot change server host while running')
    this.host = host
  }

  async stop(): Promise<void> {
    stopNonceCleanup()

    this.unsubscribeAgentSessionSignals?.()
    this.unsubscribeAgentSessionSignals = null
    this.unsubscribeEnvironmentEvents?.()
    this.unsubscribeEnvironmentEvents = null

    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval)
      this.rateLimitCleanupInterval = null
    }

    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
    if (this.server) {
      const server = this.server
      this.server = null
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
    log('Stopped')
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening
  }
}

// Re-export types
export * from './types'
