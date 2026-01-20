/**
 * Mobile Server - Exposes IPC handlers as HTTP/WebSocket endpoints
 * for mobile app to connect to the desktop host
 */

import express, { Express, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import { WebSocketServer, WebSocket } from 'ws'
import { createServer, Server } from 'http'
import { randomBytes } from 'crypto'
import { networkInterfaces } from 'os'
import { appendFileSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import { app } from 'electron'
import { join, basename, resolve } from 'path'

// File logging for debugging
function log(message: string, data?: any): void {
  const timestamp = new Date().toISOString()
  const logLine = data
    ? `[${timestamp}] ${message} ${JSON.stringify(data)}\n`
    : `[${timestamp}] ${message}\n`
  const logPath = join(app.getPath('userData'), 'mobile-server.log')
  appendFileSync(logPath, logLine)
  console.log('[MobileServer]', message, data || '')
}
import {
  classifyIp,
  getClientIp,
  checkRateLimit,
  recordFailedAuth,
  clearRateLimit,
  getOrCreateFingerprint,
  getFormattedFingerprint,
  createNonce,
  verifyNonce,
  startNonceCleanup,
  stopNonceCleanup,
  validateProjectPath,
  encryptToken,
  decryptToken,
  writeSecureFile,
  checkEndpointRateLimit,
  cleanupEndpointRateLimits,
  IpClass
} from './mobile-security'
import { discoverSessions } from './session-discovery'
import {
  getBeadsExecOptions,
  checkBeadsInstalled,
  spawnBdCommand,
  validateTaskId,
  TASK_ID_PATTERN
} from './ipc'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const DEFAULT_PORT = 38470

interface MobileServerConfig {
  port?: number
}

// Access control rules by endpoint type
type EndpointAccess = 'admin' | 'write' | 'read'

// Note: Access levels are determined dynamically in getEndpointAccessLevel()
// based on both path and HTTP method. This constant is kept for reference
// but the actual logic handles method-specific access (e.g., workspace GET vs PUT)

interface TerminalSubscription {
  ws: WebSocket
  ptyId: string
}

// Local PTY storage for PTYs spawned directly via mobile API
interface LocalPty {
  ptyId: string
  projectPath: string
  dataCallbacks: Set<(data: string) => void>
  exitCallbacks: Set<(code: number) => void>
}

export class MobileServer {
  private app: Express
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private token: string
  private port: number
  private terminalSubscriptions: Map<string, Set<WebSocket>> = new Map()
  private ptyStreams: Map<string, Set<WebSocket>> = new Map() // PTY stream WebSocket connections
  private ptyDataBuffer: Map<string, string[]> = new Map() // Buffer PTY data until WebSocket connects

  // Service handlers - set by main process
  private ptyManager: any = null
  private sessionStore: any = null
  private voiceManager: any = null

  // Track PTYs spawned via mobile API
  private localPtys: Map<string, LocalPty> = new Map()

  // Path to renderer dist files
  private rendererPath: string

  // Cleanup interval for endpoint rate limits
  private rateLimitCleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: MobileServerConfig = {}) {
    this.port = config.port || DEFAULT_PORT
    this.token = this.loadOrCreateToken()
    this.rendererPath = this.getRendererPath()
    this.app = express()
    this.setupMiddleware()
    this.setupRoutes()
  }

  /**
   * Get the path to renderer dist files
   * In development: dist/renderer
   * In production: inside app.asar or resources
   */
  private getRendererPath(): string {
    // Check if running in development
    if (process.env.NODE_ENV === 'development') {
      return resolve(__dirname, '../../dist/renderer')
    }
    // Production - check common locations
    const appPath = app.getAppPath()
    // If running from asar, renderer is in dist/renderer inside the asar
    if (appPath.includes('.asar')) {
      return join(appPath, 'dist/renderer')
    }
    // Otherwise check relative paths
    const possiblePaths = [
      join(appPath, 'dist/renderer'),
      join(appPath, '../renderer'),
      resolve(__dirname, '../../dist/renderer'),
      resolve(__dirname, '../renderer')
    ]
    for (const p of possiblePaths) {
      if (existsSync(join(p, 'index.html'))) {
        return p
      }
    }
    // Fallback
    return join(appPath, 'dist/renderer')
  }

  /**
   * Check if path is for a static file
   */
  private isStaticPath(path: string): boolean {
    return path === '/' ||
           path === '/index.html' ||
           path.startsWith('/assets/') ||
           path.endsWith('.js') ||
           path.endsWith('.css') ||
           path.endsWith('.svg') ||
           path.endsWith('.png') ||
           path.endsWith('.ico') ||
           path.endsWith('.woff') ||
           path.endsWith('.woff2')
  }

  private getTokenPath(): string {
    return join(app.getPath('userData'), 'mobile-server-token')
  }

  private loadOrCreateToken(): string {
    const tokenPath = this.getTokenPath()
    try {
      if (existsSync(tokenPath)) {
        const storedData = readFileSync(tokenPath, 'utf-8').trim()

        // Try to decrypt (new encrypted format)
        const decrypted = decryptToken(storedData)
        if (decrypted && decrypted.length === 64) {
          log('Loaded existing encrypted token')
          return decrypted
        }

        // Fallback: check if it's an old unencrypted token (migration path)
        if (storedData.length === 64 && /^[a-f0-9]+$/.test(storedData)) {
          log('Migrating unencrypted token to encrypted storage')
          // Re-save with encryption
          const encrypted = encryptToken(storedData)
          writeSecureFile(tokenPath, encrypted)
          return storedData
        }
      }
    } catch (err) {
      log('Failed to load token, generating new one', { error: String(err) })
    }

    // Generate and save new token with encryption
    const token = randomBytes(32).toString('hex')
    try {
      const encrypted = encryptToken(token)
      writeSecureFile(tokenPath, encrypted)
      log('Generated and saved new encrypted token')
    } catch (err) {
      log('Failed to save token', { error: String(err) })
    }
    return token
  }

  regenerateToken(): string {
    this.token = randomBytes(32).toString('hex')
    try {
      const encrypted = encryptToken(this.token)
      writeSecureFile(this.getTokenPath(), encrypted)
      log('Regenerated and saved encrypted token')
    } catch (err) {
      log('Failed to save regenerated token', { error: String(err) })
    }
    return this.token
  }

  private setupMiddleware(): void {
    // SECURITY: CORS restricted to local network and mobile app origins
    this.app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (same-origin, mobile apps, curl, etc.)
        if (!origin) {
          return callback(null, true)
        }

        // Allow capacitor:// and file:// schemes (mobile app)
        if (origin.startsWith('capacitor://') || origin.startsWith('file://')) {
          return callback(null, true)
        }

        // Allow localhost variants
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return callback(null, true)
        }

        // Allow local network IP ranges (RFC 1918)
        // 10.x.x.x, 192.168.x.x, 172.16-31.x.x
        const localNetworkPattern = /^https?:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?/
        if (localNetworkPattern.test(origin)) {
          return callback(null, true)
        }

        // Allow Tailscale CGNAT range (100.64.0.0 - 100.127.255.255)
        const tailscaleCgnatPattern = /^https?:\/\/100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+(:\d+)?/
        if (tailscaleCgnatPattern.test(origin)) {
          return callback(null, true)
        }

        // Allow Tailscale MagicDNS hostnames (*.ts.net)
        if (origin.includes('.ts.net')) {
          return callback(null, true)
        }

        // Reject other origins
        log('CORS blocked origin', { origin })
        callback(new Error('CORS not allowed for this origin'))
      },
      credentials: true
    }))

    // Serve static files FIRST (before auth) - UI files don't need auth
    log('Static files path:', { path: this.rendererPath, exists: existsSync(this.rendererPath) })
    if (existsSync(this.rendererPath)) {
      this.app.use(express.static(this.rendererPath, {
        index: 'index.html'
      }))
    }

    // JSON body parsing
    this.app.use(express.json({ limit: '1mb' }))

    // Rate limiting middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const clientIp = getClientIp(req)
      const rateLimit = checkRateLimit(clientIp)

      if (!rateLimit.allowed) {
        return res.status(429).json({
          error: 'Too many failed attempts. Please try again later.',
          retryAfter: rateLimit.retryAfter
        }).setHeader('Retry-After', String(rateLimit.retryAfter || 900))
      }

      next()
    })

    // Auth middleware (skip for health, connect, verify-handshake, and static files)
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      // Skip auth for unauthenticated endpoints
      if (req.path === '/health' || req.path === '/connect' || req.path === '/verify-handshake') {
        return next()
      }
      // Skip auth for static files (token passed in query string for initial load)
      if (this.isStaticPath(req.path)) {
        const queryToken = req.query.token as string
        if (queryToken === this.token) {
          return next()
        }
        // Check cookie for subsequent static file requests
        const cookieToken = req.headers.cookie?.split(';')
          .map(c => c.trim())
          .find(c => c.startsWith('ct_token='))
          ?.split('=')[1]
        if (cookieToken === this.token) {
          return next()
        }
        // No valid token - still serve static files but without sensitive data
        return next()
      }

      const clientIp = getClientIp(req)

      const authHeader = req.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        recordFailedAuth(clientIp)
        return res.status(401).json({ error: 'Missing authorization header' })
      }

      const providedToken = authHeader.slice(7)
      if (providedToken !== this.token) {
        const blocked = recordFailedAuth(clientIp)
        if (blocked) {
          return res.status(429).json({
            error: 'Too many failed attempts. Please try again later.',
            retryAfter: 900
          })
        }
        return res.status(403).json({ error: 'Invalid token' })
      }

      // Successful auth - clear rate limit
      clearRateLimit(clientIp)

      next()
    })

    // IP-based access control middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      // Skip for unauthenticated endpoints and static files
      if (req.path === '/health' || req.path === '/connect' || req.path === '/verify-handshake') {
        return next()
      }
      if (this.isStaticPath(req.path)) {
        return next()
      }

      const clientIp = getClientIp(req)
      const ipClass = classifyIp(clientIp)

      // Determine required access level for this endpoint
      const accessLevel = this.getEndpointAccessLevel(req.path, req.method)

      // Check if IP class is allowed for this access level
      if (!this.isAccessAllowed(ipClass, accessLevel)) {
        return res.status(403).json({
          error: `This operation requires ${accessLevel} access. Your IP (${ipClass}) is not authorized.`
        })
      }

      next()
    })

    // SECURITY: Per-endpoint rate limiting
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      // Skip for health check and static files
      if (req.path === '/health' || this.isStaticPath(req.path)) {
        return next()
      }

      const clientIp = getClientIp(req)
      const result = checkEndpointRateLimit(clientIp, req.method, req.path)

      // Add rate limit headers
      res.setHeader('X-RateLimit-Remaining', String(result.remaining))
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetIn / 1000)))

      if (!result.allowed) {
        return res.status(429).json({
          error: 'Too many requests. Please slow down.',
          retryAfter: Math.ceil(result.resetIn / 1000)
        }).setHeader('Retry-After', String(Math.ceil(result.resetIn / 1000)))
      }

      next()
    })
  }

  /**
   * Get the access level required for an endpoint
   */
  private getEndpointAccessLevel(path: string, method: string): EndpointAccess {
    // Settings: GET is read (allows mobile to load theme), POST is admin-only
    if (path.includes('/api/settings')) {
      return method === 'GET' ? 'read' : 'admin'
    }

    // Terminal and write operations need write access
    if (path.includes('/api/terminal')) {
      return 'write'
    }

    // PTY operations need write access
    if (path.includes('/api/pty')) {
      return 'write'
    }

    // Workspace POST/PUT needs write, GET needs read
    if (path === '/api/workspace') {
      return method === 'GET' ? 'read' : 'write'
    }

    // Project add needs write access
    if (path === '/api/project/add') {
      return 'write'
    }

    // Sessions discovery is read-only
    if (path === '/api/sessions') {
      return 'read'
    }

    // Beads: GET operations are read, write operations need write access
    if (path.includes('/projects/beads')) {
      // Read operations
      if (method === 'GET') {
        return 'read'
      }
      // Write operations (POST, PUT, PATCH, DELETE)
      return 'write'
    }

    // TTS speak/stop/settings need write
    if (path.includes('/api/tts/speak') || path.includes('/api/tts/stop') || path.includes('/api/tts/settings')) {
      return 'write'
    }

    // Default to read for other authenticated endpoints
    return 'read'
  }

  /**
   * Check if an IP class is allowed for the given access level
   */
  private isAccessAllowed(ipClass: IpClass, access: EndpointAccess): boolean {
    switch (access) {
      case 'admin':
        // Admin: localhost only
        return ipClass === 'localhost'
      case 'write':
        // Write: localhost + local_network
        return ipClass === 'localhost' || ipClass === 'local_network'
      case 'read':
        // Read: all authenticated (including public)
        return true
      default:
        return false
    }
  }

  private setupRoutes(): void {
    // Health check (unauthenticated)
    this.app.get('/health', (req: Request, res: Response) => {
      log('Health check', { clientIp: getClientIp(req) })
      res.json({ status: 'ok', version: '2.0.0' })
    })

    // WebSocket test - check if token is valid before trying WebSocket
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
      const ips = this.getLocalIPs()
      res.json({
        port: this.port,
        ips,
        fingerprint: getFormattedFingerprint()
        // Token not exposed here - only via QR code
      })
    })

    // Verify handshake nonce (unauthenticated - but nonce is one-time use)
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

      // Return fingerprint on successful verification
      res.json({
        valid: true,
        fingerprint: getOrCreateFingerprint()
      })
    })

    // Terminal routes
    this.app.post('/api/terminal/create', async (req: Request, res: Response) => {
      try {
        const { cwd, backend = 'claude' } = req.body
        if (!this.ptyManager) {
          return res.status(500).json({ error: 'PTY manager not available' })
        }

        const ptyId = await this.ptyManager.spawn(cwd, backend)

        // Set up data forwarding to WebSocket subscribers
        this.ptyManager.onData(ptyId, (data: string) => {
          this.broadcastTerminalData(ptyId, data)
        })

        res.json({ success: true, ptyId })
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    this.app.post('/api/terminal/:ptyId/write', (req: Request, res: Response) => {
      try {
        const { ptyId } = req.params
        const { data } = req.body
        if (!this.ptyManager) {
          return res.status(500).json({ error: 'PTY manager not available' })
        }
        this.ptyManager.write(ptyId, data)
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    this.app.post('/api/terminal/:ptyId/resize', (req: Request, res: Response) => {
      try {
        const { ptyId } = req.params
        const { cols, rows } = req.body
        if (!this.ptyManager) {
          return res.status(500).json({ error: 'PTY manager not available' })
        }
        this.ptyManager.resize(ptyId, cols, rows)
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    this.app.delete('/api/terminal/:ptyId', (req: Request, res: Response) => {
      try {
        const { ptyId } = req.params
        if (!this.ptyManager) {
          return res.status(500).json({ error: 'PTY manager not available' })
        }
        this.ptyManager.kill(ptyId)
        this.terminalSubscriptions.delete(ptyId)
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    // Workspace routes

    // Reload workspace from disk (useful when file was modified externally)
    this.app.post('/api/workspace/reload', async (_req: Request, res: Response) => {
      try {
        if (!this.sessionStore) {
          return res.status(500).json({ error: 'Session store not available' })
        }
        this.sessionStore.reloadFromDisk()
        const workspace = this.sessionStore.getWorkspace()
        res.json({ success: true, projectCount: workspace.projects?.length || 0 })
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    this.app.get('/api/workspace', async (_req: Request, res: Response) => {
      try {
        if (!this.sessionStore) {
          return res.status(500).json({ error: 'Session store not available' })
        }
        const workspace = this.sessionStore.getWorkspace()
        res.json(workspace)
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    this.app.put('/api/workspace', async (req: Request, res: Response) => {
      try {
        if (!this.sessionStore) {
          return res.status(500).json({ error: 'Session store not available' })
        }
        // Protect against overwriting populated workspace with empty one
        const incoming = req.body
        const incomingProjects = incoming?.projects?.length || 0
        if (incomingProjects === 0) {
          const current = this.sessionStore.getWorkspace()
          const currentProjects = current?.projects?.length || 0
          if (currentProjects > 0) {
            log('Rejected empty workspace save - current has projects', { currentProjects })
            return res.status(400).json({ error: 'Cannot overwrite populated workspace with empty one' })
          }
        }
        this.sessionStore.saveWorkspace(req.body)
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    // Settings routes
    this.app.get('/api/settings', async (_req: Request, res: Response) => {
      try {
        if (!this.sessionStore) {
          return res.status(500).json({ error: 'Session store not available' })
        }
        const settings = this.sessionStore.getSettings()
        res.json(settings)
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    this.app.put('/api/settings', async (req: Request, res: Response) => {
      try {
        if (!this.sessionStore) {
          return res.status(500).json({ error: 'Session store not available' })
        }
        this.sessionStore.saveSettings(req.body)
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    // POST /api/workspace - Save workspace data (alternative to PUT)
    this.app.post('/api/workspace', async (req: Request, res: Response) => {
      try {
        if (!this.sessionStore) {
          return res.status(500).json({ error: 'Session store not available' })
        }
        // Protect against overwriting populated workspace with empty one
        const incoming = req.body
        const incomingProjects = incoming?.workspace?.projects?.length || 0
        if (incomingProjects === 0) {
          const current = this.sessionStore.getWorkspace()
          const currentProjects = current?.workspace?.projects?.length || 0
          if (currentProjects > 0) {
            log('Rejected empty workspace save - current has projects', { currentProjects })
            return res.status(400).json({ error: 'Cannot overwrite populated workspace with empty one' })
          }
        }
        this.sessionStore.saveWorkspace(req.body)
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    // POST /api/settings - Save app settings (alternative to PUT)
    this.app.post('/api/settings', async (req: Request, res: Response) => {
      try {
        if (!this.sessionStore) {
          return res.status(500).json({ error: 'Session store not available' })
        }
        this.sessionStore.saveSettings(req.body)
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    // GET /api/sessions - Discover sessions for a project
    // Query params: path (project path), backend (claude|opencode)
    this.app.get('/api/sessions', async (req: Request, res: Response) => {
      try {
        const projectPath = req.query.path as string
        const backend = (req.query.backend as 'claude' | 'opencode') || 'claude'

        if (!projectPath) {
          return res.status(400).json({ error: 'path query parameter is required' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(projectPath)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeProjectPath = pathValidation.normalizedPath!

        // Discover sessions using the same logic as the main process
        const sessions = await discoverSessions(safeProjectPath, backend)

        // Return in the expected format
        res.json({
          sessions: sessions.map(s => ({
            sessionId: s.sessionId,
            slug: s.slug,
            lastModified: s.lastModified,
            cwd: s.cwd,
            fileSize: s.fileSize
          }))
        })
      } catch (error) {
        log('Sessions discovery error', { error: String(error) })
        res.status(500).json({ error: String(error) })
      }
    })

    // POST /api/project/add - Add a project by path
    // Body: { path: string }
    // Returns: { path: string, name: string }
    this.app.post('/api/project/add', async (req: Request, res: Response) => {
      try {
        const { path: projectPath } = req.body

        if (!projectPath || typeof projectPath !== 'string') {
          return res.status(400).json({ error: 'path is required and must be a string' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(projectPath)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeProjectPath = pathValidation.normalizedPath!

        // Extract project name from path
        const name = basename(safeProjectPath)

        log('Project add', { path: safeProjectPath, name })
        res.json({ path: safeProjectPath, name })
      } catch (error) {
        log('Project add error', { error: String(error) })
        res.status(500).json({ error: String(error) })
      }
    })

    // TTS routes - stream audio from host's Piper/XTTS voices
    this.app.post('/api/tts/speak', async (req: Request, res: Response) => {
      try {
        const { text } = req.body
        if (!text) {
          return res.status(400).json({ error: 'Text is required' })
        }
        if (!this.voiceManager) {
          return res.status(500).json({ error: 'Voice manager not available' })
        }

        const result = await this.voiceManager.speak(text)
        if (result.success && result.audioData) {
          // Return audio as base64 for easy mobile playback
          res.json({
            success: true,
            audioData: result.audioData,
            format: 'wav'
          })
        } else {
          res.status(500).json({ error: result.error || 'TTS failed' })
        }
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    // Stream audio directly as binary (more efficient for large audio)
    this.app.post('/api/tts/speak/stream', async (req: Request, res: Response) => {
      try {
        const { text } = req.body
        if (!text) {
          return res.status(400).json({ error: 'Text is required' })
        }
        if (!this.voiceManager) {
          return res.status(500).json({ error: 'Voice manager not available' })
        }

        const result = await this.voiceManager.speak(text)
        if (result.success && result.audioData) {
          // Decode base64 and send as binary
          const audioBuffer = Buffer.from(result.audioData, 'base64')
          res.setHeader('Content-Type', 'audio/wav')
          res.setHeader('Content-Length', audioBuffer.length)
          res.send(audioBuffer)
        } else {
          res.status(500).json({ error: result.error || 'TTS failed' })
        }
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    this.app.post('/api/tts/stop', async (_req: Request, res: Response) => {
      try {
        if (!this.voiceManager) {
          return res.status(500).json({ error: 'Voice manager not available' })
        }
        this.voiceManager.stopSpeaking()
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    this.app.get('/api/tts/voices', async (_req: Request, res: Response) => {
      try {
        if (!this.voiceManager) {
          return res.status(500).json({ error: 'Voice manager not available' })
        }
        const installed = this.voiceManager.getInstalledPiperVoices()
        const settings = this.voiceManager.getSettings()
        res.json({
          installed,
          currentVoice: settings.ttsVoice,
          currentEngine: settings.ttsEngine
        })
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    this.app.post('/api/tts/settings', async (req: Request, res: Response) => {
      try {
        const { voice, engine, speed } = req.body
        if (!this.voiceManager) {
          return res.status(500).json({ error: 'Voice manager not available' })
        }
        if (voice) this.voiceManager.setTTSVoice(voice)
        if (engine) this.voiceManager.setTTSEngine(engine)
        if (speed) this.voiceManager.setTTSSpeed(speed)
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: String(error) })
      }
    })

    // ========================================
    // Beads API Routes - Task management
    // ========================================

    // GET /projects/beads/check - Check if beads is installed and initialized for a project
    this.app.get('/projects/beads/check', async (req: Request, res: Response) => {
      try {
        const cwd = req.query.cwd as string
        if (!cwd) {
          return res.status(400).json({ error: 'cwd query parameter is required' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(cwd)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeCwd = pathValidation.normalizedPath!

        const installed = await checkBeadsInstalled()
        if (!installed) {
          return res.json({ installed: false, initialized: false })
        }

        const beadsDir = join(safeCwd, '.beads')
        res.json({ installed: true, initialized: existsSync(beadsDir) })
      } catch (error) {
        log('Beads check error', { error: String(error) })
        res.status(500).json({ error: String(error) })
      }
    })

    // POST /projects/beads/init - Initialize beads in a project
    this.app.post('/projects/beads/init', async (req: Request, res: Response) => {
      try {
        const { cwd } = req.body
        if (!cwd) {
          return res.status(400).json({ error: 'cwd is required' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(cwd)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeCwd = pathValidation.normalizedPath!

        await execAsync('bd init', { ...getBeadsExecOptions(), cwd: safeCwd })
        res.json({ success: true })
      } catch (error: any) {
        log('Beads init error', { error: String(error) })
        res.status(500).json({ success: false, error: error.message || String(error) })
      }
    })

    // GET /projects/beads/ready - Get tasks ready to work on
    this.app.get('/projects/beads/ready', async (req: Request, res: Response) => {
      try {
        const cwd = req.query.cwd as string
        if (!cwd) {
          return res.status(400).json({ error: 'cwd query parameter is required' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(cwd)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeCwd = pathValidation.normalizedPath!

        const { stdout } = await execAsync('bd ready --json', { ...getBeadsExecOptions(), cwd: safeCwd })
        res.json({ success: true, tasks: JSON.parse(stdout) })
      } catch (error: any) {
        log('Beads ready error', { error: String(error) })
        res.status(500).json({ success: false, error: error.message || String(error) })
      }
    })

    // GET /projects/beads/tasks - List all tasks (returns BeadsTask[] directly)
    this.app.get('/projects/beads/tasks', async (req: Request, res: Response) => {
      try {
        const cwd = req.query.cwd as string
        if (!cwd) {
          return res.status(400).json({ error: 'cwd query parameter is required' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(cwd)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeCwd = pathValidation.normalizedPath!

        const { stdout } = await execAsync('bd list --json', { ...getBeadsExecOptions(), cwd: safeCwd })
        // Return tasks array directly (httpClient expects BeadsTask[])
        res.json(JSON.parse(stdout))
      } catch (error: any) {
        log('Beads list error', { error: String(error) })
        res.status(500).json({ error: error.message || String(error) })
      }
    })

    // GET /projects/beads/tasks/:taskId - Show a specific task (returns BeadsTask directly)
    this.app.get('/projects/beads/tasks/:taskId', async (req: Request, res: Response) => {
      try {
        const { taskId } = req.params
        const cwd = req.query.cwd as string
        if (!cwd) {
          return res.status(400).json({ error: 'cwd query parameter is required' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(cwd)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeCwd = pathValidation.normalizedPath!

        validateTaskId(taskId)
        const { stdout } = await spawnBdCommand(['show', taskId, '--json'], { cwd: safeCwd })
        // Return task directly (httpClient expects BeadsTask)
        res.json(JSON.parse(stdout))
      } catch (error: any) {
        log('Beads show error', { error: String(error) })
        res.status(500).json({ error: error.message || String(error) })
      }
    })

    // POST /projects/beads/tasks - Create a new task (returns BeadsTask directly)
    this.app.post('/projects/beads/tasks', async (req: Request, res: Response) => {
      try {
        const { cwd, title, description, priority, type, labels } = req.body
        if (!cwd) {
          return res.status(400).json({ error: 'cwd is required' })
        }
        if (!title || typeof title !== 'string') {
          return res.status(400).json({ error: 'title is required' })
        }
        if (type && !TASK_ID_PATTERN.test(type)) {
          return res.status(400).json({ error: 'Invalid type format' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(cwd)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeCwd = pathValidation.normalizedPath!

        const args = ['create', title]
        if (description) args.push('-d', description)
        if (priority !== undefined) args.push('-p', String(priority))
        if (type) args.push('-t', type)
        if (labels) args.push('-l', labels)
        args.push('--json')

        const { stdout } = await spawnBdCommand(args, { cwd: safeCwd })
        // Return task directly (httpClient expects BeadsTask)
        res.json(JSON.parse(stdout))
      } catch (error: any) {
        log('Beads create error', { error: String(error) })
        res.status(500).json({ error: error.message || String(error) })
      }
    })

    // POST /projects/beads/tasks/:taskId/complete - Mark task as complete
    this.app.post('/projects/beads/tasks/:taskId/complete', async (req: Request, res: Response) => {
      try {
        const { taskId } = req.params
        const { cwd } = req.body
        if (!cwd) {
          return res.status(400).json({ error: 'cwd is required' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(cwd)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeCwd = pathValidation.normalizedPath!

        validateTaskId(taskId)
        const { stdout } = await spawnBdCommand(['close', taskId, '--json'], { cwd: safeCwd })
        res.json({ success: true, result: JSON.parse(stdout) })
      } catch (error: any) {
        log('Beads complete error', { error: String(error) })
        res.status(500).json({ success: false, error: error.message || String(error) })
      }
    })

    // POST /projects/beads/tasks/:taskId/start - Start working on a task
    this.app.post('/projects/beads/tasks/:taskId/start', async (req: Request, res: Response) => {
      try {
        const { taskId } = req.params
        const { cwd } = req.body
        if (!cwd) {
          return res.status(400).json({ error: 'cwd is required' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(cwd)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeCwd = pathValidation.normalizedPath!

        validateTaskId(taskId)
        await spawnBdCommand(['update', taskId, '--status', 'in_progress'], { cwd: safeCwd })
        res.json({ success: true })
      } catch (error: any) {
        log('Beads start error', { error: String(error) })
        res.status(500).json({ success: false, error: error.message || String(error) })
      }
    })

    // PATCH /projects/beads/tasks/:taskId - Update a task
    this.app.patch('/projects/beads/tasks/:taskId', async (req: Request, res: Response) => {
      try {
        const { taskId } = req.params
        const { cwd, status, title, description, priority } = req.body
        if (!cwd) {
          return res.status(400).json({ error: 'cwd is required' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(cwd)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeCwd = pathValidation.normalizedPath!

        validateTaskId(taskId)
        const args = ['update', taskId]
        if (status) args.push('--status', status)
        if (title) args.push('--title', title)
        if (description !== undefined) args.push('--description', description)
        if (priority !== undefined) args.push('--priority', String(priority))

        await spawnBdCommand(args, { cwd: safeCwd })
        res.json({ success: true })
      } catch (error: any) {
        log('Beads update error', { error: String(error) })
        res.status(500).json({ success: false, error: error.message || String(error) })
      }
    })

    // DELETE /projects/beads/tasks/:taskId - Delete a task
    this.app.delete('/projects/beads/tasks/:taskId', async (req: Request, res: Response) => {
      try {
        const { taskId } = req.params
        const cwd = req.query.cwd as string
        if (!cwd) {
          return res.status(400).json({ error: 'cwd query parameter is required' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(cwd)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeCwd = pathValidation.normalizedPath!

        validateTaskId(taskId)
        await spawnBdCommand(['delete', taskId, '--force'], { cwd: safeCwd })
        res.json({ success: true })
      } catch (error: any) {
        log('Beads delete error', { error: String(error) })
        res.status(500).json({ success: false, error: error.message || String(error) })
      }
    })

    // ========================================
    // PTY API Routes - Direct PTY management
    // ========================================

    // POST /api/pty/spawn - Spawn a new PTY
    this.app.post('/api/pty/spawn', async (req: Request, res: Response) => {
      try {
        const { projectPath, sessionId, model, backend } = req.body

        if (!projectPath || typeof projectPath !== 'string') {
          return res.status(400).json({ error: 'projectPath is required' })
        }

        // SECURITY: Validate path to prevent traversal attacks
        const pathValidation = validateProjectPath(projectPath)
        if (!pathValidation.valid) {
          return res.status(400).json({ error: pathValidation.error })
        }
        const safeProjectPath = pathValidation.normalizedPath!

        if (!this.ptyManager) {
          return res.status(500).json({ error: 'PTY manager not available' })
        }

        log('PTY spawn request', { projectPath: safeProjectPath, sessionId, model, backend })

        // Use the ptyManager to spawn a new PTY
        const ptyId = this.ptyManager.spawn(
          safeProjectPath,
          sessionId,
          undefined, // autoAcceptTools
          undefined, // permissionMode
          model,
          backend
        )

        // Track this PTY for cleanup
        const localPty: LocalPty = {
          ptyId,
          projectPath: safeProjectPath,
          dataCallbacks: new Set(),
          exitCallbacks: new Set()
        }
        this.localPtys.set(ptyId, localPty)

        // Set up data forwarding to WebSocket streams
        this.ptyManager.onData(ptyId, (data: string) => {
          this.broadcastPtyData(ptyId, data)
        })

        // Set up exit handler
        this.ptyManager.onExit(ptyId, (code: number) => {
          log('PTY exited', { ptyId, code })
          // Notify stream subscribers
          this.broadcastPtyExit(ptyId, code)
          // Clean up
          this.localPtys.delete(ptyId)
          this.ptyStreams.delete(ptyId)
          this.ptyDataBuffer.delete(ptyId)
        })

        log('PTY spawned', { ptyId, projectPath })
        res.json({ ptyId })
      } catch (error) {
        log('PTY spawn error', { error: String(error) })
        res.status(500).json({ error: String(error) })
      }
    })

    // POST /api/pty/:id/write - Write data to PTY
    this.app.post('/api/pty/:id/write', (req: Request, res: Response) => {
      try {
        const { id } = req.params
        const { data } = req.body

        if (!data || typeof data !== 'string') {
          return res.status(400).json({ error: 'data is required and must be a string' })
        }

        if (!this.ptyManager) {
          return res.status(500).json({ error: 'PTY manager not available' })
        }

        // Check if PTY exists
        if (!this.ptyManager.getProcess(id)) {
          return res.status(404).json({ error: 'PTY not found' })
        }

        this.ptyManager.write(id, data)
        log('PTY write', { ptyId: id, dataLength: data.length })
        res.json({ success: true })
      } catch (error) {
        log('PTY write error', { error: String(error) })
        res.status(500).json({ error: String(error) })
      }
    })

    // POST /api/pty/:id/resize - Resize PTY
    this.app.post('/api/pty/:id/resize', (req: Request, res: Response) => {
      try {
        const { id } = req.params
        const { cols, rows } = req.body

        if (typeof cols !== 'number' || typeof rows !== 'number') {
          return res.status(400).json({ error: 'cols and rows are required and must be numbers' })
        }

        if (cols < 1 || rows < 1 || cols > 500 || rows > 500) {
          return res.status(400).json({ error: 'cols and rows must be between 1 and 500' })
        }

        if (!this.ptyManager) {
          return res.status(500).json({ error: 'PTY manager not available' })
        }

        // Check if PTY exists
        if (!this.ptyManager.getProcess(id)) {
          return res.status(404).json({ error: 'PTY not found' })
        }

        this.ptyManager.resize(id, cols, rows)
        log('PTY resize', { ptyId: id, cols, rows })
        res.json({ success: true })
      } catch (error) {
        log('PTY resize error', { error: String(error) })
        res.status(500).json({ error: String(error) })
      }
    })

    // DELETE /api/pty/:id - Kill PTY
    this.app.delete('/api/pty/:id', (req: Request, res: Response) => {
      try {
        const { id } = req.params

        if (!this.ptyManager) {
          return res.status(500).json({ error: 'PTY manager not available' })
        }

        // Check if PTY exists
        if (!this.ptyManager.getProcess(id)) {
          return res.status(404).json({ error: 'PTY not found' })
        }

        // Kill the PTY
        this.ptyManager.kill(id)

        // Clean up local tracking
        this.localPtys.delete(id)

        // Close any WebSocket streams for this PTY
        const streams = this.ptyStreams.get(id)
        if (streams) {
          streams.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close(1000, 'PTY killed')
            }
          })
          this.ptyStreams.delete(id)
        }

        log('PTY killed', { ptyId: id })
        res.json({ success: true })
      } catch (error) {
        log('PTY kill error', { error: String(error) })
        res.status(500).json({ error: String(error) })
      }
    })
  }

  private setupWebSocket(): void {
    if (!this.server) return

    // Main WebSocket server for general communication
    this.wss = new WebSocketServer({ noServer: true })

    // Handle upgrade requests manually to support multiple paths
    this.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '', `http://localhost:${this.port}`)
      const pathname = url.pathname

      // SECURITY: Get token from Sec-WebSocket-Protocol header (preferred) or query string (fallback)
      // Using the protocol header prevents token from appearing in server logs and browser history
      const protocolHeader = req.headers['sec-websocket-protocol'] as string | undefined
      const protocols = protocolHeader?.split(',').map(p => p.trim()) || []
      // Token is passed as a protocol prefixed with 'token-'
      const tokenFromProtocol = protocols.find(p => p.startsWith('token-'))?.slice(6)
      const tokenFromQuery = url.searchParams.get('token')
      const token = tokenFromProtocol || tokenFromQuery

      log('WebSocket upgrade request', {
        url: req.url,
        pathname,
        hasProtocolToken: !!tokenFromProtocol,
        hasQueryToken: !!tokenFromQuery,
        headers: {
          host: req.headers.host,
          origin: req.headers.origin,
          upgrade: req.headers.upgrade
        }
      })

      // Validate token for all WebSocket connections
      if (token !== this.token) {
        log('WebSocket auth failed', { providedToken: token?.slice(0, 8) })
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      // Handle PTY stream WebSocket: /api/pty/:id/stream
      const ptyStreamMatch = pathname.match(/^\/api\/pty\/([^/]+)\/stream$/)
      if (ptyStreamMatch) {
        const ptyId = ptyStreamMatch[1]
        this.handlePtyStreamUpgrade(req, socket, head, ptyId)
        return
      }

      // Handle main WebSocket path: /ws
      if (pathname === '/ws') {
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.wss!.emit('connection', ws, req)
        })
        return
      }

      // Unknown WebSocket path
      log('Unknown WebSocket path', { pathname })
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
    })

    this.wss.on('connection', (ws: WebSocket, req) => {
      log('WebSocket client connected (main)')

      ws.on('message', (message: Buffer) => {
        try {
          const msg = JSON.parse(message.toString())
          this.handleWebSocketMessage(ws, msg)
        } catch (e) {
          log('Invalid WebSocket message', { error: String(e) })
        }
      })

      ws.on('close', () => {
        // Remove from all subscriptions
        this.terminalSubscriptions.forEach((subscribers, ptyId) => {
          subscribers.delete(ws)
          if (subscribers.size === 0) {
            this.terminalSubscriptions.delete(ptyId)
          }
        })
        log('WebSocket client disconnected (main)')
      })

      // Send welcome message
      ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }))
    })
  }

  /**
   * Handle WebSocket upgrade for PTY stream endpoint
   * WebSocket /api/pty/:id/stream - Bidirectional PTY data stream
   */
  private handlePtyStreamUpgrade(req: any, socket: any, head: any, ptyId: string): void {
    // Check if PTY exists
    if (!this.ptyManager || !this.ptyManager.getProcess(ptyId)) {
      log('PTY stream upgrade failed - PTY not found', { ptyId })
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    // Create a WebSocket server just for this connection
    const streamWss = new WebSocketServer({ noServer: true })

    streamWss.handleUpgrade(req, socket, head, (ws) => {
      log('PTY stream connected', { ptyId })

      // Add to stream subscribers
      if (!this.ptyStreams.has(ptyId)) {
        this.ptyStreams.set(ptyId, new Set())
      }
      this.ptyStreams.get(ptyId)!.add(ws)

      // Send connected message
      ws.send(JSON.stringify({ type: 'connected', ptyId }))

      // Flush any buffered data from before WebSocket connected
      this.flushPtyBuffer(ptyId, ws)

      // Handle incoming messages (input to PTY)
      ws.on('message', (message: Buffer) => {
        try {
          const msg = JSON.parse(message.toString())

          switch (msg.type) {
            case 'input':
              // Forward input to PTY
              if (msg.data && this.ptyManager) {
                this.ptyManager.write(ptyId, msg.data)
              }
              break

            case 'resize':
              // Resize PTY
              if (msg.cols && msg.rows && this.ptyManager) {
                this.ptyManager.resize(ptyId, msg.cols, msg.rows)
              }
              break

            case 'ping':
              ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
              break

            default:
              log('Unknown PTY stream message type', { type: msg.type, ptyId })
          }
        } catch (e) {
          log('Invalid PTY stream message', { error: String(e), ptyId })
        }
      })

      // Handle disconnect
      ws.on('close', () => {
        log('PTY stream disconnected', { ptyId })
        this.ptyStreams.get(ptyId)?.delete(ws)
        if (this.ptyStreams.get(ptyId)?.size === 0) {
          this.ptyStreams.delete(ptyId)
        }
      })

      ws.on('error', (err) => {
        log('PTY stream error', { error: String(err), ptyId })
        this.ptyStreams.get(ptyId)?.delete(ws)
      })
    })
  }

  private handleWebSocketMessage(ws: WebSocket, msg: any): void {
    switch (msg.type) {
      case 'subscribe':
        // Subscribe to terminal output
        if (msg.ptyId) {
          if (!this.terminalSubscriptions.has(msg.ptyId)) {
            this.terminalSubscriptions.set(msg.ptyId, new Set())
          }
          this.terminalSubscriptions.get(msg.ptyId)!.add(ws)
          ws.send(JSON.stringify({ type: 'subscribed', ptyId: msg.ptyId }))
        }
        break

      case 'unsubscribe':
        if (msg.ptyId) {
          this.terminalSubscriptions.get(msg.ptyId)?.delete(ws)
        }
        break

      case 'write':
        // Write to terminal
        if (msg.ptyId && msg.data && this.ptyManager) {
          this.ptyManager.write(msg.ptyId, msg.data)
        }
        break

      case 'resize':
        // Resize terminal
        if (msg.ptyId && msg.cols && msg.rows && this.ptyManager) {
          this.ptyManager.resize(msg.ptyId, msg.cols, msg.rows)
        }
        break

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
        break
    }
  }

  private broadcastTerminalData(ptyId: string, data: string): void {
    const subscribers = this.terminalSubscriptions.get(ptyId)
    if (!subscribers) return

    const message = JSON.stringify({
      type: 'terminal-data',
      ptyId,
      data
    })

    subscribers.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message)
      }
    })
  }

  /**
   * Broadcast PTY output data to all connected stream WebSockets
   * Buffers data if no streams are connected yet
   */
  private broadcastPtyData(ptyId: string, data: string): void {
    const streams = this.ptyStreams.get(ptyId)

    // If no streams connected, buffer the data
    if (!streams || streams.size === 0) {
      if (!this.ptyDataBuffer.has(ptyId)) {
        this.ptyDataBuffer.set(ptyId, [])
      }
      const buffer = this.ptyDataBuffer.get(ptyId)!
      buffer.push(data)
      // Limit buffer size to prevent memory issues
      if (buffer.length > 1000) {
        buffer.shift()
      }
      return
    }

    const message = JSON.stringify({
      type: 'data',
      data
    })

    streams.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message)
      }
    })
  }

  /**
   * Flush buffered PTY data to a WebSocket
   */
  private flushPtyBuffer(ptyId: string, ws: WebSocket): void {
    const buffer = this.ptyDataBuffer.get(ptyId)
    if (!buffer || buffer.length === 0) return

    // Send all buffered data
    buffer.forEach(data => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }))
      }
    })

    // Clear the buffer
    this.ptyDataBuffer.delete(ptyId)
  }

  /**
   * Broadcast PTY exit event to all connected stream WebSockets
   */
  private broadcastPtyExit(ptyId: string, code: number): void {
    const streams = this.ptyStreams.get(ptyId)
    if (!streams || streams.size === 0) return

    const message = JSON.stringify({
      type: 'exit',
      code
    })

    streams.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message)
        ws.close(1000, 'PTY exited')
      }
    })
  }

  private getLocalIPs(): string[] {
    const ips: string[] = []
    const interfaces = networkInterfaces()

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        // Skip internal and non-IPv4 addresses
        if (iface.internal || iface.family !== 'IPv4') continue
        ips.push(iface.address)
      }
    }

    return ips
  }

  private getTailscaleHostname(): string | null {
    try {
      const { execSync } = require('child_process')
      const output = execSync('tailscale status --json', { encoding: 'utf-8', timeout: 5000 })
      const status = JSON.parse(output)
      // Get the DNS name for this machine
      if (status.Self && status.Self.DNSName) {
        // DNSName ends with a dot, remove it
        return status.Self.DNSName.replace(/\.$/, '')
      }
    } catch {
      // Tailscale not installed or not running
    }
    return null
  }

  // Register service handlers from main process
  setPtyManager(manager: any): void {
    this.ptyManager = manager
  }

  setSessionStore(store: any): void {
    this.sessionStore = store
  }

  setVoiceManager(manager: any): void {
    this.voiceManager = manager
  }

  // Get connection info for QR code (v2 format with security features)
  getConnectionInfo(): {
    url: string
    token: string
    port: number
    ips: string[]
    fingerprint: string
    formattedFingerprint: string
    nonce: string
    nonceExpires: number
    qrData: string
  } {
    const ips = this.getLocalIPs()
    const primaryIp = ips[0] || 'localhost'
    const fingerprint = getOrCreateFingerprint()
    const { nonce, expiresAt } = createNonce()

    // Include Tailscale hostname if available (more reliable than IP for Tailscale connections)
    const tailscaleHostname = this.getTailscaleHostname()
    const allHosts = tailscaleHostname ? [...ips, tailscaleHostname] : ips

    // V2 QR code format is JSON - includes all IPs/hostnames for multi-host connection attempts
    const qrPayload = {
      type: 'claude-terminal',
      version: 2,
      host: primaryIp,  // Primary IP for backward compatibility
      hosts: allHosts,  // All available IPs + Tailscale hostname for multi-host connection
      port: this.port,
      token: this.token,
      fingerprint,
      nonce,
      nonceExpires: expiresAt
    }

    return {
      url: `claude-terminal://${primaryIp}:${this.port}?token=${this.token}`,
      token: this.token,
      port: this.port,
      ips,
      fingerprint,
      formattedFingerprint: getFormattedFingerprint(),
      nonce,
      nonceExpires: expiresAt,
      qrData: JSON.stringify(qrPayload)
    }
  }

  // Generate a fresh nonce (for QR refresh)
  generateNonce(): { nonce: string; expiresAt: number } {
    return createNonce()
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = createServer(this.app)
        this.setupWebSocket()

        // Start nonce cleanup
        startNonceCleanup()

        // Start endpoint rate limit cleanup (every 2 minutes)
        this.rateLimitCleanupInterval = setInterval(() => {
          cleanupEndpointRateLimits()
        }, 2 * 60 * 1000)

        this.server.listen(this.port, '0.0.0.0', () => {
          log(`Started on port ${this.port}`)
          log(`Token: ${this.token.slice(0, 8)}...`)
          log(`Fingerprint: ${getFormattedFingerprint()}`)
          resolve()
        })

        this.server.on('error', (err: NodeJS.ErrnoException) => {
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
      } catch (error) {
        reject(error)
      }
    })
  }

  stop(): void {
    // Stop nonce cleanup
    stopNonceCleanup()

    // Stop endpoint rate limit cleanup
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
