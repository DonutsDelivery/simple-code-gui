/**
 * ConnectionScreen Component
 *
 * Shown when the app is running in browser/Capacitor mode and needs to connect
 * to a desktop host. Provides QR code scanning and manual entry options.
 */

import React, { useState, useCallback, useEffect } from 'react'
import { Preferences } from '@capacitor/preferences'
import { QRScanner, ParsedConnectionUrl, parseConnectionUrl } from './mobile/QRScanner'
import { initializeApi, HttpBackend } from '../api'

interface ConnectionScreenProps {
  onConnected: (api: HttpBackend) => void
  savedConfig?: { host: string; port: number; token: string } | null
}

type ViewState = 'welcome' | 'scanning' | 'manual' | 'connecting' | 'error'

interface ConnectionConfig {
  host: string
  hosts?: string[]  // All IPs for multi-IP retry
  port: number
  token: string
}

interface SavedHost {
  id: string
  name: string
  host: string
  hosts?: string[]  // All IPs for multi-IP connection
  port: number
  token: string
  lastConnected: string  // ISO date string
}

const HOSTS_STORAGE_KEY = 'claude-terminal-saved-hosts'

// Use Capacitor Preferences for persistent storage (localStorage is unreliable in WebViews)
async function loadSavedHostsAsync(): Promise<SavedHost[]> {
  try {
    const { value } = await Preferences.get({ key: HOSTS_STORAGE_KEY })
    console.log('[ConnectionScreen] Loading saved hosts from Preferences:', value)
    if (!value) return []
    const hosts = JSON.parse(value) as SavedHost[]
    console.log('[ConnectionScreen] Parsed saved hosts:', hosts.length, 'hosts')
    return hosts
  } catch (e) {
    console.error('[ConnectionScreen] Error loading saved hosts:', e)
    return []
  }
}

async function saveSavedHostsAsync(hosts: SavedHost[]): Promise<void> {
  try {
    console.log('[ConnectionScreen] Saving', hosts.length, 'hosts to Preferences')
    await Preferences.set({ key: HOSTS_STORAGE_KEY, value: JSON.stringify(hosts) })
    console.log('[ConnectionScreen] Saved successfully')
  } catch (e) {
    console.error('[ConnectionScreen] Error saving hosts:', e)
  }
}

function generateHostId(): string {
  return `host-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Connection screen for browser/Capacitor environments
 * Allows users to scan QR code or manually enter connection details
 */
export function ConnectionScreen({ onConnected, savedConfig }: ConnectionScreenProps): React.ReactElement {
  const [view, setView] = useState<ViewState>('welcome')
  const [error, setError] = useState<string | null>(null)
  const [hostsLoaded, setHostsLoaded] = useState(false)

  // Track last attempted connection for retry
  const [lastAttemptedConfig, setLastAttemptedConfig] = useState<ConnectionConfig | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  // Saved hosts list (loaded async from Capacitor Preferences)
  const [savedHosts, setSavedHosts] = useState<SavedHost[]>([])

  // Manual entry form state
  const [manualHost, setManualHost] = useState(savedConfig?.host || '')
  const [manualPort, setManualPort] = useState(savedConfig?.port?.toString() || '38470')
  const [manualToken, setManualToken] = useState('')

  // Load saved hosts on mount (async - uses Capacitor Preferences)
  useEffect(() => {
    loadSavedHostsAsync().then(hosts => {
      console.log('[ConnectionScreen] Loaded', hosts.length, 'saved hosts')
      setSavedHosts(hosts)
      setHostsLoaded(true)
    })
  }, [])

  // Auto-connect on app launch, but not after manual disconnect
  // Runs after hosts are loaded
  useEffect(() => {
    if (!hostsLoaded) return // Wait for hosts to load

    // Check if user manually disconnected (flag set in session)
    const manualDisconnect = sessionStorage.getItem('claude-terminal-manual-disconnect')
    if (manualDisconnect) {
      console.log('[ConnectionScreen] Skipping auto-connect after manual disconnect')
      sessionStorage.removeItem('claude-terminal-manual-disconnect')
      return
    }

    // Check if there are saved hosts with all IPs
    if (savedHosts.length > 0 && view === 'welcome') {
      // Use the most recently connected host (includes all IPs for fallback)
      const mostRecent = savedHosts[0]
      console.log('[ConnectionScreen] Auto-connecting to saved host:', mostRecent.name, 'with hosts:', mostRecent.hosts)
      handleConnect({
        host: mostRecent.host,
        hosts: mostRecent.hosts,  // This includes all IPs (WiFi, Tailscale, etc.)
        port: mostRecent.port,
        token: mostRecent.token
      })
    } else if (savedConfig && view === 'welcome') {
      // Fallback to single-IP savedConfig if no saved hosts
      handleConnect(savedConfig)
    }
  }, [hostsLoaded]) // Run when hosts finish loading

  /**
   * Try connecting to a single host
   * Returns the successful config or throws an error
   */
  const tryConnect = useCallback(async (config: { host: string; port: number; token: string }): Promise<{ api: HttpBackend; config: typeof config }> => {
    const api = initializeApi(config) as HttpBackend
    const result = await api.testConnection()

    if (!result.success) {
      throw new Error(result.error || 'Connection failed')
    }

    return { api, config }
  }, [])

  /**
   * Handle connection attempt - tries multiple IPs if provided
   */
  const handleConnect = useCallback(async (
    config: { host: string; hosts?: string[]; port: number; token: string },
    isRetry = false
  ) => {
    setView('connecting')
    setError(null)
    // Store config including hosts for retry
    setLastAttemptedConfig({
      host: config.host,
      hosts: config.hosts,
      port: config.port,
      token: config.token
    })
    if (!isRetry) {
      setRetryCount(0)
    }

    // Build list of hosts to try
    const hostsToTry = config.hosts && config.hosts.length > 0
      ? config.hosts
      : [config.host]

    let lastError: Error | null = null
    let successfulConfig: { host: string; port: number; token: string } | null = null

    // Try each host in sequence
    for (const host of hostsToTry) {
      const attemptConfig = { host, port: config.port, token: config.token }
      console.log(`[ConnectionScreen] Trying to connect to ${host}:${config.port}...`)

      try {
        const { config: workingConfig } = await tryConnect(attemptConfig)
        successfulConfig = workingConfig
        console.log(`[ConnectionScreen] Successfully connected to ${host}:${config.port}`)
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Connection failed')
        console.log(`[ConnectionScreen] Failed to connect to ${host}:${config.port}: ${lastError.message}`)
      }
    }

    if (!successfulConfig) {
      console.error('[ConnectionScreen] All connection attempts failed')
      const triedHosts = hostsToTry.join(', ')
      setError(`Failed to connect to: ${triedHosts}\n${lastError?.message || 'Network unreachable'}`)
      setView('error')
      return
    }

    try {
      // Update last attempted config with the successful host
      setLastAttemptedConfig(successfulConfig)

      // Save config to localStorage for next time
      localStorage.setItem('claude-terminal-connection', JSON.stringify(successfulConfig))

      // Add or update this host in saved hosts list
      // Use the original hosts array from the QR code so retry can try all IPs
      const allHosts = config.hosts && config.hosts.length > 0 ? config.hosts : [successfulConfig.host]

      // Save to Capacitor Preferences (async but we don't await - fire and forget)
      // Also update React state for UI
      const now = new Date().toISOString()
      const existingIndex = savedHosts.findIndex(h => h.port === successfulConfig.port &&
        (h.host === successfulConfig.host || allHosts.includes(h.host)))

      let updatedHosts: SavedHost[]
      if (existingIndex >= 0) {
        // Update existing host
        updatedHosts = [...savedHosts]
        updatedHosts[existingIndex] = {
          ...updatedHosts[existingIndex],
          host: successfulConfig.host,
          hosts: allHosts,
          token: successfulConfig.token,
          lastConnected: now
        }
      } else {
        // Add new host
        const newHost: SavedHost = {
          id: generateHostId(),
          name: `${successfulConfig.host}:${successfulConfig.port}`,
          host: successfulConfig.host,
          hosts: allHosts,
          port: successfulConfig.port,
          token: successfulConfig.token,
          lastConnected: now
        }
        updatedHosts = [newHost, ...savedHosts]
      }

      // Save to Capacitor Preferences (fire and forget - don't block connection)
      saveSavedHostsAsync(updatedHosts)
      // Update React state (might not complete if component unmounts, but that's ok)
      setSavedHosts(updatedHosts)

      // Check if we're in a native Capacitor app
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isNativeApp = !!(window as any).Capacitor?.isNativePlatform?.()

      if (!isNativeApp) {
        // Browser/PWA mode: redirect to server for fresh UI
        const currentOrigin = window.location.origin
        const serverOrigin = `http://${successfulConfig.host}:${successfulConfig.port}`

        if (!currentOrigin.includes(successfulConfig.host) || !currentOrigin.includes(String(successfulConfig.port))) {
          console.log('[ConnectionScreen] Redirecting to server for fresh UI:', serverOrigin)
          window.location.href = `${serverOrigin}/?token=${encodeURIComponent(successfulConfig.token)}`
          return
        }
      }

      // Native app or already on server: use API directly
      console.log('[ConnectionScreen] Connected, using bundled UI')
      const api = initializeApi(successfulConfig) as HttpBackend
      onConnected(api)
    } catch (err) {
      console.error('[ConnectionScreen] Connection failed:', err)
      setError(err instanceof Error ? err.message : 'Connection failed')
      setView('error')
    }
  }, [onConnected, tryConnect])

  /**
   * Handle successful QR scan
   */
  const handleScan = useCallback((connection: ParsedConnectionUrl) => {
    console.log('[ConnectionScreen] QR Scanned:', {
      host: connection.host,
      hosts: connection.hosts,
      port: connection.port,
      tokenLength: connection.token?.length
    })

    handleConnect({
      host: connection.host,
      hosts: connection.hosts,  // Pass all available IPs for multi-IP connection
      port: connection.port,
      token: connection.token
    })
  }, [handleConnect])

  /**
   * Handle manual form submission
   */
  const handleManualSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()

    const port = parseInt(manualPort, 10)
    if (isNaN(port) || port < 1 || port > 65535) {
      setError('Invalid port number')
      return
    }

    if (!manualHost.trim()) {
      setError('Host is required')
      return
    }

    if (!manualToken.trim()) {
      setError('Token is required')
      return
    }

    handleConnect({
      host: manualHost.trim(),
      port,
      token: manualToken.trim()
    })
  }, [manualHost, manualPort, manualToken, handleConnect])

  /**
   * Handle scan cancel
   */
  const handleScanCancel = useCallback(() => {
    setView('welcome')
  }, [])

  /**
   * Handle scan error
   */
  const handleScanError = useCallback((errorMsg: string) => {
    setError(errorMsg)
    setView('error')
  }, [])

  /**
   * Handle retry with last attempted config
   */
  const handleRetry = useCallback(() => {
    if (lastAttemptedConfig) {
      setRetryCount(prev => prev + 1)
      handleConnect(lastAttemptedConfig, true)
    }
  }, [lastAttemptedConfig, handleConnect])

  /**
   * Connect to a saved host
   */
  const handleConnectToSavedHost = useCallback((host: SavedHost) => {
    handleConnect({
      host: host.host,
      hosts: host.hosts,  // Pass all saved IPs for multi-IP connection
      port: host.port,
      token: host.token
    })
  }, [handleConnect])

  /**
   * Remove a saved host
   */
  const handleRemoveSavedHost = useCallback((e: React.MouseEvent, hostId: string) => {
    e.stopPropagation() // Don't trigger connect
    setSavedHosts(prev => {
      const updated = prev.filter(h => h.id !== hostId)
      saveSavedHostsAsync(updated) // Fire and forget
      return updated
    })
  }, [])

  // Render QR scanner view
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

  // Render manual entry form
  if (view === 'manual') {
    return (
      <div className="app">
        <div className="empty-state">
          <div className="mobile-logo">◇</div>
          <h2>Manual Connection</h2>
          <p>Enter the connection details from your desktop app.</p>

          <form onSubmit={handleManualSubmit} className="connection-form">
            <div className="form-group">
              <label htmlFor="host">Host</label>
              <input
                id="host"
                type="text"
                value={manualHost}
                onChange={(e) => setManualHost(e.target.value)}
                placeholder="192.168.1.100"
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label htmlFor="port">Port</label>
              <input
                id="port"
                type="number"
                value={manualPort}
                onChange={(e) => setManualPort(e.target.value)}
                placeholder="38470"
                min="1"
                max="65535"
              />
            </div>

            <div className="form-group">
              <label htmlFor="token">Token</label>
              <input
                id="token"
                type="password"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Connection token"
                autoComplete="off"
              />
            </div>

            {error && <p className="error-message">{error}</p>}

            <div className="mobile-btn-group">
              <button type="submit" className="mobile-btn">
                Connect
              </button>
              <button
                type="button"
                className="mobile-btn mobile-btn--secondary"
                onClick={() => {
                  setError(null)
                  setView('welcome')
                }}
              >
                Back
              </button>
            </div>
          </form>
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

          {lastAttemptedConfig && (
            <p className="connection-details">
              {lastAttemptedConfig.host}:{lastAttemptedConfig.port}
              {retryCount > 0 && ` (attempt ${retryCount + 1})`}
            </p>
          )}

          <div className="mobile-btn-group">
            {lastAttemptedConfig && (
              <button className="mobile-btn" onClick={handleRetry}>
                Retry Connection
              </button>
            )}
            <button
              className={lastAttemptedConfig ? "mobile-btn mobile-btn--secondary" : "mobile-btn"}
              onClick={() => setView('scanning')}
            >
              Scan New QR Code
            </button>
            <button
              className="mobile-btn mobile-btn--secondary"
              onClick={() => {
                setError(null)
                setView('welcome')
              }}
            >
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
        <h2>Claude Terminal</h2>
        <p>Connect to your desktop to start using Claude Terminal on this device.</p>

        {error && <p className="error-message">{error}</p>}

        {/* Saved hosts list */}
        {savedHosts.length > 0 && (
          <div className="saved-hosts-section">
            <h3 className="saved-hosts-title">Recent Hosts</h3>
            <div className="saved-hosts-list">
              {savedHosts.map(host => (
                <div
                  key={host.id}
                  className="saved-host-item"
                  onClick={() => handleConnectToSavedHost(host)}
                >
                  <div className="saved-host-info">
                    <span className="saved-host-name">{host.name}</span>
                    <span className="saved-host-last">
                      {new Date(host.lastConnected).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    className="saved-host-remove"
                    onClick={(e) => handleRemoveSavedHost(e, host.id)}
                    aria-label="Remove host"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mobile-btn-group">
          <button className="mobile-btn" onClick={() => setView('scanning')}>
            Scan QR Code
          </button>
          <button
            className="mobile-btn mobile-btn--secondary"
            onClick={() => setView('manual')}
          >
            Manual Entry
          </button>
        </div>

        <p className="install-note">
          Click the mobile icon in your desktop app's sidebar to show the QR code.
        </p>
      </div>

      <style>{`
        .connection-form {
          width: 100%;
          max-width: 300px;
          margin-top: 16px;
        }

        .form-group {
          margin-bottom: 16px;
          text-align: left;
        }

        .form-group label {
          display: block;
          margin-bottom: 4px;
          font-size: 12px;
          opacity: 0.8;
        }

        .form-group input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid var(--border-color, #444);
          border-radius: 8px;
          background: var(--input-bg, #1a1a1a);
          color: var(--text-color, #fff);
          font-size: 14px;
        }

        .form-group input:focus {
          outline: none;
          border-color: var(--accent-color, #007aff);
        }

        .mobile-btn-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
          max-width: 300px;
          margin-top: 16px;
        }

        .mobile-btn {
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          background: var(--accent-color, #007aff);
          color: #fff;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }

        .mobile-btn:hover {
          background: var(--accent-hover, #0056b3);
        }

        .mobile-btn--secondary {
          background: transparent;
          border: 1px solid var(--border-color, #444);
          color: var(--text-color, #fff);
        }

        .mobile-btn--secondary:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .mobile-logo {
          font-size: 48px;
          margin-bottom: 16px;
          opacity: 0.8;
        }

        .mobile-logo--error {
          color: #ef4444;
        }

        .mobile-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid rgba(255, 255, 255, 0.2);
          border-top-color: var(--accent-color, #007aff);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-top: 16px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .install-note {
          margin-top: 24px;
          font-size: 12px;
          opacity: 0.6;
        }

        .connection-details {
          font-size: 12px;
          opacity: 0.7;
          margin: 8px 0;
          font-family: monospace;
        }

        .saved-hosts-section {
          width: 100%;
          max-width: 300px;
          margin: 16px 0;
        }

        .saved-hosts-title {
          font-size: 12px;
          opacity: 0.7;
          margin-bottom: 8px;
          text-align: left;
        }

        .saved-hosts-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .saved-host-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          background: var(--input-bg, #1a1a1a);
          border: 1px solid var(--border-color, #444);
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
        }

        .saved-host-item:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: var(--accent-color, #007aff);
        }

        .saved-host-info {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
        }

        .saved-host-name {
          font-size: 14px;
          font-family: monospace;
        }

        .saved-host-last {
          font-size: 11px;
          opacity: 0.5;
        }

        .saved-host-remove {
          background: transparent;
          border: none;
          color: var(--text-color, #fff);
          opacity: 0.4;
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
          line-height: 1;
          transition: opacity 0.2s;
        }

        .saved-host-remove:hover {
          opacity: 1;
          color: #ef4444;
        }
      `}</style>
    </div>
  )
}

export default ConnectionScreen
