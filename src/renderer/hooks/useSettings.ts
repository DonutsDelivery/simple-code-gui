import { useState, useEffect, useCallback } from 'react'
import { Theme, getThemeById, applyTheme, themes } from '../themes'

export interface AppSettings {
  defaultProjectDir: string
  theme: string
  autoAcceptTools?: string[]
  permissionMode?: string
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
}

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

        // Apply theme
        const theme = getThemeById(loadedSettings.theme || 'default')
        applyTheme(theme)
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
    applyTheme(theme)
    setCurrentTheme(theme)
  }, [])

  return {
    settings,
    currentTheme,
    loading,
    updateSettings,
    updateTheme
  }
}
