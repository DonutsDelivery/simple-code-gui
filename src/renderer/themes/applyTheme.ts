import type { Theme, ThemeCustomization, TerminalColorsCustomization } from './types.js'
import {
  generateAccentColors,
  isLightColor,
  deriveBackgroundColors,
  deriveTextColors,
  deriveBrightColor,
} from './colorUtils.js'
import { getTerminalThemeWithCustomization, setLastTerminalTheme } from './terminalTheme.js'

// Apply custom accent color to CSS variables
export function applyAccentColor(hex: string): void {
  const root = document.documentElement
  const colors = generateAccentColors(hex)

  root.style.setProperty('--accent', colors.accent)
  root.style.setProperty('--accent-hover', colors.accentHover)
  root.style.setProperty('--accent-subtle', colors.accentSubtle)
  root.style.setProperty('--accent-glow', colors.accentGlow)

  root.style.setProperty('--terminal-cursor', colors.accent)
  root.style.setProperty('--terminal-selection', `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, 0.3)`)
}

// Apply custom background color and derived colors
export function applyBackgroundColor(hex: string): void {
  const root = document.documentElement
  const isLight = isLightColor(hex)
  const colors = deriveBackgroundColors(hex, isLight)

  root.style.setProperty('--bg-base', colors.bgBase)
  root.style.setProperty('--bg-elevated', colors.bgElevated)
  root.style.setProperty('--bg-surface', colors.bgSurface)
  root.style.setProperty('--bg-hover', colors.bgHover)
  root.style.setProperty('--bg-active', colors.bgActive)
  root.style.setProperty('--border-subtle', colors.borderSubtle)
  root.style.setProperty('--border-default', colors.borderDefault)
  root.style.setProperty('--border-strong', colors.borderStrong)
}

// Apply custom text color and derived colors
export function applyTextColor(hex: string, backgroundColor: string): void {
  const root = document.documentElement
  const colors = deriveTextColors(hex, backgroundColor)

  root.style.setProperty('--text-primary', colors.textPrimary)
  root.style.setProperty('--text-secondary', colors.textSecondary)
  root.style.setProperty('--text-tertiary', colors.textTertiary)
  root.style.setProperty('--text-muted', colors.textMuted)
}

// Apply custom terminal colors (only the specified ones)
export function applyTerminalColors(colors: TerminalColorsCustomization, theme: Theme): void {
  const root = document.documentElement

  if (colors.black) {
    root.style.setProperty('--terminal-black', colors.black)
  }
  if (colors.red) {
    root.style.setProperty('--terminal-red', colors.red)
    root.style.setProperty('--terminal-bright-red', deriveBrightColor(colors.red))
  }
  if (colors.green) {
    root.style.setProperty('--terminal-green', colors.green)
    root.style.setProperty('--terminal-bright-green', deriveBrightColor(colors.green))
  }
  if (colors.yellow) {
    root.style.setProperty('--terminal-yellow', colors.yellow)
    root.style.setProperty('--terminal-bright-yellow', deriveBrightColor(colors.yellow))
  }
  if (colors.blue) {
    root.style.setProperty('--terminal-blue', colors.blue)
    root.style.setProperty('--terminal-bright-blue', deriveBrightColor(colors.blue))
  }
  if (colors.magenta) {
    root.style.setProperty('--terminal-magenta', colors.magenta)
    root.style.setProperty('--terminal-bright-magenta', deriveBrightColor(colors.magenta))
  }
  if (colors.cyan) {
    root.style.setProperty('--terminal-cyan', colors.cyan)
    root.style.setProperty('--terminal-bright-cyan', deriveBrightColor(colors.cyan))
  }
  if (colors.white) {
    root.style.setProperty('--terminal-white', colors.white)
    root.style.setProperty('--terminal-bright-white', deriveBrightColor(colors.white))
  }
}

export function applyTheme(theme: Theme, customization?: ThemeCustomization | null): void {
  const root = document.documentElement
  const c = theme.colors
  const t = theme.terminal

  root.setAttribute('data-theme', theme.id)

  root.style.setProperty('--bg-base', c.bgBase)
  root.style.setProperty('--bg-elevated', c.bgElevated)
  root.style.setProperty('--bg-surface', c.bgSurface)
  root.style.setProperty('--bg-hover', c.bgHover)
  root.style.setProperty('--bg-active', c.bgActive)
  root.style.setProperty('--border-subtle', c.borderSubtle)
  root.style.setProperty('--border-default', c.borderDefault)
  root.style.setProperty('--border-strong', c.borderStrong)
  root.style.setProperty('--text-primary', c.textPrimary)
  root.style.setProperty('--text-secondary', c.textSecondary)
  root.style.setProperty('--text-tertiary', c.textTertiary)
  root.style.setProperty('--text-muted', c.textMuted)
  root.style.setProperty('--accent', c.accent)
  root.style.setProperty('--accent-hover', c.accentHover)
  root.style.setProperty('--accent-subtle', c.accentSubtle)
  root.style.setProperty('--accent-glow', c.accentGlow)
  root.style.setProperty('--success', c.success)
  root.style.setProperty('--success-subtle', c.successSubtle)
  root.style.setProperty('--info', c.info)
  root.style.setProperty('--info-subtle', c.infoSubtle)

  root.style.setProperty('--terminal-red', t.red)
  root.style.setProperty('--terminal-green', t.green)
  root.style.setProperty('--terminal-yellow', t.yellow)
  root.style.setProperty('--terminal-blue', t.blue)
  root.style.setProperty('--terminal-magenta', t.magenta)
  root.style.setProperty('--terminal-cyan', t.cyan)
  root.style.setProperty('--terminal-bright-red', t.brightRed)
  root.style.setProperty('--terminal-bright-green', t.brightGreen)
  root.style.setProperty('--terminal-bright-yellow', t.brightYellow)
  root.style.setProperty('--terminal-bright-blue', t.brightBlue)
  root.style.setProperty('--terminal-bright-magenta', t.brightMagenta)
  root.style.setProperty('--terminal-bright-cyan', t.brightCyan)

  const activeCustomization = (customization && theme.id === 'custom') ? customization : null
  if (activeCustomization) {
    if (activeCustomization.backgroundColor) {
      applyBackgroundColor(activeCustomization.backgroundColor)
    }
    if (activeCustomization.textColor) {
      const bgColor = activeCustomization.backgroundColor || theme.colors.bgBase
      applyTextColor(activeCustomization.textColor, bgColor)
    }
    if (activeCustomization.accentColor) {
      applyAccentColor(activeCustomization.accentColor)
    }
    if (activeCustomization.terminalColors) {
      applyTerminalColors(activeCustomization.terminalColors, theme)
    }
  }

  const terminalTheme = getTerminalThemeWithCustomization(theme, activeCustomization)
  setLastTerminalTheme(terminalTheme)
  console.log('[Theme] applyTheme dispatching terminal-theme-update, bg:', terminalTheme.background, 'theme:', theme.id)
  window.dispatchEvent(new CustomEvent('terminal-theme-update', { detail: terminalTheme }))
}
