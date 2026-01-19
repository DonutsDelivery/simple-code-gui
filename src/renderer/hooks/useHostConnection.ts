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
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface HostConnectionState {
  hosts: HostConfig[]
  currentHost: HostConfig | null
  connectionState: ConnectionState
  error: string | null
}

export interface HostConnectionActions {
  addHost: (config: Omit<HostConfig, 'id'>) => HostConfig
  removeHost: (id: string) => void
  updateHost: (id: string, updates: Partial<Omit<HostConfig, 'id'>>) => void
  connect: (hostId: string) => void
  disconnect: () => void
  reconnect: () => void
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
 * Build WebSocket URL from host config
 */
function buildWebSocketUrl(host: HostConfig): string {
  // Use wss:// for secure connection, ws:// for local development
  const protocol = host.host === 'localhost' || host.host.startsWith('192.168.') ? 'ws' : 'wss'
  return `${protocol}://${host.host}:${host.port}/ws?token=${encodeURIComponent(host.token)}`
}

// ============================================
// Hook Implementation
// ============================================

export function useHostConnection(): UseHostConnectionReturn {
  // State
  const [hosts, setHosts] = useState<HostConfig[]>(loadHosts)
  const [currentHost, setCurrentHost] = useState<HostConfig | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [error, setError] = useState<string | null>(null)

  // Refs for WebSocket management
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

      // Other message types can be handled here or by listeners
      console.log('WebSocket message:', data)
    } catch {
      // Handle non-JSON messages
      console.log('WebSocket raw message:', event.data)
    }
  }, [])

  /**
   * Connect to a host
   */
  const connect = useCallback((hostId: string) => {
    const host = hosts.find(h => h.id === hostId)
    if (!host) {
      setError('Host not found')
      return
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    clearTimers()
    reconnectAttemptRef.current = 0

    setCurrentHost(host)
    setConnectionState('connecting')
    setError(null)

    const url = buildWebSocketUrl(host)

    try {
      const ws = new WebSocket(url)

      ws.onopen = () => {
        setConnectionState('connected')
        setError(null)
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
      }

      ws.onmessage = handleMessage

      ws.onerror = (event) => {
        console.error('WebSocket error:', event)
        setError('Connection error')
        setConnectionState('error')
      }

      ws.onclose = (event) => {
        clearTimers()

        if (event.wasClean) {
          setConnectionState('disconnected')
        } else {
          setConnectionState('error')
          setError(`Connection lost (code: ${event.code})`)

          // Attempt reconnection
          if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
            const delay = RECONNECT_DELAYS[Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1)]
            reconnectAttemptRef.current++

            console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})...`)

            reconnectTimerRef.current = setTimeout(() => {
              if (currentHost) {
                connect(currentHost.id)
              }
            }, delay)
          } else {
            setError('Max reconnection attempts reached')
          }
        }
      }

      wsRef.current = ws
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect'
      setError(message)
      setConnectionState('error')
    }
  }, [hosts, clearTimers, startPingPong, handleMessage, currentHost])

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

  return {
    // State
    hosts,
    currentHost,
    connectionState,
    error,
    // Actions
    addHost,
    removeHost,
    updateHost,
    connect,
    disconnect,
    reconnect
  }
}

export default useHostConnection
