import { HttpBackend } from './http-backend/http-backend.js'
import { ConnectionRegistry, type ConnectableApi, type ConnectionEndpoint, type SavedServerConnection } from './connection-registry.js'
import type { Api } from './types.js'
import { clearApi, setApi } from './index.js'
import { getEnvironmentCursor, loadAuthoritativeWorkspace, resolveAuthoritativeEnvironmentEvent } from '../stores/workspace-persistence.js'
import { useWorkspaceStore } from '../stores/workspace.js'
import { loadDeviceCredential, removeDeviceCredential, storeDeviceCredential } from '../security/device-credentials.js'
import { trustServerEndpoint } from '../security/server-certificate-trust.js'
import { useConnectionsStore } from '../stores/connections.js'

const credentials = new Map<string, string>()
const authoritySubscriptions = new Map<string, () => void>()

export function subscribeAuthorityProjection(serverId: string, api: Api): () => void {
  authoritySubscriptions.get(serverId)?.()
  let polling = false
  const synchronizeLatest = async (): Promise<void> => {
    if (polling || !api.getEnvironmentSnapshot) return
    polling = true
    try {
      const snapshot = await api.getEnvironmentSnapshot()
      if (snapshot.serverId !== serverId) throw new Error(`Environment snapshot returned server ${snapshot.serverId}; expected ${serverId}`)
      if (snapshot.revision > (getEnvironmentCursor(serverId)?.revision ?? -1)) {
        const workspace = await loadAuthoritativeWorkspace(api, serverId)
        useWorkspaceStore.getState().applyAuthoritativeWorkspace(serverId, workspace)
      }
    } catch (error) {
      console.warn(`Failed to poll server ${serverId}:`, error)
    } finally {
      polling = false
    }
  }
  const unsubscribeEvent = api.onEnvironmentEvent?.(event => {
    void resolveAuthoritativeEnvironmentEvent(api, serverId, event)
      .then(next => {
        if (next) useWorkspaceStore.getState().applyAuthoritativeWorkspace(serverId, next.workspace)
      })
      .catch(error => console.error(`Failed to synchronize server ${serverId}:`, error))
  }) ?? (() => {})
  // IPC events cover local renderer mutations and websocket events cover remote
  // connections, but another frontend can mutate the local authority through
  // HTTP without producing an IPC event. Revision polling closes that gap.
  const pollTimer = window.setInterval(() => { void synchronizeLatest() }, 2_500)
  const unsubscribe = (): void => {
    window.clearInterval(pollTimer)
    unsubscribeEvent()
  }
  authoritySubscriptions.set(serverId, unsubscribe)
  return () => {
    if (authoritySubscriptions.get(serverId) === unsubscribe) {
      authoritySubscriptions.delete(serverId)
    }
    unsubscribe()
  }
}

async function activateAuthorityProjection(serverId: string, api: Api): Promise<void> {
  const workspace = await loadAuthoritativeWorkspace(api, serverId)
  useWorkspaceStore.getState().applyAuthoritativeWorkspace(serverId, workspace)
  subscribeAuthorityProjection(serverId, api)
}

export const runtimeConnectionRegistry = new ConnectionRegistry(
  async credentialRef => {
    const credential = credentials.get(credentialRef) ?? await loadDeviceCredential(credentialRef)
    if (credential == null) throw new Error(`Credential ${credentialRef} is unavailable`)
    return credential
  },
  (endpoint, token) => new HttpBackend({ host: endpoint.host, port: endpoint.port, token, secure: endpoint.secure }),
)

export async function rememberRuntimeCredential(credentialRef: string, token: string): Promise<void> {
  credentials.set(credentialRef, token)
  await storeDeviceCredential(credentialRef, token)
}

export async function attachRuntimeConnection(
  saved: SavedServerConnection,
  api: Api,
  endpoint: ConnectionEndpoint,
  token?: string,
): Promise<void> {
  runtimeConnectionRegistry.register(saved)
  if (token !== undefined) await rememberRuntimeCredential(saved.credentialRef, token)
  await runtimeConnectionRegistry.attach(saved.serverId, api as ConnectableApi, endpoint)
  setApi(api)
  await activateAuthorityProjection(saved.serverId, api)
}

export async function connectRuntimeServer(serverId: string): Promise<Api> {
  const saved = runtimeConnectionRegistry.list().find(connection => connection.serverId === serverId)
  if (saved) {
    await Promise.all(saved.endpoints.filter(endpoint => endpoint.secure).map(endpoint =>
      trustServerEndpoint(`https://${endpoint.host}:${endpoint.port}`, endpoint.certFingerprint || ''),
    ))
  }
  await runtimeConnectionRegistry.connect(serverId)
  const refreshed = runtimeConnectionRegistry.list().find(connection => connection.serverId === serverId)
  if (refreshed) await useConnectionsStore.getState().upsert(refreshed)
  const api = runtimeConnectionRegistry.get(serverId)
  setApi(api)
  await activateAuthorityProjection(serverId, api)
  return api
}

export function disconnectRuntimeServer(serverId: string): void {
  authoritySubscriptions.get(serverId)?.()
  authoritySubscriptions.delete(serverId)
  runtimeConnectionRegistry.disconnect(serverId)
  clearApi(serverId)
}

export function removeRuntimeServer(serverId: string): void {
  authoritySubscriptions.get(serverId)?.()
  authoritySubscriptions.delete(serverId)
  runtimeConnectionRegistry.remove(serverId)
  credentials.delete(`credential:${serverId}`)
  void removeDeviceCredential(`credential:${serverId}`)
  useWorkspaceStore.getState().removeServerProjection(serverId)
  clearApi(serverId)
}
