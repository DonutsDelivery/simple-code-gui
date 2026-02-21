import type { Theme, ThemeCustomization } from './types.js'
import { isLightColor, deriveBackgroundColors, deriveBrightColor } from './colorUtils.js'

// Cache the last-applied terminal theme so terminals that mount after applyTheme can use it
let _lastTerminalTheme: Record<string, string> | null = null

export function getLastTerminalTheme(): Record<string, string> | null {
  return _lastTerminalTheme
}

export function setLastTerminalTheme(theme: Record<string, string>): void {
  _lastTerminalTheme = theme
}

// Generate xterm-compatible theme object with customizations applied
export function getTerminalThemeWithCustomization(theme: Theme, customization: ThemeCustomization | null): {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
} {
  const t = theme.terminal
  const tc = customization?.terminalColors

  let background = t.background
  if (customization?.backgroundColor) {
    const isLight = isLightColor(customization.backgroundColor)
    const derived = deriveBackgroundColors(customization.backgroundColor, isLight)
    background = derived.bgElevated
  }

  const foreground = customization?.textColor || t.foreground

  const cursorColor = customization?.accentColor || t.cursor
  const selectionColor = customization?.accentColor
    ? `rgba(${parseInt(customization.accentColor.slice(1, 3), 16)}, ${parseInt(customization.accentColor.slice(3, 5), 16)}, ${parseInt(customization.accentColor.slice(5, 7), 16)}, 0.3)`
    : t.selection

  const red = tc?.red || t.red
  const green = tc?.green || t.green
  const yellow = tc?.yellow || t.yellow
  const blue = tc?.blue || t.blue
  const magenta = tc?.magenta || t.magenta
  const cyan = tc?.cyan || t.cyan
  const white = tc?.white || t.white
  const black = tc?.black || t.black

  return {
    background,
    foreground,
    cursor: cursorColor,
    cursorAccent: background,
    selectionBackground: selectionColor,
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack: t.brightBlack,
    brightRed: tc?.red ? deriveBrightColor(tc.red) : t.brightRed,
    brightGreen: tc?.green ? deriveBrightColor(tc.green) : t.brightGreen,
    brightYellow: tc?.yellow ? deriveBrightColor(tc.yellow) : t.brightYellow,
    brightBlue: tc?.blue ? deriveBrightColor(tc.blue) : t.brightBlue,
    brightMagenta: tc?.magenta ? deriveBrightColor(tc.magenta) : t.brightMagenta,
    brightCyan: tc?.cyan ? deriveBrightColor(tc.cyan) : t.brightCyan,
    brightWhite: tc?.white ? deriveBrightColor(tc.white) : t.brightWhite,
  }
}
