import React from 'react'

interface VoiceOptionsPanelProps {
  volume: number
  speed: number
  skipOnNew: boolean
  onVolumeChange: (volume: number) => void
  onSpeedChange: (speed: number) => void
  onSkipOnNewChange: (skipOnNew: boolean) => void
}

export const VoiceOptionsPanel = React.memo(function VoiceOptionsPanel({
  volume,
  speed,
  skipOnNew,
  onVolumeChange,
  onSpeedChange,
  onSkipOnNewChange,
}: VoiceOptionsPanelProps) {
  return (
    <div className="voice-options">
      <div className="voice-slider-row">
        <span className="voice-option-icon" title="Volume">
          🔊
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="voice-slider"
        />
        <span className="voice-slider-value">{Math.round(volume * 100)}%</span>
      </div>
      <div className="voice-slider-row">
        <span className="voice-option-icon" title="Speed">
          ⏩
        </span>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={speed}
          onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
          className="voice-slider"
        />
        <span className="voice-slider-value">{speed.toFixed(1)}x</span>
      </div>
      <label className="voice-option-checkbox" title="Skip to latest message instead of queuing">
        <input
          type="checkbox"
          checked={skipOnNew}
          onChange={(e) => onSkipOnNewChange(e.target.checked)}
        />
        <span>Skip to new</span>
      </label>
    </div>
  )
})
