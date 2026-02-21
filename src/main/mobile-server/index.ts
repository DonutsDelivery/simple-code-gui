/**
 * Mobile Server - Exposes IPC handlers as HTTP/WebSocket endpoints
 * for mobile app to connect to the desktop host
 */

import express, { Express, Request, Response } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { createServer as createHttpServer, Server as HttpServer } from 'http'
import { createServer as createHttpsServer, Server as HttpsServer } from 'https'
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
import { loadOrCreateToken, regenerateToken as regenerateTokenFn, saveToken } from './token-manager'
import { log, getRendererPath, getLocalIPs, getTailscaleHostname } from './utils'
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
  setupBeadsRoutes,
  setupFilesRoutes,
  setupPtyRoutes,
  setupTtsRoutes
} from './routes/index'
import {
  setupWebSocket,
  broadcastTerminalData as wsBroadcastTerminalData,
  broadcastPtyData as wsBroadcastPtyData,
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
  private terminalSubscriptions: Map<string, Set<WebSocket>> = new Map()
  private ptyStreams: Map<string, Set<WebSocket>> = new Map()
  private ptyDataBuffer: Map<string, string[]> = new Map()

  private ptyManager: any = null
  private sessionStore: any = null
  private voiceManager: any = null

  private localPtys: Map<string, LocalPty> = new Map()
  private pendingFiles: Map<string, PendingFile> = new Map()
  private connectedClients: Set<WebSocket> = new Set()

  private rendererPath: string
  private rateLimitCleanupInterval: ReturnType<typeof setInterval> | null = null
  private useTls: boolean = false // TODO: Enable once mobile app has cert pinning
  private certFingerprint: string = ''

  constructor(config: MobileServerConfig = {}) {
    this.port = config.port || DEFAULT_PORT
    this.token = loadOrCreateToken()
    this.rendererPath = getRendererPath()
    this.app = express()
    this.setupMiddleware()
    this.setupRoutes()
  }

  private setupMiddleware(): void {
    setupCorsMiddleware(this.app)
    setupStaticMiddleware(this.app, this.rendererPath)
    setupJsonMiddleware(this.app)
    setupRateLimitMiddleware(this.app)
    setupAuthMiddleware(this.app, () => this.token)
    setupIpAccessMiddleware(this.app)
    setupEndpointRateLimitMiddleware(this.app)
  }

  private setupRoutes(): void {
    // Health check (unauthenticated)
    this.app.get('/health', (req: Request, res: Response) => {
      log('Health check', { clientIp: getClientIp(req) })
      res.json({ status: 'ok', version: '2.0.0' })
    })

    // WebSocket test
    this.app.get('/ws-test', (req: Request, res: Response) => {
      const token = req.query.token as string
      log('WS test request', { providedToken: token?.slice(0, 8), expectedToken: this.token.slice(0, 8), clientIp: getClientIp(req) })
      if (token === this.token) {
        res.json({ ok: true, message: 'Token valid, WebSocket should work' })
      } else {
        res.status(403).json({ ok: false, message: 'Invalid token' })
      }
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

      res.json({
        valid: true,
        fingerprint: getOrCreateFingerprint(),
        certFingerprint: this.certFingerprint,
        secure: this.useTls
      })
    })

    // Set up route modules
    setupTerminalRoutes(
      this.app,
      () => this.ptyManager,
      () => this.terminalSubscriptions,
      (ptyId, data) => this.broadcastTerminalData(ptyId, data)
    )

    setupWorkspaceRoutes(this.app, () => this.sessionStore)

    setupBeadsRoutes(this.app)

    setupFilesRoutes(
      this.app,
      () => this.pendingFiles,
      (filePath, message) => this.sendFileToMobile(filePath, message),
      (fileId) => this.removePendingFile(fileId),
      () => this.connectedClients.size
    )

    setupPtyRoutes(
      this.app,
      () => this.ptyManager,
      () => this.localPtys,
      () => this.ptyStreams,
      () => this.ptyDataBuffer,
      (ptyId, data) => this.broadcastPtyData(ptyId, data),
      (ptyId, code) => this.broadcastPtyExit(ptyId, code)
    )

    setupTtsRoutes(this.app, () => this.voiceManager)
  }

  private setupWebSocket(): void {
    if (!this.server) return

    this.wss = setupWebSocket(this.server, {
      getToken: () => this.token,
      getPtyManager: () => this.ptyManager,
      getPort: () => this.port,
      getTerminalSubscriptions: () => this.terminalSubscriptions,
      getPtyStreams: () => this.ptyStreams,
      getPtyDataBuffer: () => this.ptyDataBuffer,
      getConnectedClients: () => this.connectedClients,
      getPendingFiles: () => this.pendingFiles
    })
  }

  private broadcastTerminalData(ptyId: string, data: string): void {
    wsBroadcastTerminalData(ptyId, data, this.terminalSubscriptions)
  }

  private broadcastPtyData(ptyId: string, data: string): void {
    wsBroadcastPtyData(ptyId, data, this.ptyStreams, this.ptyDataBuffer)
  }

  private broadcastPtyExit(ptyId: string, code: number): void {
    wsBroadcastPtyExit(ptyId, code, this.ptyStreams)
  }

  // Service handlers
  setPtyManager(manager: any): void {
    this.ptyManager = manager
  }

  setSessionStore(store: any): void {
    this.sessionStore = store
  }

  setVoiceManager(manager: any): void {
    this.voiceManager = manager
  }

  // Token management
  regenerateToken(): string {
    this.token = regenerateTokenFn()
    return this.token
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
  } {
    const ips = getLocalIPs()
    const primaryIp = ips[0] || 'localhost'
    const fingerprint = getOrCreateFingerprint()
    const { nonce, expiresAt } = createNonce()

    const tailscaleHostname = getTailscaleHostname()
    const allHosts = tailscaleHostname ? [...ips, tailscaleHostname] : ips

    // QR version 3: adds TLS certificate pinning
    // - certFingerprint: SHA256 of server's TLS certificate (for pinning)
    // - secure: true means use HTTPS/WSS
    const qrPayload = {
      type: 'claude-terminal',
      version: 3,
      host: primaryIp,
      hosts: allHosts,
      port: this.port,
      token: this.token,
      fingerprint, // Legacy app-level fingerprint
      certFingerprint: this.certFingerprint, // TLS certificate fingerprint for pinning
      secure: this.useTls,
      nonce,
      nonceExpires: expiresAt
    }

    const protocol = this.useTls ? 'https' : 'http'
    return {
      url: `claude-terminal://${primaryIp}:${this.port}?token=${this.token}`,
      token: this.token,
      port: this.port,
      ips,
      fingerprint,
      formattedFingerprint: getFormattedFingerprint(),
      certFingerprint: this.certFingerprint,
      secure: this.useTls,
      nonce,
      nonceExpires: expiresAt,
      qrData: JSON.stringify(qrPayload)
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
        this.server!.listen(this.port, '0.0.0.0', () => {
          const protocol = this.useTls ? 'HTTPS' : 'HTTP'
          log(`Started ${protocol} server on port ${this.port}`)
          log(`Token: ${this.token.slice(0, 8)}...`)
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

  stop(): void {
    stopNonceCleanup()

    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval)
      this.rateLimitCleanupInterval = null
    }

    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
    if (this.server) {
      this.server.close()
      this.server = null
    }
    log('Stopped')
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening
  }
}

// Re-export types
export * from './types'
