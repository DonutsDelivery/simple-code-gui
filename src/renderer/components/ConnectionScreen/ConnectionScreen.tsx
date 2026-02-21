/**
 * ConnectionScreen Component
 *
 * Shown when the app is running in browser/Capacitor mode and needs to connect
 * to a desktop host. Provides QR code scanning and manual entry options.
 */

import React, { useState, useCallback, useEffect } from 'react'
import { QRScanner, ParsedConnectionUrl } from '../mobile/QRScanner.js'
import { initializeApi, HttpBackend } from '../../api/index.js'
import { loadSavedHostsAsync, saveSavedHostsAsync, generateHostId } from './storage.js'
import { WelcomeView } from './views/WelcomeView.js'
import { ManualEntryView } from './views/ManualEntryView.js'
import { ConnectingView } from './views/ConnectingView.js'
import { ErrorView } from './views/ErrorView.js'
import { connectionScreenStyles } from './styles.js'
import type { ConnectionScreenProps, ViewState, ConnectionConfig, SavedHost } from './types.js'

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
  }, [onConnected, tryConnect, savedHosts])

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
    if (!hostsLoaded) return

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
        hosts: mostRecent.hosts,
        port: mostRecent.port,
        token: mostRecent.token
      })
    } else if (savedConfig && view === 'welcome') {
      // Fallback to single-IP savedConfig if no saved hosts
      handleConnect(savedConfig)
    }
  }, [hostsLoaded])

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
      hosts: connection.hosts,
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
      hosts: host.hosts,
      port: host.port,
      token: host.token
    })
  }, [handleConnect])

  /**
   * Remove a saved host
   */
  const handleRemoveSavedHost = useCallback((e: React.MouseEvent, hostId: string) => {
    e.stopPropagation()
    setSavedHosts(prev => {
      const updated = prev.filter(h => h.id !== hostId)
      saveSavedHostsAsync(updated)
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
      <>
        <ConnectingView />
        <style>{connectionScreenStyles}</style>
      </>
    )
  }

  // Render manual entry form
  if (view === 'manual') {
    return (
      <>
        <ManualEntryView
          manualHost={manualHost}
          manualPort={manualPort}
          manualToken={manualToken}
          error={error}
          setManualHost={setManualHost}
          setManualPort={setManualPort}
          setManualToken={setManualToken}
          setError={setError}
          setView={setView}
          onSubmit={handleManualSubmit}
        />
        <style>{connectionScreenStyles}</style>
      </>
    )
  }

  // Render error state
  if (view === 'error') {
    return (
      <>
        <ErrorView
          error={error}
          lastAttemptedConfig={lastAttemptedConfig}
          retryCount={retryCount}
          onRetry={handleRetry}
          setView={setView}
          setError={setError}
        />
        <style>{connectionScreenStyles}</style>
      </>
    )
  }

  // Render welcome screen (default)
  return (
    <>
      <WelcomeView
        error={error}
        savedHosts={savedHosts}
        setView={setView}
        onConnectToSavedHost={handleConnectToSavedHost}
        onRemoveSavedHost={handleRemoveSavedHost}
      />
      <style>{connectionScreenStyles}</style>
    </>
  )
}

export default ConnectionScreen
