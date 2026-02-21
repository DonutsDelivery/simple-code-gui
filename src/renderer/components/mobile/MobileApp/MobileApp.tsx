import React, { useState, useCallback, useEffect } from 'react'
import { QRScanner, ParsedConnectionUrl } from '../QRScanner.js'
import { useHostConnection } from '../../../hooks/useHostConnection.js'
import { ConnectedView } from './ConnectedView.js'
import { parseDeepLink } from './helpers.js'
import type { MobileView } from './types.js'

// Conditionally import Capacitor App plugin (only available on native)
let CapacitorApp: any = null
try {
  // Dynamic import doesn't work well here, so we'll check at runtime
  CapacitorApp = (window as any).Capacitor?.Plugins?.App
} catch {
  // Not on native platform
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

    function handleDeepLink(event: { url: string }): void {
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
          <div className="mobile-logo">\u25C7</div>
          <h2>Connecting...</h2>
          <p>Establishing connection to your desktop host.</p>
          <div className="mobile-spinner" />
        </div>
      </div>
    )
  }

  // Render connected state with actual functionality
  if (view === 'connected' && currentHost) {
    return (
      <ConnectedView
        host={currentHost}
        connectionMethod={connectionMethod}
        onDisconnect={handleDisconnect}
        pendingFiles={pendingFiles}
        onClearPendingFile={clearPendingFile}
      />
    )
  }

  // Render fingerprint warning state
  if (view === 'error' && fingerprintWarning) {
    return (
      <div className="app">
        <div className="empty-state">
          <div className="mobile-logo mobile-logo--warning">\u26A0</div>
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
          <div className="mobile-logo mobile-logo--error">\u2715</div>
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
        <div className="mobile-logo">\u25C7</div>
        <h2>Mobile App</h2>
        <p>Connect to your desktop host to start using Claude Terminal.</p>
        {(scanError || error) && <p className="error-message">{scanError || error}</p>}
        <button className="mobile-btn" onClick={startScan}>
          Scan QR Code
        </button>
        <p className="install-note">
          Click the {'\u{1F4F1}'} button in your desktop app's sidebar to show the QR code.
        </p>
      </div>
    </div>
  )
}

export default MobileApp
