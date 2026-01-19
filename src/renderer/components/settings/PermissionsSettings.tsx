import React from 'react'
import { COMMON_TOOLS, PERMISSION_MODES } from './settingsTypes'

interface PermissionsSettingsProps {
  autoAcceptTools: string[]
  permissionMode: string
  customTool: string
  onToggleTool: (tool: string) => void
  onPermissionModeChange: (mode: string) => void
  onCustomToolChange: (tool: string) => void
  onAddCustomTool: () => void
  onRemoveCustomTool: (tool: string) => void
}

export function PermissionsSettings({
  autoAcceptTools,
  permissionMode,
  customTool,
  onToggleTool,
  onPermissionModeChange,
  onCustomToolChange,
  onAddCustomTool,
  onRemoveCustomTool,
}: PermissionsSettingsProps): React.ReactElement {
  const customTools = autoAcceptTools.filter(t => !COMMON_TOOLS.some(ct => ct.value === t))

  return (
    <>
      <div className="form-group">
        <label>Global Permissions</label>
        <p className="form-hint">
          Default permissions for all projects. Can be overridden per-project.
        </p>
        <div className="tool-chips">
          {COMMON_TOOLS.map((tool) => (
            <button
              key={tool.value}
              className={`tool-chip ${autoAcceptTools.includes(tool.value) ? 'selected' : ''}`}
              onClick={() => onToggleTool(tool.value)}
              title={tool.value}
            >
              {tool.label}
            </button>
          ))}
        </div>
        <div className="custom-tool-input">
          <input
            type="text"
            value={customTool}
            onChange={(e) => onCustomToolChange(e.target.value)}
            placeholder="Custom pattern (e.g., Bash(python:*))"
            onKeyDown={(e) => e.key === 'Enter' && onAddCustomTool()}
          />
          <button className="browse-btn" onClick={onAddCustomTool}>
            Add
          </button>
        </div>
        {customTools.length > 0 && (
          <div className="custom-tools-list">
            {customTools.map((tool) => (
              <span key={tool} className="custom-tool-tag">
                {tool}
                <button onClick={() => onRemoveCustomTool(tool)}>x</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="form-group">
        <label>Permission Mode</label>
        <p className="form-hint">
          Global permission behavior for Claude Code sessions.
        </p>
        <div className="permission-mode-options">
          {PERMISSION_MODES.map((mode) => (
            <label key={mode.value} className={`permission-mode-option ${permissionMode === mode.value ? 'selected' : ''}`}>
              <input
                type="radio"
                name="permissionMode"
                value={mode.value}
                checked={permissionMode === mode.value}
                onChange={(e) => onPermissionModeChange(e.target.value)}
              />
              <span className="mode-label">{mode.label}</span>
              <span className="mode-desc">{mode.desc}</span>
            </label>
          ))}
        </div>
      </div>
    </>
  )
}
