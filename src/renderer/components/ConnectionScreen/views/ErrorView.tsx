/**
 * ErrorView - Connection error display with retry options
 */

import React from 'react'
import type { ConnectionConfig, ViewState } from '../types.js'

interface ErrorViewProps {
  error: string | null
  lastAttemptedConfig: ConnectionConfig | null
  retryCount: number
  onRetry: () => void
  setView: (view: ViewState) => void
  setError: (error: string | null) => void
}

export function ErrorView({
  error,
  lastAttemptedConfig,
  retryCount,
  onRetry,
  setView,
  setError
}: ErrorViewProps): React.ReactElement {
  return (
    <div className="app">
      <div className="empty-state">
        <div className="mobile-logo mobile-logo--error">✕</div>
        <h2>Connection Failed</h2>
        <p className="error-message">{error || 'Unknown error'}</p>

        {lastAttemptedConfig && (
          <p className="connection-details">
            {lastAttemptedConfig.host}:{lastAttemptedConfig.port}
            {retryCount > 0 && ` (attempt ${retryCount + 1})`}
          </p>
        )}

        <div className="mobile-btn-group">
          {lastAttemptedConfig && (
            <button className="mobile-btn" onClick={onRetry}>
              Retry Connection
            </button>
          )}
          <button
            className={lastAttemptedConfig ? "mobile-btn mobile-btn--secondary" : "mobile-btn"}
            onClick={() => setView('scanning')}
          >
            Scan New QR Code
          </button>
          <button
            className="mobile-btn mobile-btn--secondary"
            onClick={() => {
              setError(null)
              setView('welcome')
            }}
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  )
}
