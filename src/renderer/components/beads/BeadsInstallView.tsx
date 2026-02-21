import React from 'react'
import type { BeadsState } from './useBeadsState.js'

interface BeadsInstallViewProps {
  beadsState: BeadsState
  onInstallPython: () => void
  onInstallBeads: () => void
  onInitBeads: () => void
}

export function BeadsInstallView({
  beadsState,
  onInstallPython,
  onInstallBeads,
  onInitBeads
}: BeadsInstallViewProps): React.ReactElement | null {
  if (beadsState.status === 'not_installed') {
    return (
      <div className="beads-empty">
        <p>Beads CLI (<code>bd</code>) not found.</p>
        {beadsState.installError && (
          <p className="beads-install-error" role="alert" aria-live="assertive">
            {beadsState.installError}
          </p>
        )}
        {beadsState.installStatus && (
          <p className="beads-install-status" role="status" aria-live="polite">
            {beadsState.installStatus}
          </p>
        )}
        <div className="beads-install-buttons">
          {beadsState.needsPython && (
            <button
              className="beads-init-btn"
              onClick={onInstallPython}
              disabled={beadsState.installing !== null}
            >
              {beadsState.installing === 'python' ? 'Installing Python...' : '1. Install Python'}
            </button>
          )}
          <button
            className="beads-init-btn"
            onClick={onInstallBeads}
            disabled={beadsState.installing !== null || beadsState.needsPython}
          >
            {beadsState.installing === 'beads'
              ? 'Installing...'
              : beadsState.needsPython
                ? '2. Install Beads'
                : 'Install Beads CLI'}
          </button>
        </div>
      </div>
    )
  }

  if (beadsState.status === 'not_initialized') {
    return (
      <div className="beads-empty">
        <p>No Beads initialized.</p>
        <button
          className="beads-init-btn"
          onClick={onInitBeads}
          disabled={beadsState.initializing}
        >
          {beadsState.initializing ? 'Initializing...' : 'Initialize Beads'}
        </button>
      </div>
    )
  }

  return null
}
