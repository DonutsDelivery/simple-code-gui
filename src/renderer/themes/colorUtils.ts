// Helper to parse hex color to RGB
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return { r, g, b }
}

// Helper to convert RGB to hex
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`
}

// Adjust brightness of a color (-100 to +100)
export function adjustBrightness(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const factor = amount / 100
  let newR, newG, newB
  if (factor > 0) {
    newR = r + (255 - r) * factor
    newG = g + (255 - g) * factor
    newB = b + (255 - b) * factor
  } else {
    newR = r * (1 + factor)
    newG = g * (1 + factor)
    newB = b * (1 + factor)
  }
  return rgbToHex(Math.max(0, Math.min(255, newR)), Math.max(0, Math.min(255, newG)), Math.max(0, Math.min(255, newB)))
}

// Determine if a color is light or dark
export function isLightColor(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5
}

// Derive background color hierarchy from a base color
export function deriveBackgroundColors(baseHex: string, isLight: boolean): {
  bgBase: string
  bgElevated: string
  bgSurface: string
  bgHover: string
  bgActive: string
  borderSubtle: string
  borderDefault: string
  borderStrong: string
} {
  const direction = isLight ? -1 : 1

  return {
    bgBase: baseHex,
    bgElevated: adjustBrightness(baseHex, direction * 5),
    bgSurface: adjustBrightness(baseHex, direction * 10),
    bgHover: adjustBrightness(baseHex, direction * 15),
    bgActive: adjustBrightness(baseHex, direction * 20),
    borderSubtle: isLight ? `rgba(0, 0, 0, 0.06)` : `rgba(255, 255, 255, 0.06)`,
    borderDefault: isLight ? `rgba(0, 0, 0, 0.1)` : `rgba(255, 255, 255, 0.1)`,
    borderStrong: isLight ? `rgba(0, 0, 0, 0.15)` : `rgba(255, 255, 255, 0.15)`,
  }
}

// Derive text color hierarchy from a primary text color
export function deriveTextColors(primaryHex: string, baseBackground: string): {
  textPrimary: string
  textSecondary: string
  textTertiary: string
  textMuted: string
} {
  const isLight = isLightColor(baseBackground)
  const direction = isLight ? 1 : -1

  return {
    textPrimary: primaryHex,
    textSecondary: adjustBrightness(primaryHex, direction * 35),
    textTertiary: adjustBrightness(primaryHex, direction * 55),
    textMuted: adjustBrightness(primaryHex, direction * 70),
  }
}

// Derive bright variant of a terminal color (lighten by 25%)
export function deriveBrightColor(hex: string): string {
  return adjustBrightness(hex, 25)
}

// Generate accent color variants from a hex color
export function generateAccentColors(hex: string): {
  accent: string
  accentHover: string
  accentSubtle: string
  accentGlow: string
} {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)

  const lighten = (value: number) => Math.min(255, Math.round(value + (255 - value) * 0.15))
  const hoverR = lighten(r)
  const hoverG = lighten(g)
  const hoverB = lighten(b)

  return {
    accent: hex,
    accentHover: `#${hoverR.toString(16).padStart(2, '0')}${hoverG.toString(16).padStart(2, '0')}${hoverB.toString(16).padStart(2, '0')}`,
    accentSubtle: `rgba(${r}, ${g}, ${b}, 0.15)`,
    accentGlow: `rgba(${r}, ${g}, ${b}, 0.4)`,
  }
}
