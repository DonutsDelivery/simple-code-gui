import React from 'react'

interface ProjectDirectorySettingsProps {
  defaultProjectDir: string
  onChange: (dir: string) => void
}

export function ProjectDirectorySettings({ defaultProjectDir, onChange }: ProjectDirectorySettingsProps): React.ReactElement {
  const canBrowse = typeof window.electronAPI?.selectDirectory === 'function'

  async function handleSelectDirectory(): Promise<void> {
    const dir = await window.electronAPI?.selectDirectory()
    if (dir) {
      onChange(dir)
    }
  }

  return (
    <div className="form-group">
      <label htmlFor="default-project-directory">Default Project Directory</label>
      <div className="input-with-button">
        <input
          id="default-project-directory"
          type="text"
          value={defaultProjectDir}
          onChange={(e) => onChange(e.target.value)}
          placeholder={canBrowse ? 'Select a directory...' : '/path/on/connected/server'}
          readOnly={canBrowse}
        />
        {canBrowse && (
          <button className="browse-btn" onClick={handleSelectDirectory}>
            Browse
          </button>
        )}
      </div>
      <p className="form-hint">
        New projects created with "Make Project" will be placed here{canBrowse ? '.' : ' on the connected server.'}
      </p>
    </div>
  )
}
