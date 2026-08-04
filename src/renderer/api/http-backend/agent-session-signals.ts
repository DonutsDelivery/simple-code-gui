import type { AgentSessionSignalMessage } from '../../../common/agent-session-signal'
import type {
  AgentSessionSignalCallback,
  Unsubscribe
} from '../types'
import { MAX_RECONNECT_ATTEMPTS, RECONNECT_DELAYS } from './constants'
import type { EnvironmentEvent } from '../../../common/environment-protocol.js'
import type { EventEnvelope } from '../../../common/server-protocol.js'
import type { Workspace } from '../types.js'

const HEARTBEAT_INTERVAL = 30_000
const HEARTBEAT_TIMEOUT = 10_000

export class AgentSessionSignalConnection {
  private listeners = new Set<AgentSessionSignalCallback>()
  private environmentListeners = new Set<(event: EventEnvelope<EnvironmentEvent<Workspace>>) => void>()
  private socket: WebSocket | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(
    private wsBaseUrl: string,
    private token: string,
  ) {}

  subscribe(callback: AgentSessionSignalCallback): Unsubscribe {
    this.listeners.add(callback)
    this.connect()

    return () => {
      this.listeners.delete(callback)
      if (this.listeners.size === 0 && this.environmentListeners.size === 0) this.disconnect()
    }
  }

  subscribeEnvironment(callback: (event: EventEnvelope<EnvironmentEvent<Workspace>>) => void): Unsubscribe {
    this.environmentListeners.add(callback)
    this.connect()
    return () => {
      this.environmentListeners.delete(callback)
      if (this.listeners.size === 0 && this.environmentListeners.size === 0) this.disconnect()
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopHeartbeat()
    if (
      this.socket
      && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      this.socket.close(1000, 'Client disconnecting')
    }
    this.socket = null
    this.reconnectAttempts = 0
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return
      if (this.heartbeatTimeout) return

      socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))
      this.heartbeatTimeout = setTimeout(() => {
        this.heartbeatTimeout = null
        if (this.socket === socket) socket.close(4000, 'Heartbeat timeout')
      }, HEARTBEAT_TIMEOUT)
    }, HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout)
      this.heartbeatTimeout = null
    }
  }

  private connect(): void {
    if (this.listeners.size === 0 && this.environmentListeners.size === 0) return
    if (
      this.socket
      && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    const url = `${this.wsBaseUrl}/ws?token=${encodeURIComponent(this.token)}`
    const socket = new WebSocket(url)
    this.socket = socket

    socket.onopen = () => {
      this.reconnectAttempts = 0
      this.startHeartbeat(socket)
    }

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as {
          type?: string
          signal?: AgentSessionSignalMessage['signal']
          event?: EventEnvelope<EnvironmentEvent<Workspace>>
        }
        if (message.type === 'pong') {
          if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout)
          this.heartbeatTimeout = null
          return
        }
        if (message.type === 'agent-session-signal' && message.signal) {
          for (const listener of this.listeners) listener(message.signal)
        } else if (message.type === 'environment-event' && message.event) {
          for (const listener of this.environmentListeners) listener(message.event)
        }
      } catch {
        // Ignore malformed messages from the shared event socket.
      }
    }

    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.socket = null
      this.stopHeartbeat()
      if (
        event.code === 1000
        || (this.listeners.size === 0 && this.environmentListeners.size === 0)
        || this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS
      ) {
        return
      }

      const delay = RECONNECT_DELAYS[
        Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)
      ]
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.reconnectAttempts += 1
        this.connect()
      }, delay)
    }
  }
}
