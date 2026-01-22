import React, { useState, useCallback, useEffect } from 'react'
import { HostConfig } from '../../hooks/useHostConnection.js'

interface FileEntry {
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  modified: string | null
  path: string
}

interface FileBrowserProps {
  host: HostConfig
  initialPath?: string
  onClose: () => void
}

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

// Format file size for display
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

// Format date for display
function formatDate(isoDate: string | null): string {
  if (!isoDate) return ''
  const date = new Date(isoDate)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function FileBrowser({ host, initialPath, onClose }: FileBrowserProps): React.ReactElement {
  const [currentPath, setCurrentPath] = useState(initialPath || '')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  // Load directory contents
  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoading(true)
    setError(null)
    const url = buildHttpUrl(host, `/api/files/list?path=${encodeURIComponent(dirPath)}`)
    console.log('[FileBrowser] Fetching:', url)
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${host.token}` }
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${response.status}`)
      }
      const data = await response.json()
      setCurrentPath(data.path)
      setFiles(data.files)
    } catch (err) {
      console.error('[FileBrowser] Fetch error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setError(`${msg} (${url})`)
    } finally {
      setLoading(false)
    }
  }, [host])

  // Initial load - use initialPath or fetch home directory
  useEffect(() => {
    const pathToLoad = initialPath || '/home'
    loadDirectory(pathToLoad)
  }, [initialPath, loadDirectory])

  // Navigate to parent directory
  const goUp = useCallback(() => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/')
    if (parentPath) {
      loadDirectory(parentPath)
    }
  }, [currentPath, loadDirectory])

  // Handle file/directory click
  const handleItemClick = useCallback((item: FileEntry) => {
    if (item.type === 'directory') {
      loadDirectory(item.path)
    }
  }, [loadDirectory])

  // Download a file
  const downloadFile = useCallback(async (file: FileEntry) => {
    setDownloading(file.name)
    try {
      // Build URL with token for direct download (works in Android WebView)
      const url = buildHttpUrl(host, `/api/files/download?path=${encodeURIComponent(file.path)}&token=${encodeURIComponent(host.token)}`)

      // Open in new window - Android will handle the download
      window.open(url, '_blank')
    } catch (err) {
      setError(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setDownloading(null)
    }
  }, [host])

  return (
    <div className="file-browser" style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#1a1a1a',
      color: '#fff'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        borderBottom: '1px solid #333',
        gap: '12px'
      }}>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            fontSize: '20px',
            cursor: 'pointer',
            padding: '4px'
          }}
        >
          ←
        </button>
        <h2 style={{ margin: 0, fontSize: '16px', flex: 1 }}>Files</h2>
      </div>

      {/* Path bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 16px',
        background: '#252525',
        borderBottom: '1px solid #333',
        gap: '8px'
      }}>
        {currentPath && (
          <button
            onClick={goUp}
            style={{
              background: '#333',
              border: 'none',
              color: '#fff',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            ↑ Up
          </button>
        )}
        <span style={{
          fontSize: '12px',
          opacity: 0.7,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1
        }}>
          {currentPath || 'Select a project to browse files'}
        </span>
      </div>

      {/* Error message */}
      {error && (
        <div style={{
          padding: '12px 16px',
          background: '#4a2d2d',
          color: '#ff6b6b',
          fontSize: '14px'
        }}>
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '32px'
        }}>
          <div className="mobile-spinner" />
        </div>
      )}

      {/* File list */}
      {!loading && files.length === 0 && currentPath && (
        <div style={{
          padding: '32px',
          textAlign: 'center',
          opacity: 0.6
        }}>
          Empty directory
        </div>
      )}

      {!loading && files.length > 0 && (
        <div style={{
          flex: 1,
          overflow: 'auto'
        }}>
          {files.map((file) => (
            <div
              key={file.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: '1px solid #2a2a2a',
                gap: '12px',
                cursor: file.type === 'directory' ? 'pointer' : 'default'
              }}
              onClick={() => file.type === 'directory' && handleItemClick(file)}
            >
              {/* Icon */}
              <span style={{ fontSize: '18px', width: '24px', textAlign: 'center' }}>
                {file.type === 'directory' ? '📁' : file.type === 'symlink' ? '🔗' : '📄'}
              </span>

              {/* File info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '14px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {file.name}
                </div>
                <div style={{
                  fontSize: '11px',
                  opacity: 0.5,
                  marginTop: '2px'
                }}>
                  {file.type !== 'directory' && formatSize(file.size)}
                  {file.type !== 'directory' && file.modified && ' • '}
                  {file.modified && formatDate(file.modified)}
                </div>
              </div>

              {/* Download button for files */}
              {file.type === 'file' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    downloadFile(file)
                  }}
                  disabled={downloading === file.name}
                  style={{
                    background: downloading === file.name ? '#555' : '#4a90d9',
                    border: 'none',
                    color: '#fff',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    cursor: downloading === file.name ? 'not-allowed' : 'pointer',
                    fontSize: '12px'
                  }}
                >
                  {downloading === file.name ? '...' : '↓'}
                </button>
              )}

              {/* Arrow for directories */}
              {file.type === 'directory' && (
                <span style={{ opacity: 0.4 }}>→</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Initial state - prompt to select a project */}
      {!loading && !currentPath && !error && (
        <div style={{
          padding: '32px',
          textAlign: 'center',
          opacity: 0.6
        }}>
          <p>Select a project from the sidebar to browse its files.</p>
        </div>
      )}
    </div>
  )
}

export default FileBrowser
