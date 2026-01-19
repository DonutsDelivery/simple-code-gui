import React, { useState } from 'react'

interface UninstallTTSSectionProps {
  removingTTS: boolean
  ttsRemovalResult: { success: number; failed: number } | null
  onRemove: () => Promise<void>
}

export function UninstallTTSSection({ removingTTS, ttsRemovalResult, onRemove }: UninstallTTSSectionProps): React.ReactElement {
  return (
    <div className="form-group">
      <label>Uninstall TTS</label>
      <p className="form-hint">
        Remove TTS voice output instructions from CLAUDE.md files in all projects.
        Use this if you want to stop using Claude Terminal altogether.
      </p>
      <button
        className="btn-danger"
        onClick={onRemove}
        disabled={removingTTS}
        style={{ marginTop: '8px' }}
      >
        {removingTTS ? 'Removing...' : 'Remove TTS from All Projects'}
      </button>
      {ttsRemovalResult && (
        <p className="form-hint" style={{ marginTop: '8px', color: ttsRemovalResult.failed > 0 ? 'var(--warning)' : 'var(--success)' }}>
          Removed from {ttsRemovalResult.success} project{ttsRemovalResult.success !== 1 ? 's' : ''}.
          {ttsRemovalResult.failed > 0 && ` Failed: ${ttsRemovalResult.failed}.`}
        </p>
      )}
    </div>
  )
}
