import React from 'react'

interface Extension {
  id: string
  name: string
  type: string
}

interface ExtensionsSettingsProps {
  installedExtensions: Extension[]
}

export function ExtensionsSettings({ installedExtensions }: ExtensionsSettingsProps): React.ReactElement {
  const skillCount = installedExtensions.filter(e => e.type === 'skill').length
  const mcpCount = installedExtensions.filter(e => e.type === 'mcp').length
  const agentCount = installedExtensions.filter(e => e.type === 'agent').length

  return (
    <div className="form-group">
      <label>Extensions</label>
      <p className="form-hint">
        Skills, MCPs, and Agents extend Claude Code's capabilities.
      </p>
      <div className="extensions-summary">
        {installedExtensions.length > 0 ? (
          <div className="extension-counts">
            <span className="ext-count">
              <strong>{skillCount}</strong> Skills
            </span>
            <span className="ext-count">
              <strong>{mcpCount}</strong> MCPs
            </span>
            <span className="ext-count">
              <strong>{agentCount}</strong> Agents
            </span>
          </div>
        ) : (
          <p className="no-extensions">No extensions installed yet.</p>
        )}
        <p className="form-hint" style={{ marginTop: '8px', fontSize: '12px' }}>
          Right-click a project in the sidebar and select "Extensions..." to manage extensions for that project.
        </p>
      </div>
    </div>
  )
}
