import React from 'react'
import {
  themes,
  getThemeById,
  applyTheme,
  Theme,
  ThemeCustomization
} from '../../themes'
import { DEFAULT_THEME_CUSTOMIZATION } from './settingsTypes'

interface ThemeSettingsProps {
  selectedTheme: string
  customization: ThemeCustomization
  onThemeChange: (theme: Theme) => void
  onSelect: (themeId: string) => void
  onCustomizationChange: (customization: ThemeCustomization) => void
}

const TERMINAL_COLOR_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const
type TerminalColorName = typeof TERMINAL_COLOR_NAMES[number]

export function ThemeSettings({
  selectedTheme,
  customization,
  onThemeChange,
  onSelect,
  onCustomizationChange
}: ThemeSettingsProps): React.ReactElement {
  const isCustom = selectedTheme === 'custom'
  const currentTheme = getThemeById(selectedTheme)
  const displayedAccent = customization.accentColor || currentTheme.colors.accent
  const displayedBackground = customization.backgroundColor || currentTheme.colors.bgBase
  const displayedText = customization.textColor || currentTheme.colors.textPrimary

  function handleThemeSelect(themeId: string): void {
    onSelect(themeId)
    const theme = getThemeById(themeId)
    // applyTheme will only apply customization when theme.id === 'custom'
    applyTheme(theme, customization)
    onThemeChange(theme)
  }

  function updateAndApply(newCustomization: ThemeCustomization): void {
    onCustomizationChange(newCustomization)
    applyTheme(currentTheme, newCustomization)
  }

  function handleAccentChange(e: React.ChangeEvent<HTMLInputElement>): void {
    updateAndApply({ ...customization, accentColor: e.target.value })
  }

  function handleBackgroundChange(e: React.ChangeEvent<HTMLInputElement>): void {
    updateAndApply({ ...customization, backgroundColor: e.target.value })
  }

  function handleTextChange(e: React.ChangeEvent<HTMLInputElement>): void {
    updateAndApply({ ...customization, textColor: e.target.value })
  }

  function handleTerminalColorChange(colorName: TerminalColorName, value: string): void {
    updateAndApply({
      ...customization,
      terminalColors: { ...customization.terminalColors, [colorName]: value }
    })
  }

  function handleResetField(field: keyof ThemeCustomization): void {
    updateAndApply({ ...customization, [field]: null })
  }

  function handleResetAll(): void {
    updateAndApply(DEFAULT_THEME_CUSTOMIZATION)
  }

  function getTerminalColor(colorName: TerminalColorName): string {
    return customization.terminalColors?.[colorName] || currentTheme.terminal[colorName]
  }

  const hasCustomizations =
    !!customization.accentColor ||
    !!customization.backgroundColor ||
    !!customization.textColor ||
    !!customization.terminalColors

  const hasTerminalCustomizations = !!customization.terminalColors &&
    Object.keys(customization.terminalColors).length > 0

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
              className={`theme-preview ${theme.id === 'custom' ? 'theme-preview-custom' : ''}`}
              style={{
                background: theme.id === 'custom' && customization.backgroundColor
                  ? customization.backgroundColor
                  : theme.colors.bgBase,
                borderColor: theme.id === 'custom' && customization.accentColor
                  ? customization.accentColor
                  : theme.colors.accent,
              }}
            >
              <div
                className="theme-accent"
                style={{
                  background: theme.id === 'custom' && customization.accentColor
                    ? customization.accentColor
                    : theme.colors.accent
                }}
              />
              <div
                className="theme-text"
                style={{
                  background: theme.id === 'custom' && customization.textColor
                    ? customization.textColor
                    : theme.colors.textPrimary
                }}
              />
              <div
                className="theme-text-sm"
                style={{
                  background: theme.id === 'custom' && customization.textColor
                    ? customization.textColor
                    : theme.colors.textSecondary,
                  opacity: theme.id === 'custom' && customization.textColor ? 0.6 : 1
                }}
              />
            </div>
            <span className="theme-name">{theme.name}</span>
          </button>
        ))}
      </div>

      {isCustom && (
        <div className="theme-customization">
          <div className="customization-header">
            <label>Customize</label>
            {hasCustomizations && (
              <button
                className="accent-reset-btn"
                onClick={handleResetAll}
                title="Reset all customizations"
              >
                Reset All
              </button>
            )}
          </div>

          <div className="customization-row">
            <label>Accent Color</label>
            <div className="accent-color-controls">
              <input
                type="color"
                value={displayedAccent}
                onChange={handleAccentChange}
                title="Choose accent color"
              />
              <span className="accent-color-value">{displayedAccent}</span>
              {customization.accentColor && (
                <button
                  className="accent-reset-btn"
                  onClick={() => handleResetField('accentColor')}
                  title="Reset to default"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          <div className="customization-row">
            <label>Background</label>
            <div className="accent-color-controls">
              <input
                type="color"
                value={displayedBackground}
                onChange={handleBackgroundChange}
                title="Choose background color"
              />
              <span className="accent-color-value">{displayedBackground}</span>
              {customization.backgroundColor && (
                <button
                  className="accent-reset-btn"
                  onClick={() => handleResetField('backgroundColor')}
                  title="Reset to default"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          <div className="customization-row">
            <label>Text Color</label>
            <div className="accent-color-controls">
              <input
                type="color"
                value={displayedText}
                onChange={handleTextChange}
                title="Choose text color"
              />
              <span className="accent-color-value">{displayedText}</span>
              {customization.textColor && (
                <button
                  className="accent-reset-btn"
                  onClick={() => handleResetField('textColor')}
                  title="Reset to default"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          <div className="terminal-colors-section">
            <div className="terminal-colors-header">
              <label>Terminal Colors</label>
              {hasTerminalCustomizations && (
                <button
                  className="accent-reset-btn"
                  onClick={() => handleResetField('terminalColors')}
                  title="Reset terminal colors"
                >
                  Reset
                </button>
              )}
            </div>
            <div className="terminal-colors-grid">
              {TERMINAL_COLOR_NAMES.slice(0, 4).map((colorName) => (
                <div key={colorName} className="terminal-color-item">
                  <input
                    type="color"
                    value={getTerminalColor(colorName)}
                    onChange={(e) => handleTerminalColorChange(colorName, e.target.value)}
                    title={colorName}
                  />
                  <span className="terminal-color-label">{colorName}</span>
                </div>
              ))}
            </div>
            <div className="terminal-colors-grid">
              {TERMINAL_COLOR_NAMES.slice(4).map((colorName) => (
                <div key={colorName} className="terminal-color-item">
                  <input
                    type="color"
                    value={getTerminalColor(colorName)}
                    onChange={(e) => handleTerminalColorChange(colorName, e.target.value)}
                    title={colorName}
                  />
                  <span className="terminal-color-label">{colorName}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
