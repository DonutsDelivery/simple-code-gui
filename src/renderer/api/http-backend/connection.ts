/**
 * Connection State Management
 *
 * Manages connection state and provides HTTP fetch helpers for the HTTP backend.
 */

import { ConnectionState, Unsubscribe } from '../types'

export class ConnectionManager {
  private connectionState: ConnectionState = 'disconnected'
  private stateListeners: Set<(state: ConnectionState) => void> = new Set()
  private connectionError: string | null = null
  private baseUrl: string
  private token: string

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl
    this.token = token
  }

  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  getConnectionError(): string | null {
    return this.connectionError
  }

  onConnectionStateChange(callback: (state: ConnectionState) => void): Unsubscribe {
    this.stateListeners.add(callback)
    return () => {
      this.stateListeners.delete(callback)
    }
  }

  setConnectionState(state: ConnectionState, error?: string): void {
    this.connectionState = state
    this.connectionError = error || null
    this.stateListeners.forEach((cb) => cb(state))
  }

  /**
   * Make an authenticated HTTP request
   */
  async fetch(path: string, options?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...options?.headers
        }
      })

      // Update connection state on successful request
      if (this.connectionState !== 'connected') {
        this.setConnectionState('connected')
      }

      return response
    } catch (error) {
      // Network error - connection lost
      this.setConnectionState('error', error instanceof Error ? error.message : 'Network error')
      throw error
    }
  }

  /**
   * Make an authenticated HTTP request and parse JSON response
   */
  async fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await this.fetch(path, options)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `HTTP ${response.status}`)
    }

    return response.json()
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  getToken(): string {
    return this.token
  }
}
