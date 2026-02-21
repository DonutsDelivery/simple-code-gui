import React, { useState, useCallback, useEffect } from 'react'
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'

export interface ParsedConnectionUrl {
  host: string
  hosts?: string[]  // Multiple IPs for fallback connection attempts
  port: number
  token: string
  // v2 security fields
  version?: number
  fingerprint?: string
  nonce?: string
  nonceExpires?: number
  // v3 security fields (TLS certificate pinning)
  certFingerprint?: string
  secure?: boolean
}

interface QRScannerProps {
  onScan: (connection: ParsedConnectionUrl) => void
  onCancel: () => void
  onError?: (error: string) => void
}

/**
 * V2/V3 QR code JSON format
 * V3 adds TLS certificate pinning fields
 */
interface QRCodePayload {
  type: 'claude-terminal'
  version: 2 | 3
  host: string
  hosts?: string[]  // Multiple IPs for fallback connection attempts
  port: number
  token: string
  fingerprint: string
  nonce: string
  nonceExpires: number
  // v3 TLS fields
  certFingerprint?: string
  secure?: boolean
}

/**
 * Parse connection data from QR code
 * Supports v1 (URL format), v2 (JSON), and v3 (JSON with TLS)
 */
export function parseConnectionUrl(data: string): ParsedConnectionUrl | null {
  // Try parsing as JSON (v2/v3 format)
  try {
    const parsed = JSON.parse(data)
    if (parsed.type === 'claude-terminal' && (parsed.version === 2 || parsed.version === 3)) {
      const qr = parsed as QRCodePayload

      // Validate required fields
      if (!qr.host || !qr.token || !qr.fingerprint || !qr.nonce) {
        return null
      }

      // Check if nonce has expired
      if (qr.nonceExpires && Date.now() > qr.nonceExpires) {
        return null // Expired nonce
      }

      return {
        host: qr.host,
        hosts: qr.hosts,  // Include all IPs for multi-IP connection attempts
        port: qr.port || 38470,
        token: qr.token,
        version: qr.version,
        fingerprint: qr.fingerprint,
        nonce: qr.nonce,
        nonceExpires: qr.nonceExpires,
        // v3 TLS fields
        certFingerprint: qr.certFingerprint,
        secure: qr.secure
      }
    }
  } catch {
    // Not JSON, try v1 URL format
  }

  // Try parsing as URL (v1 format for backward compatibility)
  try {
    // Handle custom protocol
    const urlToParse = data.replace('claude-terminal://', 'https://')
    const parsed = new URL(urlToParse)

    const host = parsed.hostname
    const port = parseInt(parsed.port, 10) || 38470 // Default port
    const token = parsed.searchParams.get('token')

    if (!host || !token) {
      return null
    }

    return { host, port, token, version: 1 }
  } catch {
    return null
  }
}

export function QRScanner({ onScan, onCancel, onError }: QRScannerProps): React.ReactElement {
  const [scanning, setScanning] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)

  const doScan = useCallback(async () => {
    try {
      // Check camera permission
      const { camera } = await BarcodeScanner.checkPermissions()

      if (camera !== 'granted') {
        const { camera: newPermission } = await BarcodeScanner.requestPermissions()
        if (newPermission !== 'granted') {
          setPermissionDenied(true)
          onError?.('Camera permission denied')
          return
        }
      }

      setScanning(true)

      // Hide app content so camera shows through (like LocalBooru does)
      document.body.classList.add('barcode-scanner-active')

      // Use the simple scan() method that returns a Promise
      const result = await BarcodeScanner.scan()

      // Restore app visibility
      document.body.classList.remove('barcode-scanner-active')
      setScanning(false)

      if (!result.barcodes || result.barcodes.length === 0) {
        onError?.('No QR code found')
        onCancel()
        return
      }

      const rawValue = result.barcodes[0].rawValue
      if (!rawValue) {
        onError?.('Empty QR code')
        onCancel()
        return
      }

      const parsed = parseConnectionUrl(rawValue)
      if (parsed) {
        onScan(parsed)
      } else {
        // Check if it was an expired nonce
        try {
          const data = JSON.parse(rawValue)
          if (data.type === 'claude-terminal' && data.nonceExpires && Date.now() > data.nonceExpires) {
            onError?.('QR code has expired. Please refresh the QR code on the host device.')
            onCancel()
            return
          }
        } catch {
          // Not JSON, continue with generic error
        }
        onError?.('Invalid QR code format')
        onCancel()
      }
    } catch (err) {
      document.body.classList.remove('barcode-scanner-active')
      setScanning(false)
      const message = err instanceof Error ? err.message : 'Failed to scan QR code'
      onError?.(message)
      onCancel()
    }
  }, [onScan, onCancel, onError])

  // Start scanning when component mounts
  useEffect(() => {
    doScan()

    // Cleanup on unmount
    return () => {
      document.body.classList.remove('barcode-scanner-active')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Render permission denied state
  if (permissionDenied) {
    return (
      <div className="qr-scanner qr-scanner--error">
        <div className="qr-scanner__message">
          <svg
            className="qr-scanner__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M15 9l-6 6M9 9l6 6" />
          </svg>
          <h2>Camera Permission Required</h2>
          <p>Please enable camera access in your device settings to scan QR codes.</p>
          <button
            className="qr-scanner__button qr-scanner__button--secondary"
            onClick={onCancel}
          >
            Go Back
          </button>
        </div>
      </div>
    )
  }

  // While scanning, render nothing - the native camera view takes over
  if (scanning) {
    return <></>
  }

  // Loading state before scan starts
  return (
    <div className="qr-scanner">
      <div className="qr-scanner__message">
        <h2>Starting camera...</h2>
      </div>
    </div>
  )
}

export default QRScanner
