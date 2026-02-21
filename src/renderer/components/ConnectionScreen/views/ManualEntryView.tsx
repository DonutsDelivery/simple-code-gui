/**
 * ManualEntryView - Form for manual connection entry
 */

import React from 'react'
import type { ViewState } from '../types.js'

interface ManualEntryViewProps {
  manualHost: string
  manualPort: string
  manualToken: string
  error: string | null
  setManualHost: (host: string) => void
  setManualPort: (port: string) => void
  setManualToken: (token: string) => void
  setError: (error: string | null) => void
  setView: (view: ViewState) => void
  onSubmit: (e: React.FormEvent) => void
}

export function ManualEntryView({
  manualHost,
  manualPort,
  manualToken,
  error,
  setManualHost,
  setManualPort,
  setManualToken,
  setError,
  setView,
  onSubmit
}: ManualEntryViewProps): React.ReactElement {
  return (
    <div className="app">
      <div className="empty-state">
        <div className="mobile-logo">◇</div>
        <h2>Manual Connection</h2>
        <p>Enter the connection details from your desktop app.</p>

        <form onSubmit={onSubmit} className="connection-form">
          <div className="form-group">
            <label htmlFor="host">Host</label>
            <input
              id="host"
              type="text"
              value={manualHost}
              onChange={(e) => setManualHost(e.target.value)}
              placeholder="192.168.1.100"
              autoComplete="off"
            />
          </div>

          <div className="form-group">
            <label htmlFor="port">Port</label>
            <input
              id="port"
              type="number"
              value={manualPort}
              onChange={(e) => setManualPort(e.target.value)}
              placeholder="38470"
              min="1"
              max="65535"
            />
          </div>

          <div className="form-group">
            <label htmlFor="token">Token</label>
            <input
              id="token"
              type="password"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="Connection token"
              autoComplete="off"
            />
          </div>

          {error && <p className="error-message">{error}</p>}

          <div className="mobile-btn-group">
            <button type="submit" className="mobile-btn">
              Connect
            </button>
            <button
              type="button"
              className="mobile-btn mobile-btn--secondary"
              onClick={() => {
                setError(null)
                setView('welcome')
              }}
            >
              Back
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
