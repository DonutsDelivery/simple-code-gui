import React, { useState, useCallback, useEffect } from 'react'
import type { HostConfig, ConnectionMethod, PendingFile } from '../../../hooks/useHostConnection.js'
import { FileBrowser } from '../FileBrowser.js'
import { buildHttpUrl } from './helpers.js'

interface ConnectedViewProps {
  host: HostConfig
  connectionMethod: ConnectionMethod
  onDisconnect: () => void
  pendingFiles: PendingFile[]
  onClearPendingFile: (fileId: string) => void
}

export function ConnectedView({
  host,
  connectionMethod,
  onDisconnect,
  pendingFiles: propPendingFiles,
  onClearPendingFile
}: ConnectedViewProps): React.ReactElement {
  const [ttsText, setTtsText] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [showFileBrowser, setShowFileBrowser] = useState(false)
  const [fileBrowserPath, setFileBrowserPath] = useState<string | null>(null)
  const [projects, setProjects] = useState<Array<{ path: string; name: string }>>([])
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null)
  const [localPendingFiles, setLocalPendingFiles] = useState<PendingFile[]>([])
  const isWebSocket = connectionMethod === 'websocket'

  // Merge prop pending files with locally fetched ones
  const pendingFiles = [...propPendingFiles, ...localPendingFiles.filter(f => !propPendingFiles.some(p => p.id === f.id))]

  // Download a pending file
  const downloadPendingFile = useCallback(async (file: PendingFile) => {
    setDownloadingFile(file.id)
    try {
      const url = buildHttpUrl(host, `/api/files/pending/${file.id}/download`)
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${host.token}` }
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      // Get the file as a blob
      const blob = await response.blob()

      // Create a download link and trigger it
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(downloadUrl)

      // Clear from pending files after successful download
      onClearPendingFile(file.id)
      setLocalPendingFiles(prev => prev.filter(f => f.id !== file.id))
    } catch (err) {
      setStatus(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setDownloadingFile(null)
    }
  }, [host, onClearPendingFile])

  // Load projects and pending files on mount
  useEffect(() => {
    async function loadProjects(): Promise<void> {
      try {
        const response = await fetch(buildHttpUrl(host, '/api/workspace'), {
          headers: { 'Authorization': `Bearer ${host.token}` }
        })
        if (response.ok) {
          const data = await response.json()
          setProjects(data.projects || [])
        }
      } catch (err) {
        console.error('Failed to load projects:', err)
      }
    }

    async function loadPendingFiles(): Promise<void> {
      try {
        const url = buildHttpUrl(host, '/api/files/pending')
        console.log('[ConnectedView] Fetching pending files:', url)
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${host.token}` }
        })
        if (response.ok) {
          const data = await response.json()
          console.log('[ConnectedView] Got pending files:', data.files?.length || 0)
          if (data.files && Array.isArray(data.files)) {
            setLocalPendingFiles(data.files)
          }
        } else {
          console.error('[ConnectedView] Pending files error:', response.status)
        }
      } catch (err) {
        console.error('[ConnectedView] Failed to load pending files:', err)
      }
    }

    loadProjects()
    loadPendingFiles()

    // Poll for pending files every 30 seconds
    const interval = setInterval(loadPendingFiles, 30000)
    return () => clearInterval(interval)
  }, [host])

  const speak = useCallback(async () => {
    if (!ttsText.trim()) return
    setIsSpeaking(true)
    setStatus('Speaking...')
    try {
      const response = await fetch(buildHttpUrl(host, '/api/tts/speak'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${host.token}`
        },
        body: JSON.stringify({ text: ttsText })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${response.status}`)
      }
      setStatus('Done!')
      setTimeout(() => setStatus(null), 2000)
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown'}`)
    } finally {
      setIsSpeaking(false)
    }
  }, [host, ttsText])

  const stopSpeaking = useCallback(async () => {
    try {
      await fetch(buildHttpUrl(host, '/api/tts/stop'), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${host.token}` }
      })
      setStatus('Stopped')
      setTimeout(() => setStatus(null), 2000)
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
    setIsSpeaking(false)
  }, [host])

  return (
    <div className="app" style={{ padding: '16px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        paddingBottom: '12px',
        borderBottom: '1px solid #333'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px' }}>Connected</h2>
          <p style={{ margin: '4px 0 0', fontSize: '12px', opacity: 0.6 }}>
            {host.host}:{host.port}
          </p>
        </div>
        <span style={{
          fontSize: '10px',
          padding: '2px 6px',
          borderRadius: '4px',
          background: isWebSocket ? '#2d4a3e' : '#4a3a2d',
          color: isWebSocket ? '#4ade80' : '#fbbf24'
        }}>
          {isWebSocket ? 'WS' : 'HTTP'}
        </span>
      </div>

      {/* Pending Files Notification */}
      {pendingFiles.length > 0 && (
        <div style={{
          marginBottom: '16px',
          padding: '12px',
          background: '#2d3a4a',
          borderRadius: '8px',
          border: '1px solid #4a90d9'
        }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: '#4a90d9' }}>
            Files Ready to Download
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {pendingFiles.map((file) => (
              <div key={file.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px',
                background: '#1a1a1a',
                borderRadius: '6px'
              }}>
                <span style={{ fontSize: '20px' }}>
                  {file.mimeType === 'application/vnd.android.package-archive' ? '\u{1F4E6}' : '\u{1F4C4}'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {file.name}
                  </div>
                  {file.message && (
                    <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '2px' }}>
                      {file.message}
                    </div>
                  )}
                  <div style={{ fontSize: '10px', opacity: 0.5, marginTop: '2px' }}>
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </div>
                </div>
                <button
                  onClick={() => downloadPendingFile(file)}
                  disabled={downloadingFile === file.id}
                  style={{
                    background: downloadingFile === file.id ? '#555' : '#4a90d9',
                    border: 'none',
                    color: '#fff',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    cursor: downloadingFile === file.id ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: 500
                  }}
                >
                  {downloadingFile === file.id ? 'Downloading...' : 'Download'}
                </button>
                <button
                  onClick={() => onClearPendingFile(file.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#888',
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontSize: '16px'
                  }}
                  title="Dismiss"
                >
                  \u2715
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TTS Section */}
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '14px' }}>Text to Speech</h3>
        <textarea
          value={ttsText}
          onChange={(e) => setTtsText(e.target.value)}
          placeholder="Enter text to speak..."
          style={{
            width: '100%',
            height: '80px',
            padding: '8px',
            borderRadius: '8px',
            border: '1px solid #444',
            background: '#1a1a1a',
            color: '#fff',
            fontSize: '14px',
            resize: 'none'
          }}
        />
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button
            className="mobile-btn"
            onClick={speak}
            disabled={isSpeaking || !ttsText.trim()}
            style={{ flex: 1 }}
          >
            {isSpeaking ? 'Speaking...' : 'Speak'}
          </button>
          <button
            className="mobile-btn mobile-btn--secondary"
            onClick={stopSpeaking}
            style={{ flex: 1 }}
          >
            Stop
          </button>
        </div>
        {status && (
          <p style={{ margin: '8px 0 0', fontSize: '12px', opacity: 0.8 }}>{status}</p>
        )}
      </div>

      {/* Files Section */}
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '14px' }}>Files</h3>
        <p style={{ margin: '0 0 8px', fontSize: '12px', opacity: 0.6 }}>
          Browse and download files from your desktop
        </p>
        {projects.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {projects.slice(0, 5).map((project) => (
              <button
                key={project.path}
                className="mobile-btn mobile-btn--secondary"
                onClick={() => {
                  setFileBrowserPath(project.path)
                  setShowFileBrowser(true)
                }}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span>{'\u{1F4C1}'}</span>
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {project.name || project.path.split('/').pop()}
                </span>
              </button>
            ))}
            {projects.length > 5 && (
              <p style={{ margin: 0, fontSize: '11px', opacity: 0.5 }}>
                +{projects.length - 5} more projects
              </p>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: '12px', opacity: 0.5 }}>
            No projects found
          </p>
        )}
      </div>

      {/* Disconnect */}
      <button
        className="mobile-btn mobile-btn--secondary"
        onClick={onDisconnect}
        style={{ width: '100%', marginTop: 'auto' }}
      >
        Disconnect
      </button>

      {/* File Browser Modal */}
      {showFileBrowser && fileBrowserPath && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 100
        }}>
          <FileBrowser
            host={host}
            basePath={fileBrowserPath}
            onClose={() => setShowFileBrowser(false)}
          />
        </div>
      )}
    </div>
  )
}
