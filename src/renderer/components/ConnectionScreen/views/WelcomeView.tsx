/**
 * WelcomeView - Initial connection screen with saved hosts and actions
 */

import React from 'react'
import type { SavedHost, ViewState } from '../types.js'

interface WelcomeViewProps {
  error: string | null
  savedHosts: SavedHost[]
  setView: (view: ViewState) => void
  onConnectToSavedHost: (host: SavedHost) => void
  onRemoveSavedHost: (e: React.MouseEvent, hostId: string) => void
}

export function WelcomeView({
  error,
  savedHosts,
  setView,
  onConnectToSavedHost,
  onRemoveSavedHost
}: WelcomeViewProps): React.ReactElement {
  return (
    <div className="app">
      <div className="empty-state">
        <div className="mobile-logo">◇</div>
        <h2>Claude Terminal</h2>
        <p>Connect to your desktop to start using Claude Terminal on this device.</p>

        {error && <p className="error-message">{error}</p>}

        {savedHosts.length > 0 && (
          <div className="saved-hosts-section">
            <h3 className="saved-hosts-title">Recent Hosts</h3>
            <div className="saved-hosts-list">
              {savedHosts.map(host => (
                <div
                  key={host.id}
                  className="saved-host-item"
                  onClick={() => onConnectToSavedHost(host)}
                >
                  <div className="saved-host-info">
                    <span className="saved-host-name">{host.name}</span>
                    <span className="saved-host-last">
                      {new Date(host.lastConnected).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    className="saved-host-remove"
                    onClick={(e) => onRemoveSavedHost(e, host.id)}
                    aria-label="Remove host"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mobile-btn-group">
          <button className="mobile-btn" onClick={() => setView('scanning')}>
            Scan QR Code
          </button>
          <button
            className="mobile-btn mobile-btn--secondary"
            onClick={() => setView('manual')}
          >
            Manual Entry
          </button>
        </div>

        <p className="install-note">
          Click the mobile icon in your desktop app's sidebar to show the QR code.
        </p>
      </div>
    </div>
  )
}
