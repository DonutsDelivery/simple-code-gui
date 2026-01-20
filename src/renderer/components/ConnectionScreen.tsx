/**
 * ConnectionScreen Component
 *
 * Shown when the app is running in browser/Capacitor mode and needs to connect
 * to a desktop host. Provides QR code scanning and manual entry options.
 */

import React, { useState, useCallback, useEffect } from 'react'
import { QRScanner, ParsedConnectionUrl, parseConnectionUrl } from './mobile/QRScanner'
import { initializeApi, HttpBackend } from '../api'

interface ConnectionScreenProps {
  onConnected: (api: HttpBackend) => void
  savedConfig?: { host: string; port: number; token: string } | null
}

type ViewState = 'welcome' | 'scanning' | 'manual' | 'connecting' | 'error'

/**
 * Connection screen for browser/Capacitor environments
 * Allows users to scan QR code or manually enter connection details
 */
export function ConnectionScreen({ onConnected, savedConfig }: ConnectionScreenProps): React.ReactElement {
  const [view, setView] = useState<ViewState>('welcome')
  const [error, setError] = useState<string | null>(null)

  // Manual entry form state
  const [manualHost, setManualHost] = useState(savedConfig?.host || '')
  const [manualPort, setManualPort] = useState(savedConfig?.port?.toString() || '38470')
  const [manualToken, setManualToken] = useState('')

  // Auto-connect if we have saved config
  useEffect(() => {
    if (savedConfig && view === 'welcome') {
      handleConnect(savedConfig)
    }
  }, []) // Only on mount

  /**
   * Handle connection attempt
   */
  const handleConnect = useCallback(async (config: { host: string; port: number; token: string }) => {
    setView('connecting')
    setError(null)

    try {
      // Create the HTTP backend
      const api = initializeApi(config) as HttpBackend

      // Test the connection
      const result = await api.testConnection()

      if (!result.success) {
        throw new Error(result.error || 'Connection failed')
      }

      // Save config to localStorage for next time
      localStorage.setItem('claude-terminal-connection', JSON.stringify(config))

      // Notify parent of successful connection
      onConnected(api)
    } catch (err) {
      console.error('[ConnectionScreen] Connection failed:', err)
      setError(err instanceof Error ? err.message : 'Connection failed')
      setView('error')
    }
  }, [onConnected])

  /**
   * Handle successful QR scan
   */
  const handleScan = useCallback((connection: ParsedConnectionUrl) => {
    console.log('[ConnectionScreen] QR Scanned:', {
      host: connection.host,
      port: connection.port,
      tokenLength: connection.token?.length
    })

    handleConnect({
      host: connection.host,
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
          <div className="mobile-btn-group">
            <button className="mobile-btn" onClick={() => setView('scanning')}>
              Scan Again
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
      `}</style>
    </div>
  )
}

export default ConnectionScreen
