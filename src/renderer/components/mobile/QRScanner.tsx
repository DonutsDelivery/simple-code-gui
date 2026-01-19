import React, { useState, useCallback, useEffect } from 'react'
import {
  BarcodeScanner,
  BarcodeFormat,
  LensFacing,
} from '@capacitor-mlkit/barcode-scanning'

export interface ParsedConnectionUrl {
  host: string
  port: number
  token: string
}

interface QRScannerProps {
  onScan: (connection: ParsedConnectionUrl) => void
  onCancel: () => void
  onError?: (error: string) => void
}

/**
 * Parse connection URL in format: claude-terminal://host:port?token=xxx
 */
export function parseConnectionUrl(url: string): ParsedConnectionUrl | null {
  try {
    // Handle custom protocol
    const urlToParse = url.replace('claude-terminal://', 'https://')
    const parsed = new URL(urlToParse)

    const host = parsed.hostname
    const port = parseInt(parsed.port, 10) || 38470 // Default port
    const token = parsed.searchParams.get('token')

    if (!host || !token) {
      return null
    }

    return { host, port, token }
  } catch {
    return null
  }
}

export function QRScanner({ onScan, onCancel, onError }: QRScannerProps): React.ReactElement {
  const [isScanning, setIsScanning] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)

  const startScanning = useCallback(async () => {
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

      setIsScanning(true)

      // Start scanning with ML Kit
      const listener = await BarcodeScanner.addListener('barcodeScanned', (result) => {
        const barcode = result.barcode
        if (barcode.rawValue) {
          const parsed = parseConnectionUrl(barcode.rawValue)

          if (parsed) {
            stopScanning()
            onScan(parsed)
          } else {
            onError?.('Invalid QR code format. Expected: claude-terminal://host:port?token=xxx')
          }
        }
      })

      await BarcodeScanner.startScan({
        formats: [BarcodeFormat.QrCode],
        lensFacing: LensFacing.Back,
      })

      // Store listener for cleanup
      return () => {
        listener.remove()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start scanner'
      onError?.(message)
      setIsScanning(false)
    }
  }, [onScan, onError])

  const stopScanning = useCallback(async () => {
    try {
      await BarcodeScanner.removeAllListeners()
      await BarcodeScanner.stopScan()
    } catch {
      // Ignore errors when stopping
    }
    setIsScanning(false)
  }, [])

  const handleCancel = useCallback(async () => {
    await stopScanning()
    onCancel()
  }, [stopScanning, onCancel])

  // Start scanning when component mounts
  useEffect(() => {
    startScanning()

    // Cleanup on unmount
    return () => {
      stopScanning()
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

  // Full-screen scanning view
  return (
    <div className={`qr-scanner ${isScanning ? 'qr-scanner--scanning' : ''}`}>
      {/* Scanning overlay with viewfinder */}
      <div className="qr-scanner__overlay">
        {/* Top dark area */}
        <div className="qr-scanner__mask qr-scanner__mask--top" />

        {/* Middle row with viewfinder */}
        <div className="qr-scanner__middle">
          <div className="qr-scanner__mask qr-scanner__mask--left" />

          {/* Viewfinder frame */}
          <div className="qr-scanner__viewfinder">
            <div className="qr-scanner__corner qr-scanner__corner--tl" />
            <div className="qr-scanner__corner qr-scanner__corner--tr" />
            <div className="qr-scanner__corner qr-scanner__corner--bl" />
            <div className="qr-scanner__corner qr-scanner__corner--br" />

            {/* Scanning line animation */}
            {isScanning && (
              <div className="qr-scanner__scan-line" />
            )}
          </div>

          <div className="qr-scanner__mask qr-scanner__mask--right" />
        </div>

        {/* Bottom dark area */}
        <div className="qr-scanner__mask qr-scanner__mask--bottom" />
      </div>

      {/* Instructions */}
      <div className="qr-scanner__instructions">
        <p>Point your camera at the QR code on your computer</p>
      </div>

      {/* Cancel button */}
      <button
        className="qr-scanner__button qr-scanner__button--cancel"
        onClick={handleCancel}
        aria-label="Cancel scanning"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="qr-scanner__cancel-icon"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
        Cancel
      </button>
    </div>
  )
}

export default QRScanner
