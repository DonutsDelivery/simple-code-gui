import React, { useState, useCallback, useMemo, useEffect } from 'react'

// Stub import - will be replaced with actual package
// import { QRCodeSVG } from 'qrcode.react'
const QRCodeSVG = ({ value, size, level, includeMargin }: {
  value: string
  size: number
  level?: string
  includeMargin?: boolean
}) => {
  // Stub placeholder - renders a styled placeholder
  return (
    <div
      style={{
        width: size,
        height: size,
        background: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--border-default)',
        borderRadius: 8,
        padding: includeMargin ? 16 : 0
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="currentColor">
        <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM13 13h2v2h-2zM15 15h2v2h-2zM13 17h2v2h-2zM17 13h2v2h-2zM19 15h2v2h-2zM17 17h2v2h-2zM15 19h2v2h-2zM19 19h2v2h-2z"/>
      </svg>
    </div>
  )
}

interface HostQRDisplayProps {
  port: number
  onTokenChange?: (token: string) => void
  className?: string
}

/**
 * Generate a random secure token
 */
function generateToken(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => chars[byte % chars.length]).join('')
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
  port,
  onTokenChange,
  className = ''
}: HostQRDisplayProps): React.ReactElement {
  const [token, setToken] = useState<string>(() => generateToken())
  const [localIPs, setLocalIPs] = useState<string[]>(['Detecting...'])
  const [selectedIP, setSelectedIP] = useState<string>('')
  const [copied, setCopied] = useState(false)

  // Discover local IPs on mount
  useEffect(() => {
    getLocalIPs().then((ips) => {
      setLocalIPs(ips)
      setSelectedIP(ips[0] || 'localhost')
    })
  }, [])

  // Notify parent when token changes
  useEffect(() => {
    onTokenChange?.(token)
  }, [token, onTokenChange])

  // Generate the connection URL
  const connectionUrl = useMemo(() => {
    const host = selectedIP || 'localhost'
    return `claude-terminal://${host}:${port}?token=${token}`
  }, [selectedIP, port, token])

  // Regenerate token
  const handleRegenerateToken = useCallback(() => {
    const newToken = generateToken()
    setToken(newToken)
    setCopied(false)
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

      {/* QR Code */}
      <div className="host-qr-display__qr-container">
        <QRCodeSVG
          value={connectionUrl}
          size={200}
          level="M"
          includeMargin
        />
      </div>

      {/* Connection Details */}
      <div className="host-qr-display__details">
        {/* IP Selection */}
        <div className="host-qr-display__field">
          <label className="host-qr-display__label">Local IP Address</label>
          {localIPs.length > 1 ? (
            <select
              className="host-qr-display__select"
              value={selectedIP}
              onChange={(e) => setSelectedIP(e.target.value)}
            >
              {localIPs.map((ip) => (
                <option key={ip} value={ip}>{ip}</option>
              ))}
            </select>
          ) : (
            <span className="host-qr-display__value">{selectedIP || localIPs[0]}</span>
          )}
        </div>

        {/* Port */}
        <div className="host-qr-display__field">
          <label className="host-qr-display__label">Port</label>
          <span className="host-qr-display__value">{port}</span>
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
          onClick={handleRegenerateToken}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          Regenerate Token
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
