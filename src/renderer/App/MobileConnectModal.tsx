import React from 'react'
import { HostQRDisplay } from '../components/HostQRDisplay'

interface MobileConnectModalProps {
  isOpen: boolean
  onClose: () => void
  port?: number
}

export function MobileConnectModal({ isOpen, onClose, port = 38470 }: MobileConnectModalProps): React.ReactElement | null {
  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal mobile-connect-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Connect Mobile Device</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-content">
          <HostQRDisplay port={port} />
        </div>
      </div>
    </div>
  )
}
