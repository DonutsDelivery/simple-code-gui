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
import { deviceTokenAllows, isDeviceTokenValid, touchDevice } from './device-registry'
import { log, isStaticPath, tokensEqual } from './utils'
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

      // Parse origin to extract hostname for safe validation
      let hostname: string
      try {
        hostname = new URL(origin).hostname
      } catch {
        log('CORS blocked malformed origin', { origin })
        return callback(new Error('CORS not allowed for this origin'))
      }

      // Allow localhost variants
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return callback(null, true)
      }

      // Allow local network IP ranges (RFC 1918)
      // 10.x.x.x, 192.168.x.x, 172.16-31.x.x
      const localNetworkPattern = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/
      if (localNetworkPattern.test(hostname)) {
        return callback(null, true)
      }

      // Allow Tailscale CGNAT range (100.64.0.0 - 100.127.255.255)
      const tailscaleCgnatPattern = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/
      if (tailscaleCgnatPattern.test(hostname)) {
        return callback(null, true)
      }

      // Allow Tailscale MagicDNS hostnames (*.ts.net)
      if (hostname.endsWith('.ts.net')) {
        return callback(null, true)
      }

      // Reject other origins
      log('CORS blocked origin', { origin })
      callback(new Error('CORS not allowed for this origin'))
    },
    // M5: do not reflect credentials. Auth uses Bearer header / query token /
    // Sec-WebSocket-Protocol — never cross-origin cookies — so credentialed CORS
    // only widens the attack surface (origin reflection + credentials).
    credentials: false
  }))
}

export function setupStaticMiddleware(app: Express, rendererPath: string, _getToken: () => string): void {
  log('Static files path:', { path: rendererPath, exists: existsSync(rendererPath) })
  if (!existsSync(rendererPath)) return

  // The remote UI is a bundled Capacitor application. Never bootstrap a browser
  // session by placing a durable credential in a URL or cookie; only localhost
  // may load the server's static renderer.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isStaticPath(req.path) && req.path !== '/') return next()
    if (classifyIp(getClientIp(req)) !== 'localhost') {
      return res.status(403).json({ error: 'Remote browser UI is disabled; pair with the DonutCode app.' })
    }
    return next()
  })

  app.use(express.static(rendererPath, {
    index: 'index.html'
  }))
}

export function setupJsonMiddleware(app: Express): void {
  app.use(express.json({ limit: '1mb' }))
}

export function setupRateLimitMiddleware(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const clientIp = getClientIp(req)
    const rateLimit = checkRateLimit(clientIp)

    if (!rateLimit.allowed) {
      return res
        .setHeader('Retry-After', String(rateLimit.retryAfter || 900))
        .status(429)
        .json({
          error: 'Too many failed attempts. Please try again later.',
          retryAfter: rateLimit.retryAfter
        })
    }

    next()
  })
}

export function setupAuthMiddleware(app: Express, getToken: () => string): void {
  // A token authenticates if it's the legacy shared server token (back-compat
  // for already-paired devices) OR a valid per-device token (H3). Device tokens
  // let us revoke one phone without rotating the shared secret and re-scanning.
  const isTokenValid = (token?: string): boolean =>
    !!token && (tokensEqual(token, getToken()) || isDeviceTokenValid(token))

  app.use((req: Request, res: Response, next: NextFunction) => {
    // Skip auth for unauthenticated endpoints
    if (
      req.path === '/health'
      || req.path === '/connect'
      || req.path === '/verify-handshake'
      || req.path === '/api/auth/pake/start'
      || req.path === '/api/auth/pake/finish'
      || req.path === '/api/auth/pairing-offer/request'
      || /^\/api\/auth\/pairing-offer\/request\/[^/]+\/status$/.test(req.path)
    ) {
      return next()
    }

    const clientIp = getClientIp(req)

    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      recordFailedAuth(clientIp)
      return res.status(401).json({ error: 'Missing authorization header' })
    }

    const providedToken = authHeader.slice(7)
    if (!isTokenValid(providedToken)) {
      const blocked = recordFailedAuth(clientIp)
      if (blocked) {
        return res.status(429).json({
          error: 'Too many failed attempts. Please try again later.',
          retryAfter: 900
        })
      }
      return res.status(403).json({ error: 'Invalid token' })
    }

    // Successful auth - clear rate limit. A read-scoped device may request a
    // ticket only for the read-only main socket; PTY stream tickets require write.
    const websocketPurpose = req.path === '/api/auth/websocket-ticket' ? req.body?.purpose : undefined
    const requiredScope = websocketPurpose === '/ws'
      ? 'read'
      : req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write'
    if (
      isDeviceTokenValid(providedToken)
      && !deviceTokenAllows(providedToken, requiredScope)
    ) {
      return res.status(403).json({ error: `Device credential lacks ${requiredScope} scope` })
    }

    touchDevice(providedToken)
    clearRateLimit(clientIp)
    ;(req as Request & { authToken?: string }).authToken = providedToken

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

  if (path.startsWith('/api/environment/')) {
    return method === 'GET' ? 'read' : 'write'
  }

  // Repository identity reads are read-only; identify/materialize/bundle/patch are writes
  if (path.startsWith('/api/repositories')) {
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
    // Skip for credential-free pairing endpoints, health checks, and static files.
    if (
      req.path === '/health'
      || req.path === '/connect'
      || req.path === '/verify-handshake'
      || req.path === '/api/auth/pake/start'
      || req.path === '/api/auth/pake/finish'
      || req.path === '/api/auth/pairing-offer/request'
      || /^\/api\/auth\/pairing-offer\/request\/[^/]+\/status$/.test(req.path)
    ) {
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

    // The embedded desktop renderer and the pairing UI live on loopback and
    // drive frequent workspace commands (project adds, tile changes). Rate
    // limiting protects the host from LAN/remote abuse; loopback is the
    // trusted local user, so exempt it from the per-endpoint budget.
    if (classifyIp(clientIp) === 'localhost') {
      return next()
    }

    const result = checkEndpointRateLimit(clientIp, req.method, req.path)

    // Add rate limit headers
    res.setHeader('X-RateLimit-Remaining', String(result.remaining))
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetIn / 1000)))

    if (!result.allowed) {
      return res
        .setHeader('Retry-After', String(Math.ceil(result.resetIn / 1000)))
        .status(429)
        .json({
          error: 'Too many requests. Please slow down.',
          retryAfter: Math.ceil(result.resetIn / 1000)
        })
    }

    next()
  })
}
