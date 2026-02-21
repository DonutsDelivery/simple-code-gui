/**
 * WebSocket Manager
 *
 * Handles WebSocket connections for real-time terminal streaming.
 */

import { HostConfig, buildWsUrl } from '../hostConfig.js'
import type {
  WsMessage,
  TerminalDataCallback,
  TerminalExitCallback
} from './types.js'

export class WebSocketManager {
  private ws: WebSocket | null = null
  private config: HostConfig
  private authenticated = false
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null

  // Callbacks
  private terminalDataCallbacks: Map<string, Set<(data: string) => void>> = new Map()
  private terminalExitCallbacks: Map<string, Set<(code: number) => void>> = new Map()
  private globalDataCallbacks: Set<TerminalDataCallback> = new Set()
  private globalExitCallbacks: Set<TerminalExitCallback> = new Set()
  private onConnectCallbacks: Set<() => void> = new Set()
  private onDisconnectCallbacks: Set<() => void> = new Set()

  // Pending messages while connecting
  private pendingMessages: WsMessage[] = []

  constructor(config: HostConfig) {
    this.config = config
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      const wsUrl = buildWsUrl(this.config)
      console.log('[WS] Connecting to:', wsUrl)

      try {
        this.ws = new WebSocket(wsUrl)
      } catch (error) {
        reject(error)
        return
      }

      const connectionTimeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          this.ws?.close()
          reject(new Error('WebSocket connection timeout'))
        }
      }, 10000)

      this.ws.onopen = () => {
        console.log('[WS] Connected, authenticating...')
        // Send auth message
        this.send({
          type: 'auth',
          payload: { token: this.config.token },
          timestamp: Date.now()
        })
      }

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WsMessage

          if (message.type === 'auth:success') {
            console.log('[WS] Authenticated successfully')
            clearTimeout(connectionTimeout)
            this.authenticated = true
            this.reconnectAttempts = 0
            this.startPingInterval()

            // Send pending messages
            for (const msg of this.pendingMessages) {
              this.send(msg)
            }
            this.pendingMessages = []

            // Notify connect callbacks
            for (const cb of this.onConnectCallbacks) {
              cb()
            }

            resolve()
          } else if (message.type === 'auth:failure') {
            clearTimeout(connectionTimeout)
            this.ws?.close()
            reject(new Error('Authentication failed'))
          } else {
            this.handleMessage(message)
          }
        } catch (error) {
          console.error('[WS] Failed to parse message:', error)
        }
      }

      this.ws.onclose = (event) => {
        console.log('[WS] Disconnected:', event.code, event.reason)
        clearTimeout(connectionTimeout)
        this.authenticated = false
        this.stopPingInterval()

        // Notify disconnect callbacks
        for (const cb of this.onDisconnectCallbacks) {
          cb()
        }

        // Attempt reconnection
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error)
      }
    })
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.stopPingInterval()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempts = this.maxReconnectAttempts // Prevent auto-reconnect
    this.ws?.close(1000, 'Client disconnect')
    this.ws = null
    this.authenticated = false
  }

  /**
   * Check if connected and authenticated
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated
  }

  /**
   * Send a message to the server
   */
  private send(message: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else if (!this.authenticated && message.type !== 'auth') {
      // Queue message for later
      this.pendingMessages.push(message)
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: WsMessage): void {
    switch (message.type) {
      case 'terminal:data':
        if (message.ptyId && message.payload) {
          const data = (message.payload as { data: string }).data

          // Call ptyId-specific callbacks
          const dataCallbacks = this.terminalDataCallbacks.get(message.ptyId)
          if (dataCallbacks) {
            for (const cb of dataCallbacks) {
              cb(data)
            }
          }

          // Call global callbacks
          for (const cb of this.globalDataCallbacks) {
            cb(message.ptyId, data)
          }
        }
        break

      case 'terminal:exit':
        if (message.ptyId && message.payload) {
          const code = (message.payload as { code: number }).code

          // Call ptyId-specific callbacks
          const exitCallbacks = this.terminalExitCallbacks.get(message.ptyId)
          if (exitCallbacks) {
            for (const cb of exitCallbacks) {
              cb(code)
            }
          }

          // Call global callbacks
          for (const cb of this.globalExitCallbacks) {
            cb(message.ptyId, code)
          }

          // Clean up callbacks for this ptyId
          this.terminalDataCallbacks.delete(message.ptyId)
          this.terminalExitCallbacks.delete(message.ptyId)
        }
        break

      case 'pong':
        // Server responded to ping
        break

      case 'error':
        console.error('[WS] Server error:', message.payload)
        break
    }
  }

  /**
   * Subscribe to a terminal
   */
  subscribeToTerminal(ptyId: string): void {
    this.send({
      type: 'ping', // Using ping as a carrier, action determines behavior
      action: 'subscribe',
      ptyId,
      timestamp: Date.now()
    } as WsMessage)
  }

  /**
   * Unsubscribe from a terminal
   */
  unsubscribeFromTerminal(ptyId: string): void {
    this.send({
      type: 'ping',
      action: 'unsubscribe',
      ptyId,
      timestamp: Date.now()
    } as WsMessage)
  }

  /**
   * Write to a terminal
   */
  writeTerminal(ptyId: string, data: string): void {
    this.send({
      type: 'terminal:write',
      ptyId,
      payload: { data },
      timestamp: Date.now()
    })
  }

  /**
   * Resize a terminal
   */
  resizeTerminal(ptyId: string, cols: number, rows: number): void {
    this.send({
      type: 'terminal:resize',
      ptyId,
      payload: { cols, rows },
      timestamp: Date.now()
    })
  }

  /**
   * Register callback for terminal data
   */
  onTerminalData(ptyId: string, callback: (data: string) => void): () => void {
    if (!this.terminalDataCallbacks.has(ptyId)) {
      this.terminalDataCallbacks.set(ptyId, new Set())
      // Subscribe to terminal when first callback is registered
      this.subscribeToTerminal(ptyId)
    }
    this.terminalDataCallbacks.get(ptyId)!.add(callback)

    return () => {
      const callbacks = this.terminalDataCallbacks.get(ptyId)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.terminalDataCallbacks.delete(ptyId)
          this.unsubscribeFromTerminal(ptyId)
        }
      }
    }
  }

  /**
   * Register callback for terminal exit
   */
  onTerminalExit(ptyId: string, callback: (code: number) => void): () => void {
    if (!this.terminalExitCallbacks.has(ptyId)) {
      this.terminalExitCallbacks.set(ptyId, new Set())
    }
    this.terminalExitCallbacks.get(ptyId)!.add(callback)

    return () => {
      const callbacks = this.terminalExitCallbacks.get(ptyId)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.terminalExitCallbacks.delete(ptyId)
        }
      }
    }
  }

  /**
   * Register global callback for all terminal data
   */
  onAnyTerminalData(callback: TerminalDataCallback): () => void {
    this.globalDataCallbacks.add(callback)
    return () => this.globalDataCallbacks.delete(callback)
  }

  /**
   * Register global callback for all terminal exits
   */
  onAnyTerminalExit(callback: TerminalExitCallback): () => void {
    this.globalExitCallbacks.add(callback)
    return () => this.globalExitCallbacks.delete(callback)
  }

  /**
   * Register callback for connection events
   */
  onConnect(callback: () => void): () => void {
    this.onConnectCallbacks.add(callback)
    return () => this.onConnectCallbacks.delete(callback)
  }

  /**
   * Register callback for disconnection events
   */
  onDisconnect(callback: () => void): () => void {
    this.onDisconnectCallbacks.add(callback)
    return () => this.onDisconnectCallbacks.delete(callback)
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts)
    console.log(`[WS] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectAttempts++
      this.connect().catch((error) => {
        console.error('[WS] Reconnect failed:', error)
      })
    }, delay)
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    this.stopPingInterval()
    this.pingTimer = setInterval(() => {
      this.send({
        type: 'ping',
        timestamp: Date.now()
      })
    }, 25000) // Ping every 25 seconds
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }
}
