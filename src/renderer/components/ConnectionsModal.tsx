import React, { useEffect, useMemo, useState } from 'react'
import { HttpBackend } from '../api/http-backend/http-backend.js'
import {
  attachRuntimeConnection,
  connectRuntimeServer,
  disconnectRuntimeServer,
  rememberRuntimeCredential,
  removeRuntimeServer,
  runtimeConnectionRegistry,
} from '../api/runtime-connections.js'
import { useConnectionsStore } from '../stores/connections.js'
import type { ServerConnectionStatus } from '../api/connection-registry.js'

export interface ConnectionsModalProps {
  activeServerId: string
  onClose: () => void
}

export function ConnectionsModal({ activeServerId, onClose }: ConnectionsModalProps): React.ReactElement {
  const { connections, addConnection, removeConnection, renameConnection, hydrate } = useConnectionsStore()
  const [statuses, setStatuses] = useState<Record<string, ServerConnectionStatus>>({})
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('38470')
  const [token, setToken] = useState('')
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

  const add = async (): Promise<void> => {
    const numericPort = Number(port)
    if (!host.trim() || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535 || !token) {
      setError('Enter a host, valid port, and token.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const endpoint = { host: host.trim(), port: numericPort }
      const api = new HttpBackend({ ...endpoint, token })
      const result = await api.testConnection()
      if (!result.success) throw new Error(result.error || 'Connection failed')
      const descriptor = api.getServerProtocol?.()
      if (!descriptor?.serverId) throw new Error('Server did not publish a stable identity')
      const saved = {
        serverId: descriptor.serverId,
        displayName: descriptor.serverName || descriptor.serverId,
        endpoints: [endpoint],
        credentialRef: `credential:${descriptor.serverId}`,
        lastSeenProtocolVersion: descriptor.protocolVersion,
        capabilities: descriptor.capabilities.map(capability => capability.id),
      }
      addConnection(saved)
      await attachRuntimeConnection(saved, api, endpoint, token)
      setToken('')
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
                  <input value={connection.displayName} onChange={event => renameConnection(connection.serverId, event.target.value)} />
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
                      const credential = window.prompt('Server token')
                      if (!credential) return
                      rememberRuntimeCredential(connection.credentialRef, credential)
                      void connectRuntimeServer(connection.serverId).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
                    }}>Reconnect</button>
                  )}
                  <button type="button" disabled={connection.serverId === activeServerId} onClick={() => {
                    removeRuntimeServer(connection.serverId)
                    removeConnection(connection.serverId)
                  }}>Remove</button>
                </div>
              </article>
            )
          })}
          <fieldset>
            <legend>Add server</legend>
            <label>Host<input value={host} onChange={event => setHost(event.target.value)} /></label>
            <label>Port<input inputMode="numeric" value={port} onChange={event => setPort(event.target.value)} /></label>
            <label>Token<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label>
            <button type="button" disabled={busy} onClick={() => void add()}>{busy ? 'Connecting…' : 'Add connection'}</button>
          </fieldset>
          {error && <div role="alert">{error}</div>}
        </div>
      </section>
    </div>
  )
}
