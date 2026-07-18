import React from 'react'
import type { AgentAttentionKind } from '../../stores/workspace'
import { playAgentNotificationSound } from '../../utils/agentNotificationAudio'

interface AgentNotificationSettingsProps {
  enabled: boolean
  volume: number
  onChange: (settings: { enabled: boolean; volume: number }) => void
}

export function AgentNotificationSettings({
  enabled,
  volume,
  onChange,
}: AgentNotificationSettingsProps): React.ReactElement {
  const testSound = (kind: AgentAttentionKind): void => {
    playAgentNotificationSound(kind, volume)
  }

  return (
    <div className="form-group agent-notification-settings">
      <label>Agent Notifications</label>
      <p className="form-hint">Distinct cues for completed work and sessions waiting for your input.</p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange({ enabled: event.target.checked, volume })}
        />
        Play notification sounds
      </label>
      <div className="slider-group">
        <div className="slider-header">
          <label htmlFor="agent-notification-volume">Volume</label>
          <span className="slider-value">{Math.round(volume * 100)}%</span>
        </div>
        <input
          id="agent-notification-volume"
          className="slider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          disabled={!enabled}
          onChange={(event) => onChange({ enabled, volume: Number(event.target.value) })}
        />
      </div>
      <div className="agent-notification-settings__tests">
        <button type="button" className="btn-secondary" disabled={!enabled} onClick={() => testSound('completed')}>
          Test completed
        </button>
        <button type="button" className="btn-secondary" disabled={!enabled} onClick={() => testSound('needs-input')}>
          Test needs input
        </button>
      </div>
    </div>
  )
}
