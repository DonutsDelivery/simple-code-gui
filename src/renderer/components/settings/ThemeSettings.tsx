import React from 'react'
import { themes, getThemeById, applyTheme, Theme } from '../../themes'

interface ThemeSettingsProps {
  selectedTheme: string
  onThemeChange: (theme: Theme) => void
  onSelect: (themeId: string) => void
}

export function ThemeSettings({ selectedTheme, onThemeChange, onSelect }: ThemeSettingsProps): React.ReactElement {
  function handleThemeSelect(themeId: string): void {
    onSelect(themeId)
    const theme = getThemeById(themeId)
    applyTheme(theme)
    onThemeChange(theme)
  }

  return (
    <div className="form-group">
      <label>Theme</label>
      <div className="theme-grid">
        {themes.map((theme) => (
          <button
            key={theme.id}
            className={`theme-swatch ${selectedTheme === theme.id ? 'selected' : ''}`}
            onClick={() => handleThemeSelect(theme.id)}
            title={theme.name}
          >
            <div
              className="theme-preview"
              style={{
                background: theme.colors.bgBase,
                borderColor: theme.colors.accent,
              }}
            >
              <div
                className="theme-accent"
                style={{ background: theme.colors.accent }}
              />
              <div
                className="theme-text"
                style={{ background: theme.colors.textPrimary }}
              />
              <div
                className="theme-text-sm"
                style={{ background: theme.colors.textSecondary }}
              />
            </div>
            <span className="theme-name">{theme.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
