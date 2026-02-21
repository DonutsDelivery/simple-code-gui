import type { Theme } from '../types.js'
import { darkTheme } from './dark.js'
import { lightTheme } from './light.js'
import { gamerTheme } from './gamer.js'
import { solarizedTheme } from './solarized.js'
import { warmEarthTheme } from './warm-earth.js'
import { softGrayTheme } from './soft-gray.js'
import { customTheme } from './custom.js'

export const themes: Theme[] = [
  darkTheme,
  lightTheme,
  gamerTheme,
  solarizedTheme,
  warmEarthTheme,
  softGrayTheme,
  customTheme,
]

export function getThemeById(id: string): Theme {
  return themes.find(t => t.id === id) || themes[0]
}

export {
  darkTheme,
  lightTheme,
  gamerTheme,
  solarizedTheme,
  warmEarthTheme,
  softGrayTheme,
  customTheme,
}
