import React, { useEffect, useState, useCallback } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { ConnectionScreen, type ConnectionConfig } from '../components/ConnectionScreen'
import { MainApp } from './MainApp'
import type { Api } from '../api'
import { HttpBackend, isElectronEnvironment, setApi } from '../api'
import { attachRuntimeConnection, connectRuntimeServer, disconnectRuntimeServer } from '../api/runtime-connections'
import { useConnectionsStore } from '../stores/connections'
import { trustServerEndpoint } from '../security/server-certificate-trust'

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
    config: ConnectionConfig,
  ) => {
    const descriptor = connectedApi.getServerProtocol?.()
    if (!descriptor?.serverId) throw new Error('Server did not publish a stable identity')
    const savedConnection = {
      serverId: descriptor.serverId,
      displayName: descriptor.serverName || descriptor.serverId,
      endpoints: [{
        host: config.host,
        port: config.port,
        secure: config.secure,
        certFingerprint: config.certFingerprint,
      }],
      credentialRef: `credential:${descriptor.serverId}`,
      lastSeenProtocolVersion: descriptor.protocolVersion,
      capabilities: Object.entries(descriptor.capabilities)
        .filter(([, supported]) => supported)
        .map(([capability]) => capability),
    }
    await useConnectionsStore.getState().upsert(savedConnection)
    await attachRuntimeConnection(savedConnection, connectedApi, savedConnection.endpoints[0], config.token)
    localStorage.removeItem(CONNECTION_STORAGE_KEY)
    localStorage.removeItem(LEGACY_CONNECTION_STORAGE_KEY)
    setApi(connectedApi)
    setApiState(connectedApi)
    setIsConnected(true)
  }, [])

  useEffect(() => {
    if (!isElectron) return
    const frontendOnly = window.electronAPI?.isFrontendOnly === true
      || window.localStorage.getItem('donutcode-frontend-only') === '1'
      || new URLSearchParams(window.location.search).get('frontendOnly') === '1'
    if (frontendOnly) {
      setInitializingLocalServer(false)
      return
    }
    let cancelled = false
    const getConnectionInfo = window.electronAPI?.mobileGetConnectionInfo
    if (!getConnectionInfo) {
      setInitializingLocalServer(false)
      return
    }
    void getConnectionInfo()
      .then(async info => {
        // The embedded backend serves HTTPS on loopback with a pinned cert.
        // Trust it (same path as remote pairing), then connect over HTTPS so
        // the auto-connect does not fall back to the pairing screen.
        if (info.secure && info.certFingerprint) {
          await trustServerEndpoint(`https://127.0.0.1:${info.port}`, info.certFingerprint)
        }
        // Connection info intentionally carries no token; fetch the local
        // credential over IPC instead (never in URLs/QR payloads).
        const localToken = window.electronAPI?.mobileGetLocalToken
          ? await window.electronAPI.mobileGetLocalToken()
          : info.token
        const localApi = new HttpBackend({
          host: '127.0.0.1',
          port: info.port,
          token: localToken,
          secure: info.secure !== false,
        })
        const result = await localApi.testConnection()
        if (cancelled) return
        if (!result.success) throw new Error(result.error || 'Local DonutCode Server connection failed')
        await registerConnection(localApi, { host: '127.0.0.1', port: info.port, token: localToken })
      })
      .catch(error => {
        if (!cancelled) console.error('[App] Local server connection failed:', error)
      })
      .finally(() => {
        if (!cancelled) setInitializingLocalServer(false)
      })
    return () => { cancelled = true }
  }, [isElectron, registerConnection])

  // iOS suspends WebViews and networking while backgrounded. On foreground,
  // perform one bounded health check and reconnect through the saved Keychain
  // credential if needed; never run an unbounded background retry loop.
  useEffect(() => {
    if (!isCapacitor || !api) return
    let removed = false
    let listener: { remove: () => Promise<void> } | undefined
    void CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive || removed) return
      const result = await api.testConnection()
      if (result.success) return
      const serverId = api.getServerProtocol?.()?.serverId
      if (!serverId) return
      try {
        const reconnected = await connectRuntimeServer(serverId)
        if (!removed) setApiState(reconnected)
      } catch (error) {
        if (!removed) console.error('[App] Foreground reconnect failed:', error)
      }
    }).then(handle => { listener = handle })
    return () => {
      removed = true
      void listener?.remove()
    }
  }, [api, isCapacitor])

  // Handle successful connection from ConnectionScreen
  const handleConnected = useCallback((connectedApi: HttpBackend, config: ConnectionConfig) => {
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

  // Validate the legacy local-storage connection on mount. Current credentials
  // are restored through native secure storage by ConnectionScreen.
  useEffect(() => {
    if (isElectron || isConnected) return

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
