import React, { useState, useCallback, useRef, useEffect } from 'react'
import { QRScanner, ParsedConnectionUrl } from './QRScanner'
import { useHostConnection, HostConfig, ConnectionState } from '../../hooks/useHostConnection'

interface HostSelectorProps {
  onConnect?: (host: HostConfig) => void
  onDisconnect?: () => void
  className?: string
}

interface SwipeState {
  hostId: string | null
  startX: number
  currentX: number
  isDeleting: boolean
}

const SWIPE_THRESHOLD = 80 // Pixels to trigger delete

/**
 * Get status indicator color based on connection state
 */
function getStatusColor(state: ConnectionState): string {
  switch (state) {
    case 'connected': return 'var(--color-success, #22c55e)'
    case 'connecting': return 'var(--color-warning, #f59e0b)'
    case 'error': return 'var(--color-error, #ef4444)'
    default: return 'var(--text-tertiary, #666)'
  }
}

/**
 * Get status text based on connection state
 */
function getStatusText(state: ConnectionState): string {
  switch (state) {
    case 'connected': return 'Connected'
    case 'connecting': return 'Connecting...'
    case 'error': return 'Connection Error'
    default: return 'Disconnected'
  }
}

export function HostSelector({
  onConnect,
  onDisconnect,
  className = ''
}: HostSelectorProps): React.ReactElement {
  const [showScanner, setShowScanner] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [swipeState, setSwipeState] = useState<SwipeState>({
    hostId: null,
    startX: 0,
    currentX: 0,
    isDeleting: false
  })

  const {
    hosts,
    connectionState,
    currentHost,
    addHost,
    removeHost,
    connect,
    disconnect
  } = useHostConnection()

  const hostRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Handle successful QR scan
  const handleScan = useCallback((connection: ParsedConnectionUrl) => {
    setShowScanner(false)
    setScanError(null)

    // Generate a name from the host
    const name = `${connection.host}:${connection.port}`

    const newHost = addHost({
      name,
      host: connection.host,
      port: connection.port,
      token: connection.token
    })

    // Auto-connect to the new host
    connect(newHost.id)
    onConnect?.(newHost)
  }, [addHost, connect, onConnect])

  // Handle scan error
  const handleScanError = useCallback((error: string) => {
    setScanError(error)
  }, [])

  // Handle host tap to connect
  const handleHostTap = useCallback((host: HostConfig) => {
    if (swipeState.hostId) return // Ignore taps during swipe

    if (currentHost?.id === host.id && connectionState === 'connected') {
      disconnect()
      onDisconnect?.()
    } else {
      connect(host.id)
      onConnect?.(host)
    }
  }, [swipeState.hostId, currentHost, connectionState, connect, disconnect, onConnect, onDisconnect])

  // Swipe gesture handlers
  const handleTouchStart = useCallback((e: React.TouchEvent, hostId: string) => {
    const touch = e.touches[0]
    setSwipeState({
      hostId,
      startX: touch.clientX,
      currentX: touch.clientX,
      isDeleting: false
    })
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swipeState.hostId) return

    const touch = e.touches[0]
    const deltaX = touch.clientX - swipeState.startX

    // Only allow swipe left (negative delta)
    if (deltaX < 0) {
      setSwipeState(prev => ({
        ...prev,
        currentX: touch.clientX,
        isDeleting: Math.abs(deltaX) >= SWIPE_THRESHOLD
      }))
    }
  }, [swipeState.hostId, swipeState.startX])

  const handleTouchEnd = useCallback(() => {
    if (!swipeState.hostId) return

    if (swipeState.isDeleting) {
      // Delete the host
      removeHost(swipeState.hostId)
    }

    // Reset swipe state
    setSwipeState({
      hostId: null,
      startX: 0,
      currentX: 0,
      isDeleting: false
    })
  }, [swipeState.hostId, swipeState.isDeleting, removeHost])

  // Calculate swipe offset for a host
  const getSwipeOffset = (hostId: string): number => {
    if (swipeState.hostId !== hostId) return 0
    const delta = swipeState.currentX - swipeState.startX
    return Math.min(0, delta) // Only allow negative (left swipe)
  }

  // Close scanner
  const handleCloseScanner = useCallback(() => {
    setShowScanner(false)
    setScanError(null)
  }, [])

  // Clear scan error after delay
  useEffect(() => {
    if (scanError) {
      const timer = setTimeout(() => setScanError(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [scanError])

  // Render QR scanner
  if (showScanner) {
    return (
      <QRScanner
        onScan={handleScan}
        onCancel={handleCloseScanner}
        onError={handleScanError}
      />
    )
  }

  return (
    <div className={`host-selector ${className}`}>
      {/* Header */}
      <div className="host-selector__header">
        <h2 className="host-selector__title">Saved Hosts</h2>

        {/* Current connection status */}
        {currentHost && (
          <div className="host-selector__current-status">
            <span
              className="host-selector__status-dot"
              style={{ backgroundColor: getStatusColor(connectionState) }}
            />
            <span className="host-selector__status-text">
              {getStatusText(connectionState)}
            </span>
          </div>
        )}
      </div>

      {/* Error message */}
      {scanError && (
        <div className="host-selector__error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          {scanError}
        </div>
      )}

      {/* Host list */}
      <div className="host-selector__list">
        {hosts.length === 0 ? (
          <div className="host-selector__empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <p>No hosts saved</p>
            <p className="host-selector__empty-hint">
              Scan a QR code to connect to your computer
            </p>
          </div>
        ) : (
          hosts.map((host) => {
            const isCurrentHost = currentHost?.id === host.id
            const swipeOffset = getSwipeOffset(host.id)
            const isDeleting = swipeState.hostId === host.id && swipeState.isDeleting

            return (
              <div
                key={host.id}
                className="host-selector__item-wrapper"
                onTouchStart={(e) => handleTouchStart(e, host.id)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                {/* Delete indicator (revealed by swipe) */}
                <div className={`host-selector__delete-indicator ${isDeleting ? 'host-selector__delete-indicator--active' : ''}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                  Delete
                </div>

                {/* Host item */}
                <div
                  ref={(el) => {
                    if (el) hostRefs.current.set(host.id, el)
                    else hostRefs.current.delete(host.id)
                  }}
                  className={`host-selector__item ${isCurrentHost ? 'host-selector__item--active' : ''}`}
                  style={{ transform: `translateX(${swipeOffset}px)` }}
                  onClick={() => handleHostTap(host)}
                >
                  {/* Status indicator */}
                  <span
                    className="host-selector__item-status"
                    style={{
                      backgroundColor: isCurrentHost
                        ? getStatusColor(connectionState)
                        : 'var(--text-tertiary, #666)'
                    }}
                  />

                  {/* Host info */}
                  <div className="host-selector__item-info">
                    <span className="host-selector__item-name">{host.name}</span>
                    <span className="host-selector__item-address">
                      {host.host}:{host.port}
                    </span>
                    {host.lastConnected && (
                      <span className="host-selector__item-last-connected">
                        Last connected: {new Date(host.lastConnected).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  {/* Connection arrow */}
                  <svg
                    className="host-selector__item-arrow"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    width="20"
                    height="20"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Add host button */}
      <button
        className="host-selector__add-button"
        onClick={() => setShowScanner(true)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
          {/* QR code icon */}
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="3" height="3" />
          <rect x="18" y="14" width="3" height="3" />
          <rect x="14" y="18" width="3" height="3" />
          <rect x="18" y="18" width="3" height="3" />
        </svg>
        Scan QR Code to Add Host
      </button>
    </div>
  )
}

export default HostSelector
