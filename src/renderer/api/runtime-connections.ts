import { HttpBackend } from './http-backend/http-backend.js'
import { ConnectionRegistry, type ConnectableApi, type ConnectionEndpoint, type SavedServerConnection } from './connection-registry.js'
import type { Api } from './types.js'
import { clearApi, setApi } from './index.js'
import { loadAuthoritativeWorkspace, resolveAuthoritativeEnvironmentEvent } from '../stores/workspace-persistence.js'
import { useWorkspaceStore } from '../stores/workspace.js'
import { loadDeviceCredential, removeDeviceCredential, storeDeviceCredential } from '../security/device-credentials.js'
import { trustServerEndpoint } from '../security/server-certificate-trust.js'

const credentials = new Map<string, string>()
const authoritySubscriptions = new Map<string, () => void>()

async function activateAuthorityProjection(serverId: string, api: Api): Promise<void> {
  const workspace = await loadAuthoritativeWorkspace(api, serverId)
  useWorkspaceStore.getState().applyAuthoritativeWorkspace(serverId, workspace)
  authoritySubscriptions.get(serverId)?.()
  if (!api.onEnvironmentEvent) return
  authoritySubscriptions.set(serverId, api.onEnvironmentEvent(event => {
    void resolveAuthoritativeEnvironmentEvent(api, serverId, event)
      .then(next => {
        if (next) useWorkspaceStore.getState().applyAuthoritativeWorkspace(serverId, next.workspace)
      })
      .catch(error => console.error(`Failed to synchronize server ${serverId}:`, error))
  }))
}

export const runtimeConnectionRegistry = new ConnectionRegistry(
  async credentialRef => {
    const credential = credentials.get(credentialRef) ?? await loadDeviceCredential(credentialRef)
    if (credential === undefined) throw new Error(`Credential ${credentialRef} is unavailable`)
    return credential
  },
  (endpoint, token) => new HttpBackend({ host: endpoint.host, port: endpoint.port, token, secure: endpoint.secure }),
)

export function rememberRuntimeCredential(credentialRef: string, token: string): void {
  credentials.set(credentialRef, token)
  void storeDeviceCredential(credentialRef, token)
}

export async function attachRuntimeConnection(
  saved: SavedServerConnection,
  api: Api,
  endpoint: ConnectionEndpoint,
  token?: string,
): Promise<void> {
  runtimeConnectionRegistry.register(saved)
  if (token !== undefined) rememberRuntimeCredential(saved.credentialRef, token)
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
  clearApi(serverId)
}
