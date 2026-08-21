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
import { ArtifactPanel } from './Artifacts/ArtifactPanel.js'
import { CoordinationPanel } from './Coordination/CoordinationPanel.js'

export interface ConnectionsModalProps {
  activeServerId: string
  onClose: () => void
  onOpenHostPairing?: () => void
}

export function ConnectionsModal({ activeServerId, onClose, onOpenHostPairing }: ConnectionsModalProps): React.ReactElement {
  const { connections, upsert, remove, rename, hydrate } = useConnectionsStore()
  const [statuses, setStatuses] = useState<Record<string, ServerConnectionStatus>>({})
  const [pairing, setPairing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [serverTool, setServerTool] = useState<{ serverId: string; kind: 'artifacts' | 'coordination' } | null>(null)

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
      const endpointFromUrl = (url: URL) => ({
        host: url.hostname,
        port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
        secure: url.protocol === 'https:',
        certFingerprint: result.fingerprint,
      })
      const endpoint = endpointFromUrl(result.endpoint)
      const endpoints = [result.endpoint.toString(), ...result.endpointHints]
        .map(value => endpointFromUrl(new URL(value)))
        .filter((candidate, index, all) => all.findIndex(other =>
          other.host === candidate.host && other.port === candidate.port && other.secure === candidate.secure) === index)
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
        endpoints,
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
          <div className="connections-intro">
            <div className="connections-intro__icon" aria-hidden="true">⌁</div>
            <div><strong>Connected environments</strong><span>Projects and workspaces stay on their owning machine and synchronize here.</span></div>
          </div>
          {ordered.map(connection => {
            const status = statuses[connection.serverId] ?? { serverId: connection.serverId, state: 'disconnected' as const }
            const endpoint = connection.endpoints[0]
            return (
              <article className="connection-card" key={connection.serverId}>
                <div className="connection-card__heading">
                  <span className={`connection-status-dot connection-status-dot--${status.state}`} aria-hidden="true" />
                  <label>Server name<input value={connection.displayName} onChange={event => { void rename(connection.serverId, event.target.value) }} /></label>
                  <span className="connection-state-label"><strong>{status.state}</strong>{connection.serverId === activeServerId ? ' · active' : ''}</span>
                </div>
                <div className="connection-card__meta"><span>{endpoint?.host}:{endpoint?.port}</span><span>{status.platform || 'unknown platform'} · {status.serverVersion || 'unknown version'}{status.latencyMs !== undefined ? ` · ${Math.round(status.latencyMs)} ms` : ''}</span></div>
                <div className="connection-capabilities">{connection.capabilities.join(', ') || 'No advertised capabilities'}</div>
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
                  {status.state === 'connected' && <button type="button" onClick={() => setServerTool({ serverId: connection.serverId, kind: 'artifacts' })}>Artifacts</button>}
                  {status.state === 'connected' && <button type="button" onClick={() => setServerTool({ serverId: connection.serverId, kind: 'coordination' })}>Coordination</button>}
                </div>
              </article>
            )
          })}
          {pairing
            ? <PairServerDialog onCancel={() => setPairing(false)} onPaired={paired} />
            : (
                <div className="connection-entry-actions">
                  <button type="button" disabled={busy} onClick={() => setPairing(true)}><span aria-hidden="true">↗</span><strong>Pair Server</strong><small>Connect this frontend to another backend</small></button>
                  {onOpenHostPairing && <button type="button" onClick={onOpenHostPairing}><span aria-hidden="true">⌁</span><strong>Share This Device</strong><small>Approve access to this machine</small></button>}
                </div>
              )}
          {error && <div role="alert">{error}</div>}
          {serverTool && (() => {
            const api = runtimeConnectionRegistry.get(serverTool.serverId)
            const name = connections.find(connection => connection.serverId === serverTool.serverId)?.displayName
            return serverTool.kind === 'artifacts'
              ? <ArtifactPanel api={api} serverName={name} onClose={() => setServerTool(null)} />
              : <CoordinationPanel api={api} serverName={name} onClose={() => setServerTool(null)} />
          })()}
        </div>
      </section>
    </div>
  )
}
