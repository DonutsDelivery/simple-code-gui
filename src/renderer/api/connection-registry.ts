import type { Api, ConnectionState, Unsubscribe } from './types'
import { HttpBackend } from './http-backend'
import type { ServerProtocolCapabilities, ServerProtocolDescriptor } from '../../common/server-protocol'

export interface ConnectionEndpoint {
  host: string
  port: number
  secure?: boolean
  certFingerprint?: string
}

export interface SavedServerConnection {
  serverId: string
  displayName: string
  endpoints: ConnectionEndpoint[]
  credentialRef: string
  lastSeenProtocolVersion: number
  capabilities: Array<keyof ServerProtocolCapabilities>
}

export interface ServerConnectionStatus {
  serverId: string
  state: ConnectionState
  endpoint?: ConnectionEndpoint
  latencyMs?: number
  platform?: ServerProtocolDescriptor['platform']
  serverVersion?: string
  error?: string
}

export interface ConnectionListener {
  (status: ServerConnectionStatus): void
}

export interface ConnectableApi extends Api {
  testConnection(): Promise<{ success: boolean; error?: string }>
  disconnect(): void
}

type ApiFactory = (endpoint: ConnectionEndpoint, credential: string) => ConnectableApi

type CredentialResolver = (credentialRef: string) => Promise<string> | string
const ENDPOINT_CONNECT_TIMEOUT_MS = 5_000

async function testEndpointWithTimeout(api: ConnectableApi): Promise<{ success: boolean; error?: string }> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      api.testConnection(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Connection attempt timed out')), ENDPOINT_CONNECT_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

interface LiveConnection {
  saved: SavedServerConnection
  api: ConnectableApi | null
  status: ServerConnectionStatus
  listeners: Set<ConnectionListener>
}

function supportedCapabilities(descriptor: ServerProtocolDescriptor): Array<keyof ServerProtocolCapabilities> {
  return (Object.keys(descriptor.capabilities) as Array<keyof ServerProtocolCapabilities>)
    .filter(capability => descriptor.capabilities[capability])
}

export class ConnectionRegistry {
  private readonly connections = new Map<string, LiveConnection>()

  constructor(
    private readonly resolveCredential: CredentialResolver,
    private readonly createApi: ApiFactory = (endpoint, token) => new HttpBackend({
      host: endpoint.host,
      port: endpoint.port,
      token,
      secure: endpoint.secure,
    }),
  ) {}

  register(saved: SavedServerConnection): void {
    const existing = this.connections.get(saved.serverId)
    this.connections.set(saved.serverId, {
      saved: structuredClone(saved),
      api: existing?.api || null,
      status: existing?.status || { serverId: saved.serverId, state: 'disconnected' },
      listeners: existing?.listeners || new Set(),
    })
  }

  list(): SavedServerConnection[] {
    return [...this.connections.values()].map(connection => structuredClone(connection.saved))
  }

  get(serverId: string): Api {
    const connection = this.connections.get(serverId)
    if (!connection?.api || connection.status.state !== 'connected') {
      throw new Error(`Server ${serverId} is not connected`)
    }
    return connection.api
  }

  getStatus(serverId: string): ServerConnectionStatus {
    const connection = this.requireConnection(serverId)
    return { ...connection.status }
  }

  async connect(serverId: string): Promise<void> {
    const connection = this.requireConnection(serverId)
    if (connection.status.state === 'connected') return
    this.updateStatus(connection, { serverId, state: 'connecting' })

    let lastError = 'No endpoints are configured'
    const credential = await this.resolveCredential(connection.saved.credentialRef)
    for (const endpoint of connection.saved.endpoints) {
      const api = this.createApi(endpoint, credential)
      const startedAt = performance.now()
      try {
        const result = await testEndpointWithTimeout(api)
        if (!result.success) throw new Error(result.error || 'Connection failed')
        const descriptor = api.getServerProtocol?.()
        if (!descriptor) throw new Error('Server did not publish its protocol descriptor')
        if (descriptor.serverId !== serverId) {
          throw new Error(`Server identity mismatch: expected ${serverId}, received ${descriptor.serverId}`)
        }
        connection.api = api
        // Prefer the route that just proved this pinned server identity. A stale
        // former LAN/Tailscale address should cost one bounded timeout, not one
        // timeout on every subsequent application launch.
        connection.saved.endpoints = [
          { ...endpoint },
          ...connection.saved.endpoints.filter(candidate =>
            candidate.host !== endpoint.host
            || candidate.port !== endpoint.port
            || candidate.secure !== endpoint.secure
          ),
        ]
        connection.saved.lastSeenProtocolVersion = descriptor.protocolVersion
        connection.saved.capabilities = supportedCapabilities(descriptor)
        this.updateStatus(connection, {
          serverId,
          state: 'connected',
          endpoint: { ...endpoint },
          latencyMs: Math.max(0, performance.now() - startedAt),
          platform: descriptor.platform,
          serverVersion: descriptor.serverVersion,
        })
        return
      } catch (error) {
        api.disconnect()
        lastError = error instanceof Error ? error.message : String(error)
      }
    }

    connection.api = null
    this.updateStatus(connection, { serverId, state: 'error', error: lastError })
    throw new Error(lastError)
  }

  async attach(serverId: string, api: ConnectableApi, endpoint: ConnectionEndpoint): Promise<void> {
    const connection = this.requireConnection(serverId)
    const startedAt = performance.now()
    let descriptor = api.getServerProtocol?.()
    if (!descriptor) {
      const result = await api.testConnection()
      if (!result.success) throw new Error(result.error || 'Connection failed')
      descriptor = api.getServerProtocol?.()
    }
    if (!descriptor) throw new Error('Server did not publish its protocol descriptor')
    if (descriptor.serverId !== serverId) {
      throw new Error(`Server identity mismatch: expected ${serverId}, received ${descriptor.serverId}`)
    }
    connection.api = api
    connection.saved.lastSeenProtocolVersion = descriptor.protocolVersion
    connection.saved.capabilities = supportedCapabilities(descriptor)
    this.updateStatus(connection, {
      serverId,
      state: 'connected',
      endpoint: { ...endpoint },
      latencyMs: Math.max(0, performance.now() - startedAt),
      platform: descriptor.platform,
      serverVersion: descriptor.serverVersion,
    })
  }

  disconnect(serverId: string): void {
    const connection = this.requireConnection(serverId)
    connection.api?.disconnect()
    connection.api = null
    this.updateStatus(connection, { serverId, state: 'disconnected' })
  }

  remove(serverId: string): void {
    const connection = this.requireConnection(serverId)
    connection.api?.disconnect()
    this.connections.delete(serverId)
  }

  rename(serverId: string, displayName: string): void {
    const connection = this.requireConnection(serverId)
    connection.saved.displayName = displayName.trim() || connection.saved.displayName
  }

  subscribe(serverId: string, listener: ConnectionListener): Unsubscribe {
    const connection = this.requireConnection(serverId)
    connection.listeners.add(listener)
    listener({ ...connection.status })
    return () => connection.listeners.delete(listener)
  }

  private requireConnection(serverId: string): LiveConnection {
    const connection = this.connections.get(serverId)
    if (!connection) throw new Error(`Unknown server ${serverId}`)
    return connection
  }

  private updateStatus(connection: LiveConnection, status: ServerConnectionStatus): void {
    connection.status = status
    for (const listener of connection.listeners) listener({ ...status })
  }
}
