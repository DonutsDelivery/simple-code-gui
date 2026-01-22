import React, { useState, useCallback, useEffect, useRef } from 'react'
import { QRScanner, ParsedConnectionUrl } from './QRScanner.js'
import { useHostConnection, HostConfig, ConnectionMethod, PendingFile } from '../../hooks/useHostConnection.js'
import { FileBrowser } from './FileBrowser.js'

// Conditionally import Capacitor App plugin (only available on native)
let CapacitorApp: any = null
try {
  // Dynamic import doesn't work well here, so we'll check at runtime
  CapacitorApp = (window as any).Capacitor?.Plugins?.App
} catch {
  // Not on native platform
}

// Parse claude-terminal:// URL
function parseDeepLink(url: string): ParsedConnectionUrl | null {
  try {
    // Format: claude-terminal://host:port?token=xxx&nonce=xxx&fingerprint=xxx
    const match = url.match(/^claude-terminal:\/\/([^:/?]+):(\d+)\?(.+)$/)
    if (!match) return null

    const [, host, portStr, queryStr] = match
    const params = new URLSearchParams(queryStr)

    return {
      host,
      port: parseInt(portStr, 10),
      token: params.get('token') || '',
      nonce: params.get('nonce') || undefined,
      fingerprint: params.get('fingerprint') || undefined,
      nonceExpires: params.get('nonceExpires') ? parseInt(params.get('nonceExpires')!, 10) : undefined,
      version: 2
    }
  } catch {
    return null
  }
}

type MobileView = 'welcome' | 'scanning' | 'connecting' | 'connected' | 'error'

// Check if host is a local/private network address (including Tailscale)
function isLocalNetwork(hostname: string): boolean {
  // RFC 1918 private ranges + Tailscale CGNAT (100.64-127.x.x) + MagicDNS (*.ts.net)
  return /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(hostname) ||
         hostname.endsWith('.ts.net')
}

// Helper to build HTTP URL
function buildHttpUrl(host: HostConfig, path: string): string {
  const protocol = isLocalNetwork(host.host) ? 'http' : 'https'
  return `${protocol}://${host.host}:${host.port}${path}`
}

// Connected view with actual functionality
function ConnectedView({ host, connectionMethod, onDisconnect, pendingFiles: propPendingFiles, onClearPendingFile }: {
  host: HostConfig
  connectionMethod: ConnectionMethod
  onDisconnect: () => void
  pendingFiles: PendingFile[]
  onClearPendingFile: (fileId: string) => void
}) {
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
    const loadProjects = async () => {
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

    const loadPendingFiles = async () => {
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
            📥 Files Ready to Download
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
                  {file.mimeType === 'application/vnd.android.package-archive' ? '📦' : '📄'}
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
                  ✕
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
                <span>📁</span>
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
            initialPath={fileBrowserPath}
            onClose={() => setShowFileBrowser(false)}
          />
        </div>
      )}
    </div>
  )
}

export function MobileApp(): React.ReactElement {
  const [view, setView] = useState<MobileView>('welcome')
  const [scanError, setScanError] = useState<string | null>(null)
  const {
    hosts,
    currentHost,
    connectionState,
    connectionMethod,
    error,
    fingerprintWarning,
    pendingFiles,
    addHost,
    updateHost,
    connect,
    disconnect,
    acceptFingerprint,
    clearPendingFile
  } = useHostConnection()

  // Sync view with connection state
  useEffect(() => {
    if (connectionState === 'connected') {
      setView('connected')
    } else if (connectionState === 'connecting' || connectionState === 'verifying') {
      setView('connecting')
    } else if (connectionState === 'error' && view !== 'welcome' && view !== 'scanning') {
      setView('error')
    }
  }, [connectionState, view])

  // Handle successful QR scan - defined before effects that use it
  const handleScan = useCallback(async (connection: ParsedConnectionUrl) => {
    console.log('[MobileApp] QR Scanned:', {
      host: connection.host,
      port: connection.port,
      token: connection.token?.slice(0, 8) + '...',
      version: connection.version,
      hasNonce: !!connection.nonce
    })
    setScanError(null)
    setView('connecting')

    // Check if host already exists
    const existingHost = hosts.find(
      h => h.host === connection.host && h.port === connection.port
    )

    // Prepare connect options (include all info to handle race condition)
    const connectOptions = {
      token: connection.token,
      nonce: connection.nonce,
      fingerprint: connection.fingerprint,
      host: connection.host,
      port: connection.port
    }

    if (existingHost) {
      // Update host with new values before connecting
      updateHost(existingHost.id, {
        token: connection.token,
        pendingNonce: connection.nonce,
        nonceExpires: connection.nonceExpires
      })
      // Connect with options (token override handles race condition)
      connect(existingHost.id, connectOptions)
    } else {
      // Add new host with v2 fields and connect
      const newHost = addHost({
        name: `${connection.host}:${connection.port}`,
        host: connection.host,
        port: connection.port,
        token: connection.token,
        // Store v2 security fields
        pendingNonce: connection.nonce,
        nonceExpires: connection.nonceExpires
      })
      connect(newHost.id, connectOptions)
    }
  }, [hosts, addHost, updateHost, connect])

  // Auto-connect to last host on mount
  useEffect(() => {
    if (hosts.length > 0 && connectionState === 'disconnected') {
      // Sort by lastConnected and try the most recent
      const sortedHosts = [...hosts].sort((a, b) => {
        const aTime = a.lastConnected?.getTime() ?? 0
        const bTime = b.lastConnected?.getTime() ?? 0
        return bTime - aTime
      })
      const lastHost = sortedHosts[0]
      if (lastHost) {
        setView('connecting')
        connect(lastHost.id)
      }
    }
  }, []) // Only on mount

  // Listen for deep links (claude-terminal://...) - only on native
  useEffect(() => {
    if (!CapacitorApp) return // Skip on web

    const handleDeepLink = (event: { url: string }) => {
      console.log('[MobileApp] Deep link received:', event.url)
      const connection = parseDeepLink(event.url)
      if (connection) {
        handleScan(connection)
      } else {
        setScanError('Invalid deep link URL')
      }
    }

    CapacitorApp.addListener('appUrlOpen', handleDeepLink)

    return () => {
      CapacitorApp.removeAllListeners?.()
    }
  }, [handleScan])

  // Handle scan cancel
  const handleScanCancel = useCallback(() => {
    setView('welcome')
  }, [])

  // Handle scan error
  const handleScanError = useCallback((errorMsg: string) => {
    setScanError(errorMsg)
    // Don't change view - let user continue scanning or see error
  }, [])

  // Start scanning
  const startScan = useCallback(() => {
    setScanError(null)
    setView('scanning')
  }, [])

  // Retry connection
  const handleRetry = useCallback(() => {
    setScanError(null)
    setView('welcome')
  }, [])

  // Handle disconnect
  const handleDisconnect = useCallback(() => {
    disconnect()
    setView('welcome')
  }, [disconnect])

  // Render QR scanner
  if (view === 'scanning') {
    return (
      <QRScanner
        onScan={handleScan}
        onCancel={handleScanCancel}
        onError={handleScanError}
      />
    )
  }

  // Render connecting state
  if (view === 'connecting') {
    return (
      <div className="app">
        <div className="empty-state">
          <div className="mobile-logo">◇</div>
          <h2>Connecting...</h2>
          <p>Establishing connection to your desktop host.</p>
          <div className="mobile-spinner" />
        </div>
      </div>
    )
  }

  // Render connected state with actual functionality
  if (view === 'connected' && currentHost) {
    return <ConnectedView host={currentHost} connectionMethod={connectionMethod} onDisconnect={handleDisconnect} pendingFiles={pendingFiles} onClearPendingFile={clearPendingFile} />
  }

  // Render fingerprint warning state
  if (view === 'error' && fingerprintWarning) {
    return (
      <div className="app">
        <div className="empty-state">
          <div className="mobile-logo mobile-logo--warning">⚠</div>
          <h2>Security Warning</h2>
          <p className="error-message" style={{ whiteSpace: 'pre-wrap', textAlign: 'left', fontSize: '12px' }}>
            {fingerprintWarning}
          </p>
          <div className="mobile-btn-group">
            <button className="mobile-btn mobile-btn--warning" onClick={acceptFingerprint}>
              Accept New Fingerprint
            </button>
            <button className="mobile-btn mobile-btn--secondary" onClick={handleRetry}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Render error state
  if (view === 'error') {
    return (
      <div className="app">
        <div className="empty-state">
          <div className="mobile-logo mobile-logo--error">✕</div>
          <h2>Connection Failed</h2>
          <p className="error-message">{error || 'Unknown error'}</p>
          <div className="mobile-btn-group">
            <button className="mobile-btn" onClick={startScan}>
              Scan Again
            </button>
            <button className="mobile-btn mobile-btn--secondary" onClick={handleRetry}>
              Go Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Render welcome screen (default)
  return (
    <div className="app">
      <div className="empty-state">
        <div className="mobile-logo">◇</div>
        <h2>Mobile App</h2>
        <p>Connect to your desktop host to start using Claude Terminal.</p>
        {(scanError || error) && <p className="error-message">{scanError || error}</p>}
        <button className="mobile-btn" onClick={startScan}>
          Scan QR Code
        </button>
        <p className="install-note">
          Click the 📱 button in your desktop app's sidebar to show the QR code.
        </p>
      </div>
    </div>
  )
}

export default MobileApp
