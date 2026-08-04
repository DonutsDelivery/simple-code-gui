import { describe, it, expect, beforeEach, vi } from 'vitest'
import { themes, getThemeById, applyTheme, Theme } from '../themes'

describe('themes', () => {
  describe('themes array', () => {
    it('should contain at least one theme', () => {
      expect(themes.length).toBeGreaterThan(0)
    })

    it('should have a default theme', () => {
      const defaultTheme = themes.find(t => t.id === 'default')
      expect(defaultTheme).toBeDefined()
      expect(defaultTheme?.name).toBe('Dark')
    })

    it('should have valid structure for all themes', () => {
      themes.forEach(theme => {
        expect(theme.id).toBeDefined()
        expect(theme.name).toBeDefined()
        expect(theme.colors).toBeDefined()
        expect(theme.terminal).toBeDefined()

        // Check required color properties
        expect(theme.colors.bgBase).toBeDefined()
        expect(theme.colors.textPrimary).toBeDefined()
        expect(theme.colors.accent).toBeDefined()

        // Check required terminal properties
        expect(theme.terminal.background).toBeDefined()
        expect(theme.terminal.foreground).toBeDefined()
        expect(theme.terminal.cursor).toBeDefined()
      })
    })
  })

  describe('getThemeById', () => {
    it('should return the correct theme by id', () => {
      const theme = getThemeById('default')
      expect(theme.id).toBe('default')
      expect(theme.name).toBe('Dark')
    })

    it('should return default theme for unknown id', () => {
      const theme = getThemeById('non-existent-theme')
      expect(theme.id).toBe('default')
    })

    it('should return each theme correctly', () => {
      themes.forEach(expectedTheme => {
        const theme = getThemeById(expectedTheme.id)
        expect(theme.id).toBe(expectedTheme.id)
        expect(theme.name).toBe(expectedTheme.name)
      })
    })
  })

  describe('applyTheme', () => {
    let mockSetProperty: ReturnType<typeof vi.fn>
    let mockSetAttribute: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockSetProperty = vi.fn()
      mockSetAttribute = vi.fn()

      vi.spyOn(document, 'documentElement', 'get').mockReturnValue({
        style: {
          setProperty: mockSetProperty
        },
        setAttribute: mockSetAttribute
      } as unknown as HTMLElement)
    })

    it('should apply theme colors to CSS variables', () => {
      const theme = getThemeById('default')
      applyTheme(theme)

      expect(mockSetAttribute).toHaveBeenCalledWith('data-theme', 'default')
      expect(mockSetProperty).toHaveBeenCalledWith('--bg-base', theme.colors.bgBase)
      expect(mockSetProperty).toHaveBeenCalledWith('--text-primary', theme.colors.textPrimary)
      expect(mockSetProperty).toHaveBeenCalledWith('--accent', theme.colors.accent)
    })

    it('should apply all color variables', () => {
      const theme = getThemeById('default')
      applyTheme(theme)

      // Check that all color properties are applied
      const expectedCalls = [
        ['--bg-base', theme.colors.bgBase],
        ['--bg-elevated', theme.colors.bgElevated],
        ['--bg-surface', theme.colors.bgSurface],
        ['--bg-hover', theme.colors.bgHover],
        ['--bg-active', theme.colors.bgActive],
        ['--border-subtle', theme.colors.borderSubtle],
        ['--border-default', theme.colors.borderDefault],
        ['--border-strong', theme.colors.borderStrong],
        ['--text-primary', theme.colors.textPrimary],
        ['--text-secondary', theme.colors.textSecondary],
        ['--text-tertiary', theme.colors.textTertiary],
        ['--text-muted', theme.colors.textMuted],
        ['--accent', theme.colors.accent],
        ['--accent-hover', theme.colors.accentHover],
        ['--accent-subtle', theme.colors.accentSubtle],
        ['--accent-glow', theme.colors.accentGlow],
        ['--success', theme.colors.success],
        ['--success-subtle', theme.colors.successSubtle],
        ['--info', theme.colors.info],
        ['--info-subtle', theme.colors.infoSubtle],
      ]

      expectedCalls.forEach(([prop, value]) => {
        expect(mockSetProperty).toHaveBeenCalledWith(prop, value)
      })
    })
  })
})
