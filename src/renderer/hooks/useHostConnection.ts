import { useState, useCallback, useEffect, useRef } from 'react'

// ============================================
// Types and Interfaces
// ============================================

export interface HostConfig {
  id: string
  name: string        // User nickname or auto-generated
  host: string
  port: number
  token: string
  lastConnected?: Date
  // v2 security fields
  fingerprint?: string       // Server fingerprint (TOFU - stored after first verify)
  pendingNonce?: string      // Nonce to verify on connect
  nonceExpires?: number      // When the nonce expires
}

export type ConnectionState = 'disconnected' | 'connecting' | 'verifying' | 'connected' | 'error'
export type ConnectionMethod = 'none' | 'websocket' | 'http-polling'

// File pushed from desktop for download
export interface PendingFile {
  id: string
  name: string
  size: number
  mimeType: string
  message?: string
}

export interface HostConnectionState {
  hosts: HostConfig[]
  currentHost: HostConfig | null
  connectionState: ConnectionState
  connectionMethod: ConnectionMethod  // Shows whether using WebSocket or HTTP polling
  error: string | null
  fingerprintWarning: string | null  // Set when fingerprint mismatch detected
  pendingFiles: PendingFile[]  // Files pushed from desktop for download
}

export interface HostConnectionActions {
  addHost: (config: Omit<HostConfig, 'id'>) => HostConfig
  removeHost: (id: string) => void
  updateHost: (id: string, updates: Partial<Omit<HostConfig, 'id'>>) => void
  connect: (hostId: string, options?: { nonce?: string; fingerprint?: string; token?: string; host?: string; port?: number }) => void
  disconnect: () => void
  reconnect: () => void
  acceptFingerprint: () => void  // Accept a new/changed fingerprint
  clearPendingFile: (fileId: string) => void  // Remove a pending file from the list
  clearAllPendingFiles: () => void  // Clear all pending files
}

export type UseHostConnectionReturn = HostConnectionState & HostConnectionActions

// ============================================
// Constants
// ============================================

const STORAGE_KEY = 'claude-terminal-hosts'
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000] // Exponential backoff
const MAX_RECONNECT_ATTEMPTS = 5
const PING_INTERVAL = 30000 // 30 seconds
const PONG_TIMEOUT = 10000 // 10 seconds

// ============================================
// Helper Functions
// ============================================

/**
 * Generate a unique ID for hosts
 */
function generateId(): string {
  return `host-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Load hosts from localStorage
 */
function loadHosts(): HostConfig[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []

    const hosts = JSON.parse(stored) as HostConfig[]

    // Convert date strings back to Date objects
    return hosts.map(host => ({
      ...host,
      lastConnected: host.lastConnected ? new Date(host.lastConnected) : undefined
    }))
  } catch {
    return []
  }
}

/**
 * Save hosts to localStorage
 */
function saveHosts(hosts: HostConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hosts))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Check if host is a local/private network address
 * Includes: localhost, private IPv4 ranges, Tailscale CGNAT (100.64-127.x.x), and MagicDNS (*.ts.net)
 */
function isLocalNetwork(hostname: string): boolean {
  // RFC 1918 private ranges + Tailscale CGNAT (100.64-127.x.x) + MagicDNS (*.ts.net)
  return /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(hostname) ||
         hostname.endsWith('.ts.net')
}

/**
 * Validate port number - returns true if valid
 */
function isValidPort(port: number): boolean {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * Build WebSocket URL from host config
 * Token passed via query string for Capacitor WebView compatibility
 */
function buildWebSocketUrl(host: HostConfig): string {
  // Validate port before building URL
  if (!isValidPort(host.port)) {
    console.error('[useHostConnection] Invalid port for WebSocket URL:', host.port)
    throw new Error(`Invalid port: ${host.port}`)
  }
  // Use ws:// for local networks, wss:// for public
  const protocol = isLocalNetwork(host.host) ? 'ws' : 'wss'
  return `${protocol}://${host.host}:${host.port}/ws?token=${encodeURIComponent(host.token)}`
}

/**
 * Build HTTP URL from host config
 */
function buildHttpUrl(host: HostConfig, path: string): string {
  // Validate port before building URL
  if (!isValidPort(host.port)) {
    console.error('[useHostConnection] Invalid port for HTTP URL:', host.port)
    throw new Error(`Invalid port: ${host.port}`)
  }
  // Use http:// for local networks, https:// for public
  const protocol = isLocalNetwork(host.host) ? 'http' : 'https'
  return `${protocol}://${host.host}:${host.port}${path}`
}

/**
 * Verify handshake with server
 * Returns the server's fingerprint if successful
 */
async function verifyHandshake(host: HostConfig, nonce: string): Promise<{ success: boolean; fingerprint?: string; error?: string }> {
  try {
    const url = buildHttpUrl(host, '/verify-handshake')
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce })
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return { success: false, error: data.error || `HTTP ${response.status}` }
    }

    const data = await response.json()
    if (data.valid && data.fingerprint) {
      return { success: true, fingerprint: data.fingerprint }
    }

    return { success: false, error: 'Invalid handshake response' }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

// ============================================
// Hook Implementation
// ============================================

export function useHostConnection(): UseHostConnectionReturn {
  // State
  const [hosts, setHosts] = useState<HostConfig[]>(loadHosts)
  const [currentHost, setCurrentHost] = useState<HostConfig | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [connectionMethod, setConnectionMethod] = useState<ConnectionMethod>('none')
  const [error, setError] = useState<string | null>(null)
  const [fingerprintWarning, setFingerprintWarning] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])

  // Refs for WebSocket management
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Pending fingerprint for TOFU acceptance
  const pendingFingerprintRef = useRef<{ hostId: string; fingerprint: string } | null>(null)

  // Save hosts to localStorage when they change
  useEffect(() => {
    saveHosts(hosts)
  }, [hosts])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current)
      }
      if (pongTimerRef.current) {
        clearTimeout(pongTimerRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  /**
   * Clear all timers
   */
  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current)
      pingTimerRef.current = null
    }
    if (pongTimerRef.current) {
      clearTimeout(pongTimerRef.current)
      pongTimerRef.current = null
    }
  }, [])

  /**
   * Start ping/pong keep-alive
   */
  const startPingPong = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current)
    }

    pingTimerRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // Send ping
        wsRef.current.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))

        // Set timeout for pong response
        pongTimerRef.current = setTimeout(() => {
          // No pong received, connection is stale
          console.warn('WebSocket pong timeout, reconnecting...')
          wsRef.current?.close()
        }, PONG_TIMEOUT)
      }
    }, PING_INTERVAL)
  }, [])

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data as string)

      // Handle pong response
      if (data.type === 'pong') {
        if (pongTimerRef.current) {
          clearTimeout(pongTimerRef.current)
          pongTimerRef.current = null
        }
        return
      }

      // Handle file available notification (single file pushed)
      if (data.type === 'file:available' && data.file) {
        console.log('[WebSocket] File available for download:', data.file)
        setPendingFiles(prev => {
          // Avoid duplicates
          if (prev.some(f => f.id === data.file.id)) return prev
          return [...prev, data.file as PendingFile]
        })
        return
      }

      // Handle pending files list (sent on connect)
      if (data.type === 'files:pending' && Array.isArray(data.files)) {
        console.log('[WebSocket] Pending files:', data.files)
        setPendingFiles(data.files as PendingFile[])
        return
      }

      // Other message types can be handled here or by listeners
      console.log('WebSocket message:', data)
    } catch {
      // Handle non-JSON messages
      console.log('WebSocket raw message:', event.data)
    }
  }, [])

  /**
   * Internal function to establish HTTP polling connection (fallback when WebSocket fails)
   */
  const establishHttpPolling = useCallback(async (host: HostConfig, hostId: string) => {
    console.log('[HTTP Polling] Starting polling connection')

    // Do immediate health check to validate connection
    try {
      const url = buildHttpUrl(host, '/health')
      console.log('[HTTP Polling] Initial health check:', url)
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json()
      console.log('[HTTP Polling] Health check passed:', data)
    } catch (err) {
      console.error('[HTTP Polling] Initial health check failed:', err)
      setConnectionState('error')
      setError(`Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      return
    }

    setConnectionState('connected')
    setConnectionMethod('http-polling')
    setError(null)
    setFingerprintWarning(null)
    reconnectAttemptRef.current = 0

    // Update last connected time
    setHosts(prev =>
      prev.map(h =>
        h.id === hostId
          ? { ...h, lastConnected: new Date() }
          : h
      )
    )

    // Track consecutive failures for retry logic
    let consecutiveFailures = 0
    const MAX_FAILURES = 3

    // Helper to fetch pending files
    const fetchPendingFiles = async () => {
      const url = buildHttpUrl(host, '/api/files/pending')
      console.log('[HTTP Polling] Fetching pending files from:', url)
      try {
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${host.token}` },
          signal: AbortSignal.timeout(5000)
        })
        console.log('[HTTP Polling] Pending files response:', response.status)
        if (response.ok) {
          const data = await response.json()
          console.log('[HTTP Polling] Pending files data:', data)
          if (data.files && Array.isArray(data.files)) {
            console.log('[HTTP Polling] Setting pending files:', data.files.length)
            setPendingFiles(data.files as PendingFile[])
          }
        } else {
          const errorText = await response.text()
          console.error('[HTTP Polling] Pending files error:', response.status, errorText)
        }
      } catch (err) {
        console.error('[HTTP Polling] Failed to fetch pending files:', err)
      }
    }

    // Fetch pending files immediately on connect
    fetchPendingFiles()

    // Start HTTP polling for keep-alive (longer interval since we validated)
    const pollInterval = setInterval(async () => {
      try {
        const url = buildHttpUrl(host, '/health')
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000) // 10 second timeout
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        consecutiveFailures = 0 // Reset on success
        console.log('[HTTP Polling] Health check OK')

        // Also check for pending files during polling
        await fetchPendingFiles()
      } catch (err) {
        consecutiveFailures++
        console.error(`[HTTP Polling] Health check failed (${consecutiveFailures}/${MAX_FAILURES}):`, err)

        if (consecutiveFailures >= MAX_FAILURES) {
          clearInterval(pollInterval)
          setConnectionState('error')
          setError('Connection lost after multiple failures')
        }
      }
    }, PING_INTERVAL)

    // Store interval for cleanup
    pingTimerRef.current = pollInterval
  }, [])

  /**
   * Internal function to establish WebSocket connection after verification
   * NOTE: HTTP polling fallback is DISABLED for debugging WebSocket issues
   */
  const establishWebSocket = useCallback((host: HostConfig, hostId: string) => {
    const url = buildWebSocketUrl(host)
    console.log('[WebSocket] ========== CONNECTION ATTEMPT ==========')
    console.log('[WebSocket] URL:', url)
    console.log('[WebSocket] Host:', host.host)
    console.log('[WebSocket] Port:', host.port)
    console.log('[WebSocket] Token (first 8 chars):', host.token?.slice(0, 8))
    console.log('[WebSocket] Is local network:', isLocalNetwork(host.host))

    // Connection timeout - just show error, no fallback
    const wsTimeout = setTimeout(() => {
      console.error('[WebSocket] Connection timeout after 10 seconds')
      console.error('[WebSocket] readyState:', wsRef.current?.readyState)
      if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
        setConnectionState('error')
        setError('WebSocket connection timeout - check server logs on desktop')
      }
    }, 10000)

    try {
      console.log('[WebSocket] Creating WebSocket object...')
      // Token passed via query string for Capacitor WebView compatibility
      const ws = new WebSocket(url)
      console.log('[WebSocket] WebSocket object created, readyState:', ws.readyState)

      ws.onopen = () => {
        clearTimeout(wsTimeout)
        console.log('[WebSocket] ========== CONNECTED! ==========')
        console.log('[WebSocket] readyState:', ws.readyState)
        console.log('[WebSocket] protocol:', ws.protocol)
        console.log('[WebSocket] extensions:', ws.extensions)
        setConnectionState('connected')
        setConnectionMethod('websocket')
        setError(null)
        setFingerprintWarning(null)
        reconnectAttemptRef.current = 0

        // Update last connected time
        setHosts(prev =>
          prev.map(h =>
            h.id === hostId
              ? { ...h, lastConnected: new Date() }
              : h
          )
        )

        // Start ping/pong keep-alive
        startPingPong()

        // Fetch pending files via HTTP (WebSocket may not send them immediately)
        const fetchPendingFilesHttp = async () => {
          try {
            const url = buildHttpUrl(host, '/api/files/pending')
            console.log('[WebSocket] Fetching pending files via HTTP:', url)
            const response = await fetch(url, {
              headers: { 'Authorization': `Bearer ${host.token}` }
            })
            if (response.ok) {
              const data = await response.json()
              if (data.files && Array.isArray(data.files)) {
                console.log('[WebSocket] Got pending files:', data.files.length)
                setPendingFiles(data.files as PendingFile[])
              }
            } else {
              console.error('[WebSocket] Pending files error:', response.status)
            }
          } catch (err) {
            console.error('[WebSocket] Failed to fetch pending files:', err)
          }
        }
        fetchPendingFilesHttp()
      }

      ws.onmessage = handleMessage

      ws.onerror = (event) => {
        clearTimeout(wsTimeout)
        // Log more details about the error
        console.error('[WebSocket] ========== ERROR ==========')
        console.error('[WebSocket] Error event type:', event.type)
        console.error('[WebSocket] Error event:', event)
        if (event.target) {
          const target = event.target as WebSocket
          console.error('[WebSocket] Target URL:', target.url)
          console.error('[WebSocket] Target readyState:', target.readyState)
          console.error('[WebSocket] Target protocol:', target.protocol)
        }
        console.error('[WebSocket] Full event object:', JSON.stringify(event, Object.getOwnPropertyNames(event)))

        // Show error to user - NO FALLBACK
        setConnectionState('error')
        setError('WebSocket error - check console logs for details')
        wsRef.current = null
      }

      ws.onclose = (event) => {
        clearTimeout(wsTimeout)
        clearTimers()
        console.log('[WebSocket] ========== CLOSED ==========')
        console.log('[WebSocket] Code:', event.code)
        console.log('[WebSocket] Reason:', event.reason)
        console.log('[WebSocket] Was clean:', event.wasClean)

        if (event.wasClean) {
          setConnectionState('disconnected')
        } else {
          // Show error - NO FALLBACK
          setConnectionState('error')
          setError(`WebSocket closed unexpectedly (code: ${event.code}, reason: ${event.reason || 'none'})`)
        }
      }

      wsRef.current = ws
    } catch (err) {
      clearTimeout(wsTimeout)
      console.error('[WebSocket] ========== EXCEPTION ==========')
      console.error('[WebSocket] Exception:', err)
      console.error('[WebSocket] Stack:', (err as Error).stack)
      setConnectionState('error')
      setError(`WebSocket exception: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [clearTimers, startPingPong, handleMessage])

  /**
   * Connect to a host
   * @param hostId The host ID to connect to
   * @param options Optional nonce/fingerprint/token for v2 connections
   */
  const connect = useCallback(async (hostId: string, options?: { nonce?: string; fingerprint?: string; token?: string; host?: string; port?: number }) => {
    let host = hosts.find(h => h.id === hostId)

    // Handle race condition: if host not found in state yet but we have enough info, construct it
    if (!host && options?.host && options?.port && options?.token) {
      host = {
        id: hostId,
        name: `${options.host}:${options.port}`,
        host: options.host,
        port: options.port,
        token: options.token
      }
    } else if (!host) {
      setError('Host not found')
      return
    } else if (options?.token) {
      // Apply token override if provided (handles race condition with updateHost)
      host = { ...host, token: options.token }
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    clearTimers()
    reconnectAttemptRef.current = 0
    pendingFingerprintRef.current = null
    setFingerprintWarning(null)

    setCurrentHost(host)
    setConnectionState('connecting')
    setError(null)

    console.log('[useHostConnection] Connecting to:', host.host, host.port, 'token:', host.token?.slice(0, 8))

    // If we have a nonce, try to verify the handshake (v2 flow)
    const nonce = options?.nonce || host.pendingNonce
    const expectedFingerprint = options?.fingerprint

    if (nonce) {
      setConnectionState('verifying')

      const result = await verifyHandshake(host, nonce as string)

      if (result.success && result.fingerprint) {
        const serverFingerprint = result.fingerprint

        // Check fingerprint (TOFU - Trust On First Use)
        if (host.fingerprint) {
          // We have a stored fingerprint - verify it matches
          if (host.fingerprint !== serverFingerprint) {
            // Fingerprint mismatch! This could be a MITM attack
            pendingFingerprintRef.current = { hostId, fingerprint: serverFingerprint }
            setFingerprintWarning(
              `WARNING: Server fingerprint has changed!\n` +
              `Expected: ${host.fingerprint}\n` +
              `Got: ${serverFingerprint}\n\n` +
              `This could indicate a man-in-the-middle attack, or the server was reinstalled.`
            )
            setConnectionState('error')
            return
          }
        } else if (expectedFingerprint) {
          // First connect with QR-provided fingerprint - verify it matches
          if (expectedFingerprint !== serverFingerprint) {
            setError('Fingerprint mismatch - QR code may have been tampered with')
            setConnectionState('error')
            return
          }
          // Store the fingerprint for future connections
          setHosts(prev =>
            prev.map(h =>
              h.id === hostId
                ? { ...h, fingerprint: serverFingerprint, pendingNonce: undefined }
                : h
            )
          )
        } else {
          // First connect without expected fingerprint - store it (TOFU)
          setHosts(prev =>
            prev.map(h =>
              h.id === hostId
                ? { ...h, fingerprint: serverFingerprint, pendingNonce: undefined }
                : h
            )
          )
        }
      } else {
        // Verification failed - log but continue (might be network issue)
        console.warn('Handshake verification failed:', result.error, '- proceeding anyway')
      }

      // Clear the nonce from host config
      setHosts(prev =>
        prev.map(h =>
          h.id === hostId
            ? { ...h, pendingNonce: undefined }
            : h
        )
      )
    }

    // Pre-connection test: verify token is valid before attempting WebSocket
    // This helps diagnose auth issues vs WebSocket issues
    console.log('[Connect] Testing token validity with /ws-test endpoint...')
    setConnectionState('connecting')

    try {
      const testUrl = buildHttpUrl(host, `/ws-test?token=${encodeURIComponent(host.token)}`)
      console.log('[Connect] Testing URL:', testUrl)
      const testResponse = await fetch(testUrl)
      const testData = await testResponse.json()
      console.log('[Connect] ws-test response:', testData)

      if (!testResponse.ok || !testData.ok) {
        console.error('[Connect] Token validation failed:', testData)
        setConnectionState('error')
        setError(`Token validation failed: ${testData.message || 'Invalid token'}`)
        return
      }
      console.log('[Connect] Token validated successfully, proceeding with WebSocket')
    } catch (testErr) {
      console.error('[Connect] Failed to reach server for token test:', testErr)
      setConnectionState('error')
      setError(`Cannot reach server: ${testErr instanceof Error ? testErr.message : String(testErr)}`)
      return
    }

    // Proceed with WebSocket connection
    establishWebSocket(host, hostId)
  }, [hosts, clearTimers, establishWebSocket])

  /**
   * Accept a changed fingerprint (user acknowledges the risk)
   */
  const acceptFingerprint = useCallback(() => {
    const pending = pendingFingerprintRef.current
    if (!pending) return

    // Store the new fingerprint
    setHosts(prev =>
      prev.map(h =>
        h.id === pending.hostId
          ? { ...h, fingerprint: pending.fingerprint }
          : h
      )
    )

    // Clear the warning and pending
    setFingerprintWarning(null)
    pendingFingerprintRef.current = null

    // Now connect
    const host = hosts.find(h => h.id === pending.hostId)
    if (host) {
      establishWebSocket(host, pending.hostId)
    }
  }, [hosts, establishWebSocket])

  /**
   * Disconnect from current host
   */
  const disconnect = useCallback(() => {
    clearTimers()
    reconnectAttemptRef.current = MAX_RECONNECT_ATTEMPTS // Prevent auto-reconnect

    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected')
      wsRef.current = null
    }

    setConnectionState('disconnected')
    setConnectionMethod('none')
    setCurrentHost(null)
    setError(null)
  }, [clearTimers])

  /**
   * Manually trigger reconnection
   */
  const reconnect = useCallback(() => {
    if (currentHost) {
      reconnectAttemptRef.current = 0
      connect(currentHost.id)
    }
  }, [currentHost, connect])

  /**
   * Add a new host
   */
  const addHost = useCallback((config: Omit<HostConfig, 'id'>): HostConfig => {
    const newHost: HostConfig = {
      ...config,
      id: generateId()
    }

    setHosts(prev => [...prev, newHost])
    return newHost
  }, [])

  /**
   * Remove a host
   */
  const removeHost = useCallback((id: string) => {
    // Disconnect if removing current host
    if (currentHost?.id === id) {
      disconnect()
    }

    setHosts(prev => prev.filter(h => h.id !== id))
  }, [currentHost, disconnect])

  /**
   * Update a host
   */
  const updateHost = useCallback((id: string, updates: Partial<Omit<HostConfig, 'id'>>) => {
    setHosts(prev =>
      prev.map(h =>
        h.id === id
          ? { ...h, ...updates }
          : h
      )
    )
  }, [])

  /**
   * Clear a pending file after download or dismissal
   */
  const clearPendingFile = useCallback((fileId: string) => {
    setPendingFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  /**
   * Clear all pending files
   */
  const clearAllPendingFiles = useCallback(() => {
    setPendingFiles([])
  }, [])

  return {
    // State
    hosts,
    currentHost,
    connectionState,
    connectionMethod,
    error,
    fingerprintWarning,
    pendingFiles,
    // Actions
    addHost,
    removeHost,
    updateHost,
    connect,
    disconnect,
    reconnect,
    acceptFingerprint,
    clearPendingFile,
    clearAllPendingFiles
  }
}

export default useHostConnection
