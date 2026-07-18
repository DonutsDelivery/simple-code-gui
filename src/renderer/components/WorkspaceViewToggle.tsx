import React from 'react'
import type { WorkspaceView } from '../stores/workspace'

interface WorkspaceViewToggleProps {
  value: WorkspaceView
  onChange: (view: WorkspaceView) => void
}

export function WorkspaceViewToggle({ value, onChange }: WorkspaceViewToggleProps): React.ReactElement {
  return (
    <div className="workspace-view-toggle" role="group" aria-label="Workspace view">
      <button
        type="button"
        className={value === 'tiles' ? 'active' : ''}
        aria-pressed={value === 'tiles'}
        onClick={() => onChange('tiles')}
      >
        Tiles
      </button>
      <button
        type="button"
        className={value === 'canvas' ? 'active' : ''}
        aria-pressed={value === 'canvas'}
        onClick={() => onChange('canvas')}
      >
        Canvas
      </button>
    </div>
  )
}
