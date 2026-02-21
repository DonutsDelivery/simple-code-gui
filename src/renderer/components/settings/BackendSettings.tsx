import React from 'react'
import { BACKEND_MODES } from './settingsTypes'

interface BackendSettingsProps {
  backend: string
  onChange: (backend: string) => void
}

export function BackendSettings({ backend, onChange }: BackendSettingsProps): React.ReactElement {
  return (
    <div className="form-group">
      <label>Backend</label>
      <p className="form-hint">
        The backend to use for the terminal sessions.
      </p>
      <div className="permission-mode-options">
        {BACKEND_MODES.map((mode) => (
          <label key={mode.value} className={`permission-mode-option ${backend === mode.value ? 'selected' : ''}`}>
            <input
              type="radio"
              name="backend"
              value={mode.value}
              checked={backend === mode.value}
              onChange={(e) => onChange(e.target.value)}
            />
            <span className="mode-label">{mode.label}</span>
            <span className="mode-desc">{mode.desc}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
