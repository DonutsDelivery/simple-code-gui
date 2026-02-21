/**
 * ConnectingView - Loading state during connection attempt
 */

import React from 'react'

export function ConnectingView(): React.ReactElement {
  return (
    <div className="app">
      <div className="empty-state">
        <div className="mobile-logo">◇</div>
        <h2>Connecting...</h2>
        <p>Establishing connection to your desktop host.</p>
        <div className="mobile-spinner" />
      </div>
    </div>
  )
}
