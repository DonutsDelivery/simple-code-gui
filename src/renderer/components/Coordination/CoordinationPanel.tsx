import React, { useCallback, useEffect, useState } from 'react'
import type { CoordinationAssignment, CoordinationSnapshot } from '../../../common/coordination-protocol'
import type { Api } from '../../api'

interface CoordinationPanelProps {
  api: Api
  serverName?: string
  onClose?: () => void
}

const STATUS_COLOR: Record<CoordinationAssignment['status'], string> = {
  requested: '#f59e0b',
  acknowledged: '#2563eb',
  active: '#7c3aed',
  completed: '#15803d',
  cancelled: '#b91c1c',
}

export function CoordinationPanel({ api, serverName, onClose }: CoordinationPanelProps) {
  const [snapshot, setSnapshot] = useState<CoordinationSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!api.getCoordinationSnapshot) {
      setError('This server does not expose durable coordination.')
      return
    }
    try {
      setSnapshot(await api.getCoordinationSnapshot())
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load assignments')
    }
  }, [api])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 3000)
    return () => window.clearInterval(timer)
  }, [refresh])

  return (
    <section aria-label="Cross-server coordination" style={{ padding: 16, minWidth: 420, fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Coordination{serverName ? ` — ${serverName}` : ''}</h3>
        <div>
          <button onClick={() => void refresh()}>Refresh</button>
          {onClose && <button onClick={onClose} aria-label="Close coordination">×</button>}
        </div>
      </header>
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
      {!error && !snapshot && <p>Loading assignments…</p>}
      {snapshot && snapshot.assignments.length === 0 && <p>No durable assignments yet.</p>}
      {snapshot && snapshot.assignments.map(assignment => (
        <article key={assignment.assignmentId} style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: 10, marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong>{assignment.assignmentId}</strong>
            <span style={{ color: STATUS_COLOR[assignment.status] }}>{assignment.status}</span>
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            <div>Coordinator: <code>{assignment.coordinator.serverId}/{assignment.coordinator.agentSessionId}</code></div>
            <div>Worker: <code>{assignment.worker.serverId}/{assignment.worker.agentSessionId}</code></div>
            {assignment.repositoryRevision && <div>Revision: <code>{assignment.repositoryRevision}</code></div>}
            <div>Sequence: {assignment.lastSequence} · Messages: {assignment.messageIds.length}</div>
            {assignment.artifactIds.length > 0 && <div>Artifacts: {assignment.artifactIds.map(id => <code key={id} style={{ marginRight: 6 }}>{id}</code>)}</div>}
          </div>
        </article>
      ))}
    </section>
  )
}
