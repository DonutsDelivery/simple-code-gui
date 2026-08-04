import { Preferences } from '@capacitor/preferences'
import { create } from 'zustand'
import type { SavedServerConnection, ServerConnectionStatus } from '../api/connection-registry'

const CONNECTIONS_STORAGE_KEY = 'donutcode-server-connections-v1'

interface ConnectionsState {
  connections: SavedServerConnection[]
  statuses: Record<string, ServerConnectionStatus>
  hydrated: boolean
  hydrate: () => Promise<void>
  upsert: (connection: SavedServerConnection) => Promise<void>
  remove: (serverId: string) => Promise<void>
  rename: (serverId: string, displayName: string) => Promise<void>
  setStatus: (status: ServerConnectionStatus) => void
}

async function persist(connections: SavedServerConnection[]): Promise<void> {
  await Preferences.set({
    key: CONNECTIONS_STORAGE_KEY,
    value: JSON.stringify(connections),
  })
}

function normalizeConnection(value: unknown): SavedServerConnection | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<SavedServerConnection>
  if (!candidate.serverId || !candidate.displayName || !Array.isArray(candidate.endpoints)) return null
  const endpoints = candidate.endpoints.filter(endpoint =>
    endpoint
    && typeof endpoint.host === 'string'
    && endpoint.host.trim().length > 0
    && Number.isInteger(endpoint.port)
    && endpoint.port > 0
    && endpoint.port <= 65535
  )
  if (endpoints.length === 0) return null
  return {
    serverId: candidate.serverId,
    displayName: candidate.displayName,
    endpoints,
    credentialRef: candidate.credentialRef || '',
    lastSeenProtocolVersion: candidate.lastSeenProtocolVersion || 0,
    capabilities: Array.isArray(candidate.capabilities) ? candidate.capabilities : [],
  }
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],
  statuses: {},
  hydrated: false,

  hydrate: async () => {
    const { value } = await Preferences.get({ key: CONNECTIONS_STORAGE_KEY })
    let connections: SavedServerConnection[] = []
    if (value) {
      try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) {
          connections = parsed
            .map(normalizeConnection)
            .filter((connection): connection is SavedServerConnection => connection !== null)
        }
      } catch (error) {
        console.warn('[Connections] Ignoring invalid saved connection data:', error)
      }
    }
    set({ connections, hydrated: true })
  },

  upsert: async connection => {
    const normalized = normalizeConnection(connection)
    if (!normalized) throw new Error('Invalid server connection')
    const connections = [...get().connections]
    const index = connections.findIndex(item => item.serverId === normalized.serverId)
    if (index >= 0) connections[index] = normalized
    else connections.push(normalized)
    set({ connections })
    await persist(connections)
  },

  remove: async serverId => {
    const connections = get().connections.filter(connection => connection.serverId !== serverId)
    const statuses = { ...get().statuses }
    delete statuses[serverId]
    set({ connections, statuses })
    await persist(connections)
  },

  rename: async (serverId, displayName) => {
    const name = displayName.trim()
    if (!name) return
    const connections = get().connections.map(connection =>
      connection.serverId === serverId ? { ...connection, displayName: name } : connection
    )
    set({ connections })
    await persist(connections)
  },

  setStatus: status => {
    set({ statuses: { ...get().statuses, [status.serverId]: { ...status } } })
  },
}))
