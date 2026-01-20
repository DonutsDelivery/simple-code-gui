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
import { join, basename } from 'path'

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
  IpClass
} from './mobile-security'
import { discoverSessions } from './session-discovery'

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

  constructor(config: MobileServerConfig = {}) {
    this.port = config.port || DEFAULT_PORT
    this.token = this.loadOrCreateToken()
    this.app = express()
    this.setupMiddleware()
    this.setupRoutes()
  }

  private getTokenPath(): string {
    return join(app.getPath('userData'), 'mobile-server-token')
  }

  private loadOrCreateToken(): string {
    const tokenPath = this.getTokenPath()
    try {
      if (existsSync(tokenPath)) {
        const token = readFileSync(tokenPath, 'utf-8').trim()
        if (token && token.length === 64) { // Valid 32-byte hex token
          log('Loaded existing token')
          return token
        }
      }
    } catch (err) {
      log('Failed to load token, generating new one', { error: String(err) })
    }

    // Generate and save new token
    const token = randomBytes(32).toString('hex')
    try {
      writeFileSync(tokenPath, token, 'utf-8')
      log('Generated and saved new token')
    } catch (err) {
      log('Failed to save token', { error: String(err) })
    }
    return token
  }

  regenerateToken(): string {
    this.token = randomBytes(32).toString('hex')
    try {
      writeFileSync(this.getTokenPath(), this.token, 'utf-8')
      log('Regenerated and saved token')
    } catch (err) {
      log('Failed to save regenerated token', { error: String(err) })
    }
    return this.token
  }

  private setupMiddleware(): void {
    // CORS for local network
    this.app.use(cors({
      origin: true,
      credentials: true
    }))

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

    // Auth middleware (skip for health, connect, and verify-handshake endpoints)
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/health' || req.path === '/connect' || req.path === '/verify-handshake') {
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
      // Skip for unauthenticated endpoints
      if (req.path === '/health' || req.path === '/connect' || req.path === '/verify-handshake') {
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

        // Validate path exists
        if (!existsSync(projectPath)) {
          return res.status(404).json({ error: 'Project path does not exist' })
        }

        // Discover sessions using the same logic as the main process
        const sessions = await discoverSessions(projectPath, backend)

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

        // Validate path exists and is a directory
        if (!existsSync(projectPath)) {
          return res.status(404).json({ error: 'Path does not exist' })
        }

        try {
          const stats = statSync(projectPath)
          if (!stats.isDirectory()) {
            return res.status(400).json({ error: 'Path must be a directory' })
          }
        } catch (e) {
          return res.status(400).json({ error: 'Unable to access path' })
        }

        // Extract project name from path
        const name = basename(projectPath)

        log('Project add', { path: projectPath, name })
        res.json({ path: projectPath, name })
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
    // PTY API Routes - Direct PTY management
    // ========================================

    // POST /api/pty/spawn - Spawn a new PTY
    this.app.post('/api/pty/spawn', async (req: Request, res: Response) => {
      try {
        const { projectPath, sessionId, model, backend } = req.body

        if (!projectPath || typeof projectPath !== 'string') {
          return res.status(400).json({ error: 'projectPath is required' })
        }

        if (!this.ptyManager) {
          return res.status(500).json({ error: 'PTY manager not available' })
        }

        log('PTY spawn request', { projectPath, sessionId, model, backend })

        // Use the ptyManager to spawn a new PTY
        const ptyId = this.ptyManager.spawn(
          projectPath,
          sessionId,
          undefined, // autoAcceptTools
          undefined, // permissionMode
          model,
          backend
        )

        // Track this PTY for cleanup
        const localPty: LocalPty = {
          ptyId,
          projectPath,
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
      const token = url.searchParams.get('token')

      log('WebSocket upgrade request', {
        url: req.url,
        pathname,
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

    // V2 QR code format is JSON
    const qrPayload = {
      type: 'claude-terminal',
      version: 2,
      host: primaryIp,
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
