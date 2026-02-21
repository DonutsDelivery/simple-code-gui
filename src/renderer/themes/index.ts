// Types
export type { Theme, ThemeCustomization, TerminalColorsCustomization } from './types.js'

// Theme definitions
export { themes, getThemeById } from './definitions/index.js'
export {
  darkTheme,
  lightTheme,
  gamerTheme,
  solarizedTheme,
  warmEarthTheme,
  softGrayTheme,
  customTheme,
} from './definitions/index.js'

// Color utilities
export {
  hexToRgb,
  rgbToHex,
  adjustBrightness,
  isLightColor,
  deriveBackgroundColors,
  deriveTextColors,
  deriveBrightColor,
  generateAccentColors,
} from './colorUtils.js'

// Theme application
export {
  applyTheme,
  applyAccentColor,
  applyBackgroundColor,
  applyTextColor,
  applyTerminalColors,
} from './applyTheme.js'

// Terminal theme
export {
  getLastTerminalTheme,
  getTerminalThemeWithCustomization,
} from './terminalTheme.js'
