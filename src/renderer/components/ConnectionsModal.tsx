import React, { useEffect, useMemo, useState } from 'react'
import { HttpBackend } from '../api/http-backend/http-backend.js'
import {
  attachRuntimeConnection,
  connectRuntimeServer,
  disconnectRuntimeServer,
  removeRuntimeServer,
  runtimeConnectionRegistry,
} from '../api/runtime-connections.js'
import { useConnectionsStore } from '../stores/connections.js'
import type { ServerConnectionStatus } from '../api/connection-registry.js'
import { PairServerDialog, type PairedServerResult } from './Connections/PairServerDialog.js'

export interface ConnectionsModalProps {
  activeServerId: string
  onClose: () => void
}

export function ConnectionsModal({ activeServerId, onClose }: ConnectionsModalProps): React.ReactElement {
  const { connections, upsert, remove, rename, hydrate } = useConnectionsStore()
  const [statuses, setStatuses] = useState<Record<string, ServerConnectionStatus>>({})
  const [pairing, setPairing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { void hydrate() }, [hydrate])
  useEffect(() => {
    const unsubs = connections.flatMap(connection => {
      try {
        runtimeConnectionRegistry.register(connection)
        return [runtimeConnectionRegistry.subscribe(connection.serverId, status =>
          setStatuses(current => ({ ...current, [connection.serverId]: status })))]
      } catch {
        return []
      }
    })
    return () => unsubs.forEach(unsubscribe => unsubscribe())
  }, [connections])

  const ordered = useMemo(() => [...connections].sort((a, b) => a.displayName.localeCompare(b.displayName)), [connections])

  const paired = async (result: PairedServerResult): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const endpoint = {
        host: result.endpoint.hostname,
        port: Number(result.endpoint.port) || (result.endpoint.protocol === 'https:' ? 443 : 80),
        secure: result.endpoint.protocol === 'https:',
        certFingerprint: result.fingerprint,
      }
      const api = new HttpBackend({ ...endpoint, token: result.deviceCredential })
      const connectionTest = await api.testConnection()
      if (!connectionTest.success) throw new Error(connectionTest.error || 'Connection failed')
      const descriptor = api.getServerProtocol?.()
      if (!descriptor?.serverId) throw new Error('Server did not publish a stable identity')
      if (descriptor.serverId !== result.serverId) throw new Error('Paired Server identity did not match the connected endpoint')
      const capabilities = (Object.keys(descriptor.capabilities) as Array<keyof typeof descriptor.capabilities>)
        .filter(capability => descriptor.capabilities[capability])
      const saved = {
        serverId: descriptor.serverId,
        displayName: descriptor.serverId,
        endpoints: [endpoint],
        credentialRef: `credential:${descriptor.serverId}`,
        lastSeenProtocolVersion: descriptor.protocolVersion,
        capabilities,
      }
      await upsert(saved)
      await attachRuntimeConnection(saved, api, endpoint, result.deviceCredential)
      setPairing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="settings-modal connections-modal" role="dialog" aria-modal="true" aria-labelledby="connections-title">
        <header className="settings-header">
          <h2 id="connections-title">Connections</h2>
          <button type="button" onClick={onClose} aria-label="Close connections">×</button>
        </header>
        <div className="settings-content">
          {ordered.map(connection => {
            const status = statuses[connection.serverId] ?? { serverId: connection.serverId, state: 'disconnected' as const }
            const endpoint = connection.endpoints[0]
            return (
              <article className="connection-card" key={connection.serverId}>
                <label>
                  Server name
                  <input value={connection.displayName} onChange={event => { void rename(connection.serverId, event.target.value) }} />
                </label>
                <div><strong>{status.state}</strong>{connection.serverId === activeServerId ? ' · active' : ''}</div>
                <div>{endpoint?.host}:{endpoint?.port}</div>
                <div>{status.platform || 'unknown platform'} · {status.serverVersion || 'unknown version'}{status.latencyMs !== undefined ? ` · ${Math.round(status.latencyMs)} ms` : ''}</div>
                <div>{connection.capabilities.join(', ') || 'No advertised capabilities'}</div>
                {status.error && <div role="alert">{status.error}</div>}
                <div className="connection-actions">
                  {status.state === 'connected' ? (
                    <button type="button" onClick={() => disconnectRuntimeServer(connection.serverId)}>Disconnect</button>
                  ) : (
                    <button type="button" onClick={() => {
                      void connectRuntimeServer(connection.serverId).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
                    }}>Reconnect</button>
                  )}
                  <button type="button" disabled={connection.serverId === activeServerId} onClick={() => {
                    removeRuntimeServer(connection.serverId)
                    void remove(connection.serverId)
                  }}>Remove</button>
                </div>
              </article>
            )
          })}
          {pairing
            ? <PairServerDialog onCancel={() => setPairing(false)} onPaired={paired} />
            : <button type="button" disabled={busy} onClick={() => setPairing(true)}>Pair Server</button>}
          {error && <div role="alert">{error}</div>}
        </div>
      </section>
    </div>
  )
}
