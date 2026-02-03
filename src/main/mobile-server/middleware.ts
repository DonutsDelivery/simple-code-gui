/**
 * Mobile Server Middleware - CORS, auth, rate limiting
 */

import { Express, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import express from 'express'
import { existsSync } from 'fs'
import {
  classifyIp,
  getClientIp,
  checkRateLimit,
  recordFailedAuth,
  clearRateLimit,
  checkEndpointRateLimit,
  IpClass
} from '../mobile-security'
import { log, isStaticPath } from './utils'
import { EndpointAccess } from './types'

export function setupCorsMiddleware(app: Express): void {
  app.use(cors({
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
}

export function setupStaticMiddleware(app: Express, rendererPath: string): void {
  log('Static files path:', { path: rendererPath, exists: existsSync(rendererPath) })
  if (existsSync(rendererPath)) {
    app.use(express.static(rendererPath, {
      index: 'index.html'
    }))
  }
}

export function setupJsonMiddleware(app: Express): void {
  app.use(express.json({ limit: '1mb' }))
}

export function setupRateLimitMiddleware(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
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
}

export function setupAuthMiddleware(app: Express, getToken: () => string): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Skip auth for unauthenticated endpoints
    if (req.path === '/health' || req.path === '/connect' || req.path === '/verify-handshake') {
      return next()
    }

    // /ws-test uses query string auth (validates token itself)
    if (req.path === '/ws-test') {
      const queryToken = req.query.token as string
      if (queryToken === getToken()) {
        return next()
      }
      // Let the route handler return the proper error
      return next()
    }
    // Skip auth for static files (token passed in query string for initial load)
    if (isStaticPath(req.path)) {
      const queryToken = req.query.token as string
      if (queryToken === getToken()) {
        return next()
      }
      // Check cookie for subsequent static file requests
      const cookieToken = req.headers.cookie?.split(';')
        .map(c => c.trim())
        .find(c => c.startsWith('ct_token='))
        ?.split('=')[1]
      if (cookieToken === getToken()) {
        return next()
      }
      // No valid token - still serve static files but without sensitive data
      return next()
    }

    const clientIp = getClientIp(req)

    // Allow query token for file downloads (needed for Android WebView window.open)
    if (req.path.startsWith('/api/files/')) {
      const queryToken = req.query.token as string
      if (queryToken === getToken()) {
        clearRateLimit(clientIp)
        return next()
      }
    }

    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      recordFailedAuth(clientIp)
      return res.status(401).json({ error: 'Missing authorization header' })
    }

    const providedToken = authHeader.slice(7)
    if (providedToken !== getToken()) {
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
}

export function getEndpointAccessLevel(path: string, method: string): EndpointAccess {
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
    if (method === 'GET') {
      return 'read'
    }
    return 'write'
  }

  // TTS speak/stop/settings need write
  if (path.includes('/api/tts/speak') || path.includes('/api/tts/stop') || path.includes('/api/tts/settings')) {
    return 'write'
  }

  // File operations: restricted to local network for security
  if (path.includes('/api/files')) {
    return 'write'
  }

  // Default to read for other authenticated endpoints
  return 'read'
}

export function isAccessAllowed(ipClass: IpClass, access: EndpointAccess): boolean {
  switch (access) {
    case 'admin':
      return ipClass === 'localhost'
    case 'write':
      return ipClass === 'localhost' || ipClass === 'local_network'
    case 'read':
      return true
    default:
      return false
  }
}

export function setupIpAccessMiddleware(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Skip for unauthenticated endpoints and static files
    if (req.path === '/health' || req.path === '/connect' || req.path === '/verify-handshake' || req.path === '/ws-test') {
      return next()
    }
    if (isStaticPath(req.path)) {
      return next()
    }

    const clientIp = getClientIp(req)
    const ipClass = classifyIp(clientIp)

    // Determine required access level for this endpoint
    const accessLevel = getEndpointAccessLevel(req.path, req.method)

    // Check if IP class is allowed for this access level
    if (!isAccessAllowed(ipClass, accessLevel)) {
      return res.status(403).json({
        error: `This operation requires ${accessLevel} access. Your IP (${ipClass}) is not authorized.`
      })
    }

    next()
  })
}

export function setupEndpointRateLimitMiddleware(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Skip for health check, ws-test, and static files
    if (req.path === '/health' || req.path === '/ws-test' || isStaticPath(req.path)) {
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
