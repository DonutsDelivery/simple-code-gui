import React, { useState, useCallback, useEffect, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'

interface HostQRDisplayProps {
  port: number
  onTokenChange?: (token: string) => void
  className?: string
}

/**
 * Generate a random secure token (fallback for non-Electron environments)
 */
function generateToken(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => chars[byte % chars.length]).join('')
}

/**
 * Format a timestamp as time remaining
 */
function formatTimeRemaining(expiresAt: number): string {
  const now = Date.now()
  const remaining = Math.max(0, expiresAt - now)
  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Get local IP addresses
 */
async function getLocalIPs(): Promise<string[]> {
  const ips: string[] = []

  try {
    // Try using RTCPeerConnection to discover local IPs
    const rtc = new RTCPeerConnection({ iceServers: [] })
    rtc.createDataChannel('')

    const offer = await rtc.createOffer()
    await rtc.setLocalDescription(offer)

    // Wait for ICE candidates
    await new Promise<void>((resolve) => {
      rtc.onicecandidate = (event) => {
        if (!event.candidate) {
          resolve()
          return
        }

        const candidate = event.candidate.candidate
        const ipMatch = candidate.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)

        if (ipMatch && ipMatch[1] && !ips.includes(ipMatch[1])) {
          // Filter out localhost and link-local addresses
          const ip = ipMatch[1]
          if (!ip.startsWith('127.') && !ip.startsWith('169.254.')) {
            ips.push(ip)
          }
        }
      }

      // Timeout after 1 second
      setTimeout(resolve, 1000)
    })

    rtc.close()
  } catch {
    // RTCPeerConnection not available or failed
  }

  // Add localhost as fallback
  if (ips.length === 0) {
    ips.push('localhost')
  }

  return ips
}

export function HostQRDisplay({
  port: _port, // Ignored - we get port from server
  onTokenChange,
  className = ''
}: HostQRDisplayProps): React.ReactElement {
  const [token, setToken] = useState<string>('')
  const [localIPs, setLocalIPs] = useState<string[]>(['Detecting...'])
  const [serverPort, setServerPort] = useState<number>(38470)
  const [copied, setCopied] = useState(false)
  // v2 security fields
  const [fingerprint, setFingerprint] = useState<string>('')
  const [formattedFingerprint, setFormattedFingerprint] = useState<string>('')
  const [qrData, setQrData] = useState<string>('')
  const [nonceExpires, setNonceExpires] = useState<number>(0)
  const [timeRemaining, setTimeRemaining] = useState<string>('')
  const nonceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Refresh QR code with new nonce
  const refreshQRCode = useCallback(async () => {
    if (window.electronAPI?.mobileGetConnectionInfo) {
      try {
        const info = await window.electronAPI?.mobileGetConnectionInfo()
        setToken(info.token)
        setLocalIPs(info.ips.length > 0 ? info.ips : ['localhost'])
        setServerPort(info.port)
        setFingerprint(info.fingerprint)
        setFormattedFingerprint(info.formattedFingerprint)
        setQrData(info.qrData)
        setNonceExpires(info.nonceExpires)
      } catch (e) {
        console.error('Failed to get mobile connection info:', e)
      }
    }
  }, [])

  // Get connection info from mobile server on mount
  useEffect(() => {
    const loadConnectionInfo = async () => {
      if (window.electronAPI?.mobileGetConnectionInfo) {
        try {
          const info = await window.electronAPI?.mobileGetConnectionInfo()
          setToken(info.token)
          setLocalIPs(info.ips.length > 0 ? info.ips : ['localhost'])
          setServerPort(info.port)
          setFingerprint(info.fingerprint)
          setFormattedFingerprint(info.formattedFingerprint)
          setQrData(info.qrData)
          setNonceExpires(info.nonceExpires)
        } catch (e) {
          console.error('Failed to get mobile connection info:', e)
          // Fallback to local discovery
          getLocalIPs().then((ips) => {
            setLocalIPs(ips)
          })
          setToken(generateToken())
        }
      } else {
        // Not in Electron, use local discovery
        getLocalIPs().then((ips) => {
          setLocalIPs(ips)
        })
        setToken(generateToken())
      }
    }
    loadConnectionInfo()
  }, [])

  // Update time remaining countdown
  useEffect(() => {
    if (nonceExpires > 0) {
      // Clear existing timer
      if (nonceTimerRef.current) {
        clearInterval(nonceTimerRef.current)
      }

      // Update immediately
      setTimeRemaining(formatTimeRemaining(nonceExpires))

      // Start countdown timer
      nonceTimerRef.current = setInterval(() => {
        const remaining = nonceExpires - Date.now()
        if (remaining <= 0) {
          // Nonce expired, refresh automatically
          refreshQRCode()
        } else {
          setTimeRemaining(formatTimeRemaining(nonceExpires))
        }
      }, 1000)

      return () => {
        if (nonceTimerRef.current) {
          clearInterval(nonceTimerRef.current)
        }
      }
    }
  }, [nonceExpires, refreshQRCode])

  // Notify parent when token changes
  useEffect(() => {
    if (token) {
      onTokenChange?.(token)
    }
  }, [token, onTokenChange])

  // Generate the connection URL (v1 format for backward compatibility display)
  const connectionUrl = `claude-terminal://${localIPs[0] || 'localhost'}:${serverPort}?token=${token}`

  // Regenerate token via server (also refreshes nonce)
  const handleRegenerateToken = useCallback(async () => {
    if (window.electronAPI?.mobileRegenerateToken) {
      try {
        const info = await window.electronAPI?.mobileRegenerateToken()
        setToken(info.token)
        setFingerprint(info.fingerprint)
        setFormattedFingerprint(info.formattedFingerprint)
        setQrData(info.qrData)
        setNonceExpires(info.nonceExpires)
        setCopied(false)
      } catch (e) {
        console.error('Failed to regenerate token:', e)
      }
    } else {
      const newToken = generateToken()
      setToken(newToken)
      setCopied(false)
    }
  }, [])

  // Copy URL to clipboard
  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(connectionUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available
    }
  }, [connectionUrl])

  return (
    <div className={`host-qr-display ${className}`}>
      {/* Title */}
      <div className="host-qr-display__header">
        <h3 className="host-qr-display__title">Connect Mobile Device</h3>
        <p className="host-qr-display__subtitle">
          Scan this QR code with the Claude Terminal mobile app
        </p>
      </div>

      {/* QR Code - uses v2 JSON format for security */}
      <div className="host-qr-display__qr-container">
        <QRCodeSVG
          value={qrData || connectionUrl}
          size={200}
          level="M"
          includeMargin
        />
        {timeRemaining && (
          <div className="host-qr-display__qr-timer">
            Expires in {timeRemaining}
          </div>
        )}
      </div>

      {/* Connection Details */}
      <div className="host-qr-display__details">
        {/* Server Fingerprint */}
        {formattedFingerprint && (
          <div className="host-qr-display__field host-qr-display__field--full">
            <label className="host-qr-display__label">Server Fingerprint</label>
            <span className="host-qr-display__value host-qr-display__value--mono host-qr-display__value--fingerprint">
              {formattedFingerprint}
            </span>
            <span className="host-qr-display__hint">
              Mobile app will verify this fingerprint on first connect
            </span>
          </div>
        )}

        {/* IP Addresses (all included in QR) */}
        <div className="host-qr-display__field">
          <label className="host-qr-display__label">Available IPs (tries all)</label>
          <span className="host-qr-display__value host-qr-display__value--ips">
            {localIPs.join(', ')}
          </span>
        </div>

        {/* Port */}
        <div className="host-qr-display__field">
          <label className="host-qr-display__label">Port</label>
          <span className="host-qr-display__value">{serverPort}</span>
        </div>

        {/* Token (partially hidden) */}
        <div className="host-qr-display__field">
          <label className="host-qr-display__label">Token</label>
          <span className="host-qr-display__value host-qr-display__value--mono">
            {token.slice(0, 8)}...{token.slice(-4)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="host-qr-display__actions">
        <button
          className="host-qr-display__button host-qr-display__button--secondary"
          onClick={refreshQRCode}
          title="Refresh QR code with new nonce"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          Refresh QR
        </button>

        <button
          className="host-qr-display__button host-qr-display__button--warning"
          onClick={handleRegenerateToken}
          title="Generate new token (invalidates existing connections)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          New Token
        </button>

        <button
          className="host-qr-display__button host-qr-display__button--primary"
          onClick={handleCopyUrl}
        >
          {copied ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              Copy URL
            </>
          )}
        </button>
      </div>

      {/* URL Display */}
      <div className="host-qr-display__url">
        <code className="host-qr-display__url-text">{connectionUrl}</code>
      </div>
    </div>
  )
}

export default HostQRDisplay
