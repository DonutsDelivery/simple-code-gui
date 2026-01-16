import React from 'react'
import ReactDOM from 'react-dom'
import { Project } from '../../stores/workspace.js'

interface DeleteConfirmModalProps {
  project: Project
  onClose: () => void
  onConfirm: () => void
}

export function DeleteConfirmModal({ project, onClose, onConfirm }: DeleteConfirmModalProps) {
  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Remove Project?</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p>Are you sure you want to remove <strong>{project.name}</strong> from the app?</p>
          <p className="hint">This will only remove the project from this app. Your files will not be deleted.</p>
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm}>
            Remove Project
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
