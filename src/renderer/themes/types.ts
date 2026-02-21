export interface Theme {
  id: string
  name: string
  colors: {
    bgBase: string
    bgElevated: string
    bgSurface: string
    bgHover: string
    bgActive: string
    borderSubtle: string
    borderDefault: string
    borderStrong: string
    textPrimary: string
    textSecondary: string
    textTertiary: string
    textMuted: string
    accent: string
    accentHover: string
    accentSubtle: string
    accentGlow: string
    success: string
    successSubtle: string
    info: string
    infoSubtle: string
  }
  terminal: {
    background: string
    foreground: string
    cursor: string
    cursorAccent: string
    selection: string
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
  }
}

export interface TerminalColorsCustomization {
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
}

export interface ThemeCustomization {
  accentColor: string | null
  backgroundColor: string | null
  textColor: string | null
  terminalColors: TerminalColorsCustomization | null
}
