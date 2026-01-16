import React from 'react'
import ReactDOM from 'react-dom'
import { ProjectSettingsModalState, InstalledVoice } from './types.js'
import { COMMON_TOOLS, PERMISSION_MODES, API_SESSION_MODES, API_MODELS } from './constants.js'

interface ProjectSettingsModalProps {
  state: ProjectSettingsModalState
  globalPermissions: { tools: string[]; mode: string }
  globalVoiceSettings: { voice: string; engine: string }
  installedVoices: InstalledVoice[]
  onClose: () => void
  onSave: () => void
  onChange: (updates: Partial<ProjectSettingsModalState>) => void
  onToggleTool: (tool: string) => void
  onAllowAll: () => void
  onClearAll: () => void
}

export function ProjectSettingsModal({
  state,
  globalPermissions,
  globalVoiceSettings,
  installedVoices,
  onClose,
  onSave,
  onChange,
  onToggleTool,
  onAllowAll,
  onClearAll,
}: ProjectSettingsModalProps) {
  const handleVoiceChange = (value: string) => {
    if (!value) {
      onChange({ ttsVoice: '', ttsEngine: '' })
    } else {
      const [engine, ...voiceParts] = value.split(':')
      const voice = voiceParts.join(':')
      onChange({ ttsVoice: voice, ttsEngine: engine as 'piper' | 'xtts' })
    }
  }

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={() => !state.apiStatus && onClose()}>
      <div className="modal project-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Project Settings: {state.project.name}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-content">
          {/* API Settings Section */}
          <div className="settings-section">
            <h3>API Settings</h3>
            <p className="form-hint">Enable HTTP API to send prompts to this project's terminal.</p>

            <div className="form-group">
              <label>Port Number</label>
              <input
                type="number"
                min="1024"
                max="65535"
                value={state.apiPort}
                onChange={(e) => onChange({ apiPort: e.target.value, apiStatus: undefined, apiError: undefined })}
                placeholder="e.g., 3001 (leave empty to disable)"
                disabled={state.apiStatus === 'checking'}
                className={state.apiStatus === 'error' ? 'input-error' : ''}
              />
              {state.apiStatus === 'error' && (
                <p className="error-message">{state.apiError}</p>
              )}
            </div>

            <div className="form-group">
              <label>Session Mode</label>
              <p className="form-hint">How API requests handle terminal sessions.</p>
              <div className={`session-mode-options ${!state.apiPort ? 'disabled' : ''}`}>
                {API_SESSION_MODES.map((mode) => (
                  <label key={mode.value} className={`session-mode-option ${state.apiSessionMode === mode.value ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="apiSessionMode"
                      value={mode.value}
                      checked={state.apiSessionMode === mode.value}
                      onChange={(e) => onChange({ apiSessionMode: e.target.value as 'existing' | 'new-keep' | 'new-close' })}
                      disabled={!state.apiPort}
                    />
                    <span className="mode-label">{mode.label}</span>
                    <span className="mode-desc">{mode.desc}</span>
                  </label>
                ))}
              </div>
            </div>

            {state.apiSessionMode !== 'existing' && (
              <div className="form-group">
                <label>API Session Model</label>
                <p className="form-hint">Model for API-triggered sessions. Use cheaper models for automated workflows.</p>
                <div className={`session-mode-options ${!state.apiPort ? 'disabled' : ''}`}>
                  {API_MODELS.map((model) => (
                    <label key={model.value} className={`session-mode-option ${state.apiModel === model.value ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="apiModel"
                        value={model.value}
                        checked={state.apiModel === model.value}
                        onChange={(e) => onChange({ apiModel: e.target.value as 'default' | 'opus' | 'sonnet' | 'haiku' })}
                        disabled={!state.apiPort}
                      />
                      <span className="mode-label">{model.label}</span>
                      <span className="mode-desc">{model.desc}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {state.apiPort && (
              <p className="form-hint api-usage">
                Usage: <code>curl -X POST http://localhost:{state.apiPort}/prompt -d '{`{"prompt":"..."}`}'</code>
              </p>
            )}
          </div>

          {/* Permissions Section */}
          <div className="settings-section">
            <h3>Permissions</h3>
            <p className="form-hint">Override global permission settings for this project.</p>

            <div className="form-group">
              <label>Auto-Accept Tools</label>
              <div className="tool-chips">
                {COMMON_TOOLS.map((tool) => {
                  const isProjectSelected = state.tools.includes(tool.value)
                  const isGlobalSelected = globalPermissions.tools.includes(tool.value)
                  return (
                    <button
                      key={tool.value}
                      className={`tool-chip ${isProjectSelected ? 'selected' : ''} ${isGlobalSelected && !isProjectSelected ? 'global' : ''}`}
                      onClick={() => onToggleTool(tool.value)}
                      title={`${tool.value}${isGlobalSelected ? ' (enabled in global settings)' : ''}`}
                    >
                      {tool.label}
                      {isGlobalSelected && !isProjectSelected && <span className="global-indicator">G</span>}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="form-group">
              <label>Permission Mode</label>
              {globalPermissions.mode !== 'default' && state.permissionMode === 'default' && (
                <p className="form-hint global-hint">
                  Global: {PERMISSION_MODES.find(m => m.value === globalPermissions.mode)?.label}
                </p>
              )}
              <div className="permission-mode-options compact">
                {PERMISSION_MODES.map((mode) => {
                  const isGlobalMode = globalPermissions.mode === mode.value && state.permissionMode === 'default'
                  return (
                    <label key={mode.value} className={`permission-mode-option ${state.permissionMode === mode.value ? 'selected' : ''} ${isGlobalMode ? 'global' : ''}`}>
                      <input
                        type="radio"
                        name="permissionMode"
                        value={mode.value}
                        checked={state.permissionMode === mode.value}
                        onChange={(e) => onChange({ permissionMode: e.target.value })}
                      />
                      <span className="mode-label">{mode.label}</span>
                      <span className="mode-desc">{mode.desc}</span>
                      {isGlobalMode && <span className="global-indicator">G</span>}
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="permission-quick-actions">
              <button className="btn-danger-outline" onClick={onAllowAll}>
                Allow All
              </button>
              <button className="btn-secondary" onClick={onClearAll}>
                Clear All
              </button>
            </div>
          </div>

          {/* Backend Settings Section */}
          <div className="settings-section">
            <h3>Backend Settings</h3>
            <p className="form-hint">Override the global default backend for this project.</p>

            <div className="form-group">
              <div className="permission-mode-options compact">
                {[
                  { value: 'default', label: 'Use global default', desc: 'Uses the backend selected in the main settings.' },
                  { value: 'claude', label: 'Claude', desc: 'Forces this project to use Claude.' },
                  { value: 'gemini', label: 'Gemini', desc: 'Forces this project to use Gemini.' },
                  { value: 'codex', label: 'Codex', desc: 'Forces this project to use Codex.' },
                  { value: 'opencode', label: 'OpenCode', desc: 'Forces this project to use OpenCode.' },
                  { value: 'aider', label: 'Aider', desc: 'Forces this project to use Aider.' },
                ].map((backend) => (
                  <label key={backend.value} className={`permission-mode-option ${state.backend === backend.value ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="projectBackend"
                      value={backend.value}
                      checked={state.backend === backend.value}
                      onChange={(e) => onChange({ backend: e.target.value as typeof state.backend })}
                    />
                    <span className="mode-label">{backend.label}</span>
                    <span className="mode-desc">{backend.desc}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Voice Settings Section */}
          <div className="settings-section">
            <h3>Voice</h3>
            <p className="form-hint">Override global TTS voice for this project.</p>

            <div className="form-group">
              <label>TTS Voice</label>
              {globalVoiceSettings.voice && !state.ttsVoice && (
                <p className="form-hint global-hint">
                  Global: {installedVoices.find(v => v.key === globalVoiceSettings.voice)?.displayName || globalVoiceSettings.voice}
                </p>
              )}
              <select
                className="voice-select"
                value={state.ttsVoice ? `${state.ttsEngine}:${state.ttsVoice}` : ''}
                onChange={(e) => handleVoiceChange(e.target.value)}
              >
                <option value="">Use global voice</option>
                {installedVoices.length > 0 && (
                  <>
                    {installedVoices.filter(v => v.source !== 'xtts').length > 0 && (
                      <optgroup label="Piper Voices">
                        {installedVoices
                          .filter(v => v.source !== 'xtts')
                          .map(v => (
                            <option key={v.key} value={`piper:${v.key}`}>
                              {v.displayName}
                              {v.key === globalVoiceSettings.voice && globalVoiceSettings.engine === 'piper' ? ' (global)' : ''}
                            </option>
                          ))}
                      </optgroup>
                    )}
                    {installedVoices.filter(v => v.source === 'xtts').length > 0 && (
                      <optgroup label="XTTS Cloned Voices">
                        {installedVoices
                          .filter(v => v.source === 'xtts')
                          .map(v => (
                            <option key={v.key} value={`xtts:${v.key}`}>
                              {v.displayName}
                              {v.key === globalVoiceSettings.voice && globalVoiceSettings.engine === 'xtts' ? ' (global)' : ''}
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </>
                )}
              </select>
              {installedVoices.length === 0 && (
                <p className="form-hint">No voices installed. Install voices in Settings.</p>
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={state.apiStatus === 'checking'}>Cancel</button>
          <button className="btn-primary" onClick={onSave} disabled={state.apiStatus === 'checking'}>
            {state.apiStatus === 'checking' ? 'Checking...' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
