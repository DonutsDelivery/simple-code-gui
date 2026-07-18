import { describe, it, expect } from 'vitest'
import { serializeSessionsForSave } from '../stores/workspace-persistence'
import type { WorkspaceSession } from '../stores/workspace'
import { createEmptyCanvasScene } from '../components/canvas'

const tab = (overrides: Partial<any> = {}) => ({
  id: 'pty-1',
  projectPath: '/proj/a',
  sessionId: 'sess-1',
  title: 'a - main',
  customTitle: false,
  ptyId: 'pty-1',
  backend: 'claude' as const,
  ...overrides,
})

describe('serializeSessionsForSave', () => {
  // AC: @layout/multi-workspace-persistence ac-1
  it('preserves savedData for inactive (unrestored) workspaces', () => {
    const sessions: WorkspaceSession[] = [
      {
        id: 'ws-active',
        name: 'Workspace 1',
        openTabs: [tab()],
        activeTabId: 'pty-1',
        activeTileTree: { kind: 'leaf', id: 't1', tabIds: ['pty-1'], activeTabId: 'pty-1' } as any,
        canvasScene: createEmptyCanvasScene(),
        activeView: 'tiles',
        isRestored: true,
      },
      {
        id: 'ws-inactive',
        name: 'Workspace 2',
        openTabs: [],
        activeTabId: null,
        activeTileTree: null,
        canvasScene: createEmptyCanvasScene(),
        activeView: 'tiles',
        savedData: {
          openTabs: [
            { id: 'saved-1', projectPath: '/proj/b', sessionId: 'sess-9', title: 'b', ptyId: 'saved-1' },
          ],
          tileTree: { kind: 'leaf', id: 'saved-tile', tabIds: ['saved-1'], activeTabId: 'saved-1' },
          canvasScene: { version: 99, future: true },
          activeView: 'canvas',
          activeTabId: 'saved-1',
        },
        isRestored: false,
      },
    ]

    const result = serializeSessionsForSave(sessions)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('ws-active')
    expect(result[0].openTabs).toHaveLength(1)
    expect(result[0].activeTabId).toBe('pty-1')

    // The unrestored workspace must round-trip its savedData, NOT flush to empty.
    expect(result[1].id).toBe('ws-inactive')
    expect(result[1].openTabs).toHaveLength(1)
    expect(result[1].openTabs[0].projectPath).toBe('/proj/b')
    expect(result[1].activeTabId).toBe('saved-1')
    expect(result[1].tileTree).toMatchObject({ kind: 'leaf', id: 'saved-tile' })
    expect(result[1].canvasScene).toEqual({ version: 99, future: true })
    expect(result[1].activeView).toBe('canvas')
  })

  it('serializes restored workspaces from live state', () => {
    const sessions: WorkspaceSession[] = [
      {
        id: 'ws-1',
        name: 'Workspace 1',
        openTabs: [tab({ id: 'live-1', ptyId: 'live-1', projectPath: '/proj/x' })],
        activeTabId: 'live-1',
        activeTileTree: null,
        canvasScene: createEmptyCanvasScene(),
        activeView: 'tiles',
        isRestored: true,
      },
    ]

    const result = serializeSessionsForSave(sessions)

    expect(result[0].openTabs).toHaveLength(1)
    expect(result[0].openTabs[0].projectPath).toBe('/proj/x')
    expect(result[0].openTabs[0].ptyId).toBe('live-1')
  })

  it('falls back to empty when an unrestored session has no savedData', () => {
    const sessions: WorkspaceSession[] = [
      {
        id: 'ws-empty',
        name: 'Empty',
        openTabs: [],
        activeTabId: null,
        activeTileTree: null,
        canvasScene: createEmptyCanvasScene(),
        activeView: 'tiles',
        isRestored: false,
      },
    ]

    const result = serializeSessionsForSave(sessions)

    expect(result[0].openTabs).toEqual([])
    expect(result[0].activeTabId).toBeNull()
    expect(result[0].tileTree).toBeUndefined()
  })

  // AC: @canvas-workspace ac-2
  // AC: @canvas-scene-persistence ac-1
  it('serializes independent live Canvas view state', () => {
    const canvasScene = createEmptyCanvasScene()
    canvasScene.camera = { x: -320, y: 180, zoom: 0.72 }
    const sessions: WorkspaceSession[] = [{
      id: 'ws-canvas',
      name: 'Canvas',
      openTabs: [tab()],
      activeTabId: 'pty-1',
      activeTileTree: null,
      canvasScene,
      activeView: 'canvas',
      isRestored: true,
    }]

    const result = serializeSessionsForSave(sessions)

    expect(result[0].activeView).toBe('canvas')
    expect(result[0].canvasScene).toMatchObject({
      version: 1,
      camera: { x: -320, y: 180, zoom: 0.72 },
    })
    expect(result[0].tileTree).toBeUndefined()
  })

  it('strips falsy customTitle from live tabs', () => {
    const sessions: WorkspaceSession[] = [
      {
        id: 'ws-1',
        name: 'Workspace 1',
        openTabs: [tab({ customTitle: false })],
        activeTabId: 'pty-1',
        activeTileTree: null,
        canvasScene: createEmptyCanvasScene(),
        activeView: 'tiles',
        isRestored: true,
      },
    ]

    const result = serializeSessionsForSave(sessions)
    expect((result[0].openTabs[0] as any).customTitle).toBeUndefined()
  })
})
