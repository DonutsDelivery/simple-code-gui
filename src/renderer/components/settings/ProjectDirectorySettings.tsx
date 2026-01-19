import React from 'react'

interface ProjectDirectorySettingsProps {
  defaultProjectDir: string
  onChange: (dir: string) => void
}

export function ProjectDirectorySettings({ defaultProjectDir, onChange }: ProjectDirectorySettingsProps): React.ReactElement {
  async function handleSelectDirectory(): Promise<void> {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) {
      onChange(dir)
    }
  }

  return (
    <div className="form-group">
      <label>Default Project Directory</label>
      <div className="input-with-button">
        <input
          type="text"
          value={defaultProjectDir}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Select a directory..."
          readOnly
        />
        <button className="browse-btn" onClick={handleSelectDirectory}>
          Browse
        </button>
      </div>
      <p className="form-hint">
        New projects created with "Make Project" will be placed here.
      </p>
    </div>
  )
}
