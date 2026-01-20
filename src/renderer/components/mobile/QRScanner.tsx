import React, { useState, useCallback, useEffect } from 'react'
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'

export interface ParsedConnectionUrl {
  host: string
  port: number
  token: string
  // v2 security fields
  version?: number
  fingerprint?: string
  nonce?: string
  nonceExpires?: number
}

interface QRScannerProps {
  onScan: (connection: ParsedConnectionUrl) => void
  onCancel: () => void
  onError?: (error: string) => void
}

/**
 * V2 QR code JSON format
 */
interface QRCodeV2 {
  type: 'claude-terminal'
  version: 2
  host: string
  port: number
  token: string
  fingerprint: string
  nonce: string
  nonceExpires: number
}

/**
 * Parse connection data from QR code
 * Supports both v1 (URL format) and v2 (JSON format)
 */
export function parseConnectionUrl(data: string): ParsedConnectionUrl | null {
  // Try parsing as JSON (v2 format)
  try {
    const parsed = JSON.parse(data)
    if (parsed.type === 'claude-terminal' && parsed.version === 2) {
      const v2 = parsed as QRCodeV2

      // Validate required fields
      if (!v2.host || !v2.token || !v2.fingerprint || !v2.nonce) {
        return null
      }

      // Check if nonce has expired
      if (v2.nonceExpires && Date.now() > v2.nonceExpires) {
        return null // Expired nonce
      }

      return {
        host: v2.host,
        port: v2.port || 38470,
        token: v2.token,
        version: 2,
        fingerprint: v2.fingerprint,
        nonce: v2.nonce,
        nonceExpires: v2.nonceExpires
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
