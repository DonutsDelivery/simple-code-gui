import React from 'react'
import { WHISPER_MODELS } from './settingsTypes'
import type { WhisperModelSize } from '../../contexts/VoiceContext'

interface VoiceInputSettingsProps {
  whisperStatus: { installed: boolean; models: string[]; currentModel: string | null }
  activeWhisperModel: WhisperModelSize
  installingModel: string | null
  onSetActiveModel: (model: WhisperModelSize) => void
  onInstallModel: (model: string) => void
}

export function VoiceInputSettings({
  whisperStatus,
  activeWhisperModel,
  installingModel,
  onSetActiveModel,
  onInstallModel,
}: VoiceInputSettingsProps): React.ReactElement {
  return (
    <div className="form-group">
      <label>Voice Input (Speech-to-Text)</label>
      <p className="form-hint">
        Whisper models for transcribing your voice. Larger = more accurate but slower.
      </p>
      <div className="voice-options">
        {WHISPER_MODELS.map((model) => {
          const isInstalled = whisperStatus.models.includes(model.value)
          const isInstalling = installingModel === model.value
          const isActive = activeWhisperModel === model.value
          return (
            <div
              key={model.value}
              className={`voice-option ${isInstalled ? 'installed' : ''} ${isActive ? 'selected' : ''}`}
              onClick={() => isInstalled && onSetActiveModel(model.value)}
              style={{ cursor: isInstalled ? 'pointer' : 'default' }}
            >
              <div className="voice-info">
                <span className="voice-label">{model.label}</span>
                <span className="voice-desc">{model.desc}</span>
              </div>
              {isInstalled ? (
                <span className="voice-status installed">{isActive ? '● Active' : 'Installed'}</span>
              ) : (
                <button
                  className="voice-install-btn"
                  onClick={(e) => { e.stopPropagation(); onInstallModel(model.value) }}
                  disabled={isInstalling}
                >
                  {isInstalling ? 'Installing...' : 'Install'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
