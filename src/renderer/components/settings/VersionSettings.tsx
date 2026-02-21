import React from 'react'
import type { UpdateStatus } from './settingsTypes'

interface VersionSettingsProps {
  appVersion?: string
  updateStatus?: UpdateStatus
  onDownloadUpdate?: () => void
  onInstallUpdate?: () => void
}

export function VersionSettings({
  appVersion,
  updateStatus,
  onDownloadUpdate,
  onInstallUpdate
}: VersionSettingsProps): React.ReactElement | null {
  if (!appVersion) return null

  return (
    <div className="form-group version-settings">
      <label>Version</label>
      <div className="version-info">
        <span className="version-current">v{appVersion}</span>

        {updateStatus?.status === 'available' && onDownloadUpdate && (
          <button
            className="btn-accent version-update-btn"
            onClick={onDownloadUpdate}
            title={`Update to v${updateStatus.version}`}
          >
            Update to v{updateStatus.version}
          </button>
        )}

        {updateStatus?.status === 'downloading' && (
          <span className="version-status downloading">
            Downloading... {updateStatus.progress ? `${Math.round(updateStatus.progress)}%` : ''}
          </span>
        )}

        {updateStatus?.status === 'downloaded' && onInstallUpdate && (
          <button
            className="btn-primary version-update-btn"
            onClick={onInstallUpdate}
            title="Restart and install update"
          >
            Restart to update
          </button>
        )}

        {updateStatus?.status === 'error' && (
          <span className="version-status error" title={updateStatus.error}>
            Update failed
          </span>
        )}

        {updateStatus?.status === 'idle' && (
          <span className="version-status">Up to date</span>
        )}
      </div>
    </div>
  )
}
