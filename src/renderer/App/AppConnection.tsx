import React, { useEffect, useState, useCallback } from 'react'
import { ConnectionScreen } from '../components/ConnectionScreen'
import { MainApp } from './MainApp'
import type { Api } from '../api'
import { HttpBackend, isElectronEnvironment, setApi } from '../api'
import { attachRuntimeConnection, disconnectRuntimeServer } from '../api/runtime-connections'
import { useConnectionsStore } from '../stores/connections'

const CONNECTION_STORAGE_KEY = 'donutcode-connection'
const LEGACY_CONNECTION_STORAGE_KEY = 'claude-terminal-connection'
const MANUAL_DISCONNECT_KEY = 'donutcode-manual-disconnect'

function loadSavedConnection(): string | null {
  const current = localStorage.getItem(CONNECTION_STORAGE_KEY)
  if (current) return current
  const legacy = localStorage.getItem(LEGACY_CONNECTION_STORAGE_KEY)
  if (legacy) localStorage.setItem(CONNECTION_STORAGE_KEY, legacy)
  return legacy
}

// Check if running in Capacitor native app
export function isCapacitorApp(): boolean {
  return typeof window !== 'undefined' &&
         typeof (window as any).Capacitor !== 'undefined' &&
         (window as any).Capacitor?.isNativePlatform?.() === true
}

// Helper to validate port
function isValidPort(port: number): boolean {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
}

export function AppConnection(): React.ReactElement | null {
  // Check if we're running in Electron or browser/Capacitor
  const isElectron = isElectronEnvironment()
  const isCapacitor = isCapacitorApp()

  // Add mobile class to body for CSS targeting
  useEffect(() => {
    if (isCapacitor || !isElectron) {
      document.body.classList.add('is-mobile-app')
    }
    return () => {
      document.body.classList.remove('is-mobile-app')
    }
  }, [isCapacitor, isElectron])

  // Connection state for browser/Capacitor mode
  const [isConnected, setIsConnected] = useState(false)
  const [api, setApiState] = useState<Api | null>(null)
  const [initializingLocalServer, setInitializingLocalServer] = useState(isElectron)

  const registerConnection = useCallback(async (
    connectedApi: HttpBackend,
    config: { host: string; port: number; token: string },
  ) => {
    const descriptor = connectedApi.getServerProtocol?.()
    if (!descriptor?.serverId) throw new Error('Server did not publish a stable identity')
    const savedConnection = {
      serverId: descriptor.serverId,
      displayName: descriptor.serverName || descriptor.serverId,
      endpoints: [{ host: config.host, port: config.port }],
      credentialRef: `credential:${descriptor.serverId}`,
      lastSeenProtocolVersion: descriptor.protocolVersion,
      capabilities: descriptor.capabilities.map(capability => capability.id),
    }
    useConnectionsStore.getState().addConnection(savedConnection)
    await attachRuntimeConnection(savedConnection, connectedApi, savedConnection.endpoints[0], config.token)
    setApi(connectedApi)
    setApiState(connectedApi)
    setIsConnected(true)
  }, [])

  useEffect(() => {
    if (!isElectron) return
    let cancelled = false
    void window.electronAPI.mobileGetConnectionInfo()
      .then(async info => {
        const localApi = new HttpBackend({ host: '127.0.0.1', port: info.port, token: info.token })
        const result = await localApi.testConnection()
        if (cancelled) return
        if (!result.success) throw new Error(result.error || 'Local DonutCode Server connection failed')
        await registerConnection(localApi, { host: '127.0.0.1', port: info.port, token: info.token })
      })
      .catch(error => {
        if (!cancelled) console.error('[App] Local server connection failed:', error)
      })
      .finally(() => {
        if (!cancelled) setInitializingLocalServer(false)
      })
    return () => { cancelled = true }
  }, [isElectron, registerConnection])

  // Handle successful connection from ConnectionScreen
  const handleConnected = useCallback((connectedApi: HttpBackend, config: { host: string; port: number; token: string }) => {
    void registerConnection(connectedApi, config).catch(error => {
      console.error('[App] Failed to register connection:', error)
    })
  }, [registerConnection])

  // Handle disconnect - return to connection screen but keep saved hosts
  const handleDisconnect = useCallback(() => {
    console.log('[App] Disconnecting...')
    // Only clear the active connection, keep saved hosts for easy reconnect
    localStorage.removeItem(CONNECTION_STORAGE_KEY)
    localStorage.removeItem(LEGACY_CONNECTION_STORAGE_KEY)
    // Set flag to prevent auto-reconnect (cleared on next app launch)
    sessionStorage.setItem(MANUAL_DISCONNECT_KEY, 'true')
    const serverId = api?.getServerProtocol?.()?.serverId
    if (serverId) disconnectRuntimeServer(serverId)
    setApiState(null)
    setIsConnected(false)
  }, [api])

  // Try to restore saved connection on mount (browser/Capacitor only)
  // Also check for token in URL query string (from server redirect)
  useEffect(() => {
    if (isElectron || isConnected) return

    // Check for token in URL (from server redirect)
    const urlParams = new URLSearchParams(window.location.search)
    const urlToken = urlParams.get('token')

    if (urlToken) {
      // We have a token from URL - extract host/port from current location
      const host = window.location.hostname
      const port = parseInt(window.location.port) || 38470

      // Validate port before saving
      if (!isValidPort(port)) {
        console.error('[App] Invalid port from URL:', port)
        return
      }

      // Save to localStorage so future reloads work
      const config = { host, port, token: urlToken }
      localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(config))

      // Clear token from URL for cleaner appearance
      window.history.replaceState({}, document.title, window.location.pathname)

      console.log('[App] Connecting with URL token:', { host, port, tokenLength: urlToken.length })
    }

    try {
      const saved = loadSavedConnection()
      if (saved) {
        const config = JSON.parse(saved)
        // Validate port from saved config
        if (config.host && config.token && isValidPort(config.port)) {
          // We have valid saved config, the ConnectionScreen will auto-connect
        } else if (config.port && !isValidPort(config.port)) {
          console.error('[App] Invalid port in saved config:', config.port, '- clearing')
          localStorage.removeItem(CONNECTION_STORAGE_KEY)
          localStorage.removeItem(LEGACY_CONNECTION_STORAGE_KEY)
        }
      }
    } catch (e) {
      // Invalid saved config, ignore
    }
  }, [isElectron, isConnected])

  // Show connection screen if not connected (browser/Capacitor mode)
  if (initializingLocalServer) return null

  if (!isConnected || !api) {
    // Try to get saved config for auto-connect
    let savedConfig: { host: string; port: number; token: string } | null = null
    try {
      const saved = loadSavedConnection()
      if (saved) {
        const parsed = JSON.parse(saved)
        // Only use config if port is valid
        if (parsed && isValidPort(parsed.port)) {
          savedConfig = parsed
        } else if (parsed?.port) {
          console.error('[App] Discarding saved config with invalid port:', parsed.port)
        }
      }
    } catch {
      // Ignore
    }

    return <ConnectionScreen onConnected={handleConnected} savedConfig={savedConfig} />
  }

  // Render the main app with the connected API
  const serverId = api.getServerProtocol?.()?.serverId
  if (!serverId) {
    return <ConnectionScreen onConnected={handleConnected} savedConfig={null} />
  }
  return <MainApp serverId={serverId} api={api} isElectron={isElectron} onDisconnect={handleDisconnect} />
}
