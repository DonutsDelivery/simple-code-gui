import React, { useState, useEffect, useCallback } from 'react'
import type { Api } from '../../api'
import type { ArtifactManifest, ArtifactKind } from '../../../common/artifacts'

/**
 * Checkpoint 11 — Artifact panel.
 *
 * Lists content-addressed artifacts on the connected server, filtered by kind,
 * with inspect/download/expire actions. The renderer brokers metadata only:
 * download returns a blob URL the user can save; bytes are never auto-run.
 */
interface ArtifactPanelProps {
  api: Api
  serverName?: string
  onClose?: () => void
}

const KIND_LABELS: Record<ArtifactKind, string> = {
  source: 'Source',
  package: 'Package',
  log: 'Log',
  screenshot: 'Screenshot',
  'test-report': 'Test report',
  cache: 'Cache',
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString()
}

function shortHash(hash: string | undefined, length = 12): string {
  return hash ? hash.slice(0, length) : '—'
}

export function ArtifactPanel({ api, serverName, onClose }: ArtifactPanelProps) {
  const [artifacts, setArtifacts] = useState<ArtifactManifest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | ArtifactKind>('all')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [expiring, setExpiring] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const listArtifacts = api.listArtifacts

  const refresh = useCallback(async () => {
    if (!listArtifacts) {
      setError('This connection does not expose an artifact store.')
      setLoading(false)
      return
    }
    try {
      const items = await listArtifacts(kindFilter === 'all' ? undefined : { kind: kindFilter })
      setArtifacts(items)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to list artifacts')
    } finally {
      setLoading(false)
    }
  }, [listArtifacts, kindFilter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleDownload = async (artifact: ArtifactManifest) => {
    if (!api.downloadArtifact) return
    setDownloading(artifact.artifactId)
    setNotice(null)
    try {
      const result = await api.downloadArtifact(artifact.artifactId)
      if (!result) {
        setNotice(`Download failed for ${artifact.filename}`)
        return
      }
      const link = document.createElement('a')
      link.href = result.filePath
      link.download = artifact.filename
      link.click()
      setNotice(`Downloaded ${artifact.filename} (sha256 ${shortHash(result.sha256, 16)})`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(null)
    }
  }

  const handleExpire = async (artifact: ArtifactManifest) => {
    if (!api.expireArtifact) return
    setExpiring(artifact.artifactId)
    try {
      await api.expireArtifact(artifact.artifactId)
      setArtifacts(current => current.filter(item => item.artifactId !== artifact.artifactId))
      setNotice(`Expired ${artifact.filename}`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Expire failed')
    } finally {
      setExpiring(null)
    }
  }

  const filterable = artifacts.length > 0 || kindFilter !== 'all'
  const kinds: ArtifactKind[] = (Object.keys(KIND_LABELS) as ArtifactKind[]).filter(kind =>
    artifacts.some(artifact => artifact.kind === kind) || kindFilter === kind
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 420, maxWidth: 640, padding: 16, fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Artifacts{serverName ? ` — ${serverName}` : ''}</h3>
        {onClose && <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}>×</button>}
      </div>

      {filterable && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setKindFilter('all')}
            style={{ ...pillStyle, ...(kindFilter === 'all' ? pillActive : {}) }}
          >
            All
          </button>
          {kinds.map(kind => (
            <button
              key={kind}
              onClick={() => setKindFilter(kind)}
              style={{ ...pillStyle, ...(kindFilter === kind ? pillActive : {}) }}
            >
              {KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      )}

      {error && <div style={{ color: '#c0392b' }}>{error}</div>}
      {notice && <div style={{ color: '#2e7d32', fontSize: 12 }}>{notice}</div>}

      {loading ? (
        <div>Loading artifacts…</div>
      ) : artifacts.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No artifacts{kindFilter !== 'all' ? ` of kind ${KIND_LABELS[kindFilter]}` : ''} yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {artifacts.map(artifact => (
            <li key={artifact.artifactId} style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{artifact.filename}</div>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#eceff1' }}>
                  {KIND_LABELS[artifact.kind] ?? artifact.kind}
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: '#555', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div>{formatBytes(artifact.size)} · {artifact.platform}/{artifact.architecture} · {formatTime(artifact.createdAt)}</div>
                <div>sha256 <code>{shortHash(artifact.sha256, 16)}</code>…</div>
                {artifact.repositoryId && (
                  <div>
                    repo <code>{shortHash(artifact.repositoryId, 12)}</code>
                    {artifact.commit ? <> · commit <code>{shortHash(artifact.commit, 10)}</code></> : null}
                    {artifact.tree ? <> · tree <code>{shortHash(artifact.tree, 10)}</code></> : null}
                  </div>
                )}
                {artifact.buildCommand && <div style={{ fontStyle: 'italic' }}>{artifact.buildCommand}</div>}
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                {api.downloadArtifact && (
                  <button
                    onClick={() => void handleDownload(artifact)}
                    disabled={downloading === artifact.artifactId}
                    style={actionStyle}
                  >
                    {downloading === artifact.artifactId ? 'Downloading…' : 'Download'}
                  </button>
                )}
                {api.expireArtifact && (
                  <button
                    onClick={() => void handleExpire(artifact)}
                    disabled={expiring === artifact.artifactId}
                    style={{ ...actionStyle, color: '#c0392b' }}
                  >
                    {expiring === artifact.artifactId ? 'Expiring…' : 'Expire'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const pillStyle: React.CSSProperties = {
  border: '1px solid #cfd8dc',
  background: '#fff',
  borderRadius: 12,
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: 12,
}
const pillActive: React.CSSProperties = {
  background: '#1565c0',
  color: '#fff',
  borderColor: '#1565c0',
}
const actionStyle: React.CSSProperties = {
  border: '1px solid #cfd8dc',
  background: '#fafafa',
  borderRadius: 6,
  padding: '4px 12px',
  cursor: 'pointer',
  fontSize: 12,
}
