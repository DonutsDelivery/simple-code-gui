import { describe, it, expect } from 'vitest'
import { serializeSessionsForSave } from '../stores/workspace-persistence'
import type { WorkspaceSession } from '../stores/workspace'

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
        activeTileTree: { kind: 'leaf', id: 't1', tabIds: ['pty-1'], activeTabId: 'pty-1' },
        isRestored: true,
      },
      {
        id: 'ws-inactive',
        name: 'Workspace 2',
        openTabs: [],
        activeTabId: null,
        activeTileTree: null,
        savedData: {
          openTabs: [
            { id: 'saved-1', projectPath: '/proj/b', sessionId: 'sess-9', title: 'b', ptyId: 'saved-1' },
          ],
          tileTree: { kind: 'leaf', id: 'saved-tile', tabIds: ['saved-1'], activeTabId: 'saved-1' },
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
  })

  it('serializes restored workspaces from live state', () => {
    const sessions: WorkspaceSession[] = [
      {
        id: 'ws-1',
        name: 'Workspace 1',
        openTabs: [tab({ id: 'live-1', ptyId: 'live-1', projectPath: '/proj/x' })],
        activeTabId: 'live-1',
        activeTileTree: null,
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
        isRestored: false,
      },
    ]

    const result = serializeSessionsForSave(sessions)

    expect(result[0].openTabs).toEqual([])
    expect(result[0].activeTabId).toBeNull()
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
        isRestored: true,
      },
    ]

    const result = serializeSessionsForSave(sessions)
    expect((result[0].openTabs[0] as any).customTitle).toBeUndefined()
  })
})
