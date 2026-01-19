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

const DEFAULT_PORT = 38470

interface MobileServerConfig {
  port?: number
}

interface TerminalSubscription {
  ws: WebSocket
  ptyId: string
}

export class MobileServer {
  private app: Express
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private token: string
  private port: number
  private terminalSubscriptions: Map<string, Set<WebSocket>> = new Map()

  // Service handlers - set by main process
  private ptyManager: any = null
  private sessionStore: any = null

  constructor(config: MobileServerConfig = {}) {
    this.port = config.port || DEFAULT_PORT
    this.token = this.generateToken()
    this.app = express()
    this.setupMiddleware()
    this.setupRoutes()
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex')
  }

  regenerateToken(): string {
    this.token = this.generateToken()
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

    // Auth middleware (skip for health and connect endpoints)
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/health' || req.path === '/connect') {
        return next()
      }

      const authHeader = req.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing authorization header' })
      }

      const providedToken = authHeader.slice(7)
      if (providedToken !== this.token) {
        return res.status(403).json({ error: 'Invalid token' })
      }

      next()
    })
  }

  private setupRoutes(): void {
    // Health check (unauthenticated)
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', version: '1.0.0' })
    })

    // Connection info for QR code (unauthenticated)
    this.app.get('/connect', (_req: Request, res: Response) => {
      const ips = this.getLocalIPs()
      res.json({
        port: this.port,
        ips,
        // Token not exposed here - only via QR code
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
  }

  private setupWebSocket(): void {
    if (!this.server) return

    this.wss = new WebSocketServer({ server: this.server, path: '/ws' })

    this.wss.on('connection', (ws: WebSocket, req) => {
      // Validate token from query string
      const url = new URL(req.url || '', `http://localhost:${this.port}`)
      const token = url.searchParams.get('token')

      if (token !== this.token) {
        ws.close(4001, 'Invalid token')
        return
      }

      console.log('[MobileServer] WebSocket client connected')

      ws.on('message', (message: Buffer) => {
        try {
          const msg = JSON.parse(message.toString())
          this.handleWebSocketMessage(ws, msg)
        } catch (e) {
          console.error('[MobileServer] Invalid WebSocket message:', e)
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
        console.log('[MobileServer] WebSocket client disconnected')
      })

      // Send welcome message
      ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }))
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

  // Get connection info for QR code
  getConnectionInfo(): { url: string; token: string; port: number; ips: string[] } {
    const ips = this.getLocalIPs()
    const primaryIp = ips[0] || 'localhost'
    return {
      url: `claude-terminal://${primaryIp}:${this.port}?token=${this.token}`,
      token: this.token,
      port: this.port,
      ips
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = createServer(this.app)
        this.setupWebSocket()

        this.server.listen(this.port, '0.0.0.0', () => {
          console.log(`[MobileServer] Started on port ${this.port}`)
          console.log(`[MobileServer] Token: ${this.token.slice(0, 8)}...`)
          resolve()
        })

        this.server.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            console.error(`[MobileServer] Port ${this.port} in use, trying ${this.port + 1}`)
            this.port++
            this.server?.close()
            this.start().then(resolve).catch(reject)
          } else {
            reject(err)
          }
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  stop(): void {
    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
    if (this.server) {
      this.server.close()
      this.server = null
    }
    console.log('[MobileServer] Stopped')
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening
  }
}
