import { useState, useEffect, useCallback } from 'react'
import { Theme, getThemeById, applyTheme, themes } from '../themes'
import type { Settings } from '../api/types'

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

export type AppSettings = Settings

interface UseSettingsReturn {
  settings: AppSettings | null
  currentTheme: Theme
  loading: boolean
  updateSettings: (newSettings: AppSettings) => void
  updateTheme: (theme: Theme) => void
}

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [currentTheme, setCurrentTheme] = useState<Theme>(themes[0])
  const [loading, setLoading] = useState(true)

  // Load settings on mount
  useEffect(() => {
    if (!window.electronAPI) {
      setLoading(false)
      return
    }
    const loadSettings = async () => {
      try {
        const loadedSettings = await window.electronAPI?.getSettings()
        if (!loadedSettings) {
          return
        }
        setSettings(loadedSettings)

        // Apply theme with customization
        const theme = getThemeById(loadedSettings.theme || 'default')
        applyTheme(theme, loadedSettings.themeCustomization)
        setCurrentTheme(theme)
      } catch (e) {
        console.error('Failed to load settings:', e)
      } finally {
        setLoading(false)
      }
    }
    loadSettings()
  }, [])

  const updateSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings)
  }, [])

  const updateTheme = useCallback((theme: Theme) => {
    applyTheme(theme, settings?.themeCustomization)
    setCurrentTheme(theme)
  }, [settings?.themeCustomization])

  return {
    settings,
    currentTheme,
    loading,
    updateSettings,
    updateTheme
  }
}
