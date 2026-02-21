import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'

// Mock electron app module before importing session-store
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData')
  }
}))

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))

import { SessionStore, Workspace, Settings, WindowBounds } from '../session-store'
import * as fs from 'fs'

describe('SessionStore', () => {
  const mockConfigDir = '/mock/userData/config'
  const mockConfigPath = join(mockConfigDir, 'workspace.json')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should create config directory if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(false) // config dir check
      vi.mocked(fs.existsSync).mockReturnValueOnce(false) // workspace.json check

      new SessionStore()

      expect(fs.mkdirSync).toHaveBeenCalledWith(mockConfigDir, { recursive: true })
    })

    it('should not create config directory if it already exists', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true) // config dir exists
      vi.mocked(fs.existsSync).mockReturnValueOnce(false) // workspace.json doesn't exist

      new SessionStore()

      expect(fs.mkdirSync).not.toHaveBeenCalled()
    })
  })

  describe('load()', () => {
    it('should return default workspace when workspace.json does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true) // config dir exists
      vi.mocked(fs.existsSync).mockReturnValueOnce(false) // workspace.json doesn't exist

      const store = new SessionStore()
      const workspace = store.getWorkspace()

      expect(workspace).toEqual({
        projects: [],
        openTabs: [],
        activeTabId: null
      })
    })

    it('should load workspace from existing workspace.json', () => {
      const mockWorkspace: Workspace = {
        projects: [{ path: '/test', name: 'Test Project' }],
        openTabs: [{ id: 'tab1', projectPath: '/test', title: 'Test Tab' }],
        activeTabId: 'tab1'
      }
      const mockData = { workspace: mockWorkspace }

      vi.mocked(fs.existsSync).mockReturnValueOnce(true) // config dir
      vi.mocked(fs.existsSync).mockReturnValueOnce(true) // workspace.json exists
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify(mockData))

      const store = new SessionStore()
      const workspace = store.getWorkspace()

      expect(workspace).toEqual(mockWorkspace)
      expect(fs.readFileSync).toHaveBeenCalledWith(mockConfigPath, 'utf-8')
    })

    it('should return default workspace when workspace.json is corrupted', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true) // config dir
      vi.mocked(fs.existsSync).mockReturnValueOnce(true) // workspace.json exists
      vi.mocked(fs.readFileSync).mockReturnValueOnce('invalid json {{{')

      // Spy on console.error to verify error logging
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const store = new SessionStore()
      const workspace = store.getWorkspace()

      expect(workspace).toEqual({
        projects: [],
        openTabs: [],
        activeTabId: null
      })
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should return default workspace when readFileSync throws', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true) // config dir
      vi.mocked(fs.existsSync).mockReturnValueOnce(true) // workspace.json exists
      vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied')
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const store = new SessionStore()
      const workspace = store.getWorkspace()

      expect(workspace).toEqual({
        projects: [],
        openTabs: [],
        activeTabId: null
      })
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should handle empty workspace.json file', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true) // config dir
      vi.mocked(fs.existsSync).mockReturnValueOnce(true) // workspace.json exists
      vi.mocked(fs.readFileSync).mockReturnValueOnce('')

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const store = new SessionStore()
      const workspace = store.getWorkspace()

      // Empty string causes JSON.parse to throw
      expect(workspace).toEqual({
        projects: [],
        openTabs: [],
        activeTabId: null
      })
      consoleSpy.mockRestore()
    })
  })

  describe('save()', () => {
    it('should save workspace to workspace.json', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({
        workspace: { projects: [], openTabs: [], activeTabId: null }
      }))

      const store = new SessionStore()
      const newWorkspace: Workspace = {
        projects: [{ path: '/new', name: 'New Project' }],
        openTabs: [],
        activeTabId: null
      }

      store.saveWorkspace(newWorkspace)

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockConfigPath,
        expect.stringContaining('"projects"')
      )
    })

    it('should handle write errors gracefully', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({
        workspace: { projects: [], openTabs: [], activeTabId: null }
      }))
      vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
        throw new Error('ENOSPC: no space left on device')
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const store = new SessionStore()

      // Should not throw
      expect(() => store.saveWorkspace({
        projects: [],
        openTabs: [],
        activeTabId: null
      })).not.toThrow()

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('getWindowBounds() / saveWindowBounds()', () => {
    it('should return undefined when no bounds are saved', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({
        workspace: { projects: [], openTabs: [], activeTabId: null }
      }))

      const store = new SessionStore()

      expect(store.getWindowBounds()).toBeUndefined()
    })

    it('should save and retrieve window bounds', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({
        workspace: { projects: [], openTabs: [], activeTabId: null }
      }))

      const store = new SessionStore()
      const bounds: WindowBounds = { x: 100, y: 200, width: 800, height: 600 }

      store.saveWindowBounds(bounds)

      expect(fs.writeFileSync).toHaveBeenCalled()
      expect(store.getWindowBounds()).toEqual(bounds)
    })
  })

  describe('getSettings() / saveSettings()', () => {
    it('should return default settings when none are saved', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({
        workspace: { projects: [], openTabs: [], activeTabId: null }
      }))

      const store = new SessionStore()
      const settings = store.getSettings()

      expect(settings).toEqual({
        defaultProjectDir: '',
        theme: 'default'
      })
    })

    it('should save and retrieve settings', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({
        workspace: { projects: [], openTabs: [], activeTabId: null }
      }))

      const store = new SessionStore()
      const settings: Settings = {
        defaultProjectDir: '/home/user/projects',
        theme: 'dark',
        backend: 'claude',
        voiceOutputEnabled: true
      }

      store.saveSettings(settings)

      expect(fs.writeFileSync).toHaveBeenCalled()
      expect(store.getSettings()).toEqual(settings)
    })
  })

  describe('edge cases', () => {
    it('should handle workspace with all optional fields', () => {
      const fullWorkspace: Workspace = {
        projects: [{
          path: '/test',
          name: 'Test',
          executable: '/bin/test',
          apiPort: 3000,
          apiAutoStart: true,
          apiSessionMode: 'existing',
          apiModel: 'opus',
          autoAcceptTools: ['Read', 'Write'],
          permissionMode: 'dontAsk',
          color: '#ff0000',
          ttsVoice: 'test-voice',
          ttsEngine: 'piper',
          backend: 'claude',
          categoryId: 'cat1',
          order: 1
        }],
        openTabs: [{
          id: 'tab1',
          projectPath: '/test',
          sessionId: 'session1',
          title: 'Test Tab',
          backend: 'claude'
        }],
        activeTabId: 'tab1',
        viewMode: 'tiled',
        tileLayout: [{ id: 'tile1', tabIds: ['tile1'], activeTabId: 'tile1', x: 0, y: 0, width: 100, height: 100 }],
        categories: [{ id: 'cat1', name: 'Category 1', collapsed: false, order: 0 }]
      }

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({
        workspace: fullWorkspace
      }))

      const store = new SessionStore()
      const workspace = store.getWorkspace()

      expect(workspace).toEqual(fullWorkspace)
    })

    it('should handle partial data in workspace.json', () => {
      // workspace.json might exist but have incomplete data
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({
        workspace: {
          projects: [{ path: '/test', name: 'Test' }]
          // missing openTabs and activeTabId
        }
      }))

      const store = new SessionStore()
      const workspace = store.getWorkspace()

      // Should return the partial data as-is (no validation in current impl)
      expect(workspace.projects).toEqual([{ path: '/test', name: 'Test' }])
    })
  })
})
