import React, { useEffect, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../api'
import { useWorkspaceStore, type OpenTab, type WorkspaceSession } from '../stores/workspace'
import { MainApp } from '../App/MainApp'

const terminalLifecycle = vi.hoisted(() => ({
  mounts: new Map<string, number>(),
  unmounts: new Map<string, number>(),
}))

vi.mock('../contexts/VoiceContext', () => ({
  useVoice: () => ({ voiceOutputEnabled: false, setProjectVoice: vi.fn() }),
}))

vi.mock('../contexts/ModalContext', () => ({
  useModals: () => ({
    settingsOpen: false,
    makeProjectOpen: false,
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openMakeProject: vi.fn(),
    closeMakeProject: vi.fn(),
  }),
}))

vi.mock('../hooks', () => ({
  useInstallation: () => ({
    claudeInstalled: true,
    npmInstalled: true,
    gitBashInstalled: true,
    installing: false,
    installError: null,
    installMessage: '',
    checkInstallation: vi.fn(),
    handleInstallNode: vi.fn(),
    handleInstallGit: vi.fn(),
    handleInstallClaude: vi.fn(),
  }),
  useUpdater: () => ({
    appVersion: 'test',
    updateStatus: null,
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
  }),
  useViewState: () => ({
    lastFocusedTabId: null,
    sidebarWidth: 240,
    sidebarCollapsed: false,
    setLastFocusedTabId: vi.fn(),
    setSidebarWidth: vi.fn(),
    setSidebarCollapsed: vi.fn(),
  }),
  useWorkspaceLoader: () => ({
    loading: false,
    currentTheme: {},
    settings: null,
    setCurrentTheme: vi.fn(),
    setSettings: vi.fn(),
    restoreSession: vi.fn().mockResolvedValue(undefined),
  }),
  useSessionPolling: vi.fn(),
  useApiListeners: vi.fn(),
  useAgentNotifications: vi.fn(),
  useProjectHandlers: () => ({
    handleAddProject: vi.fn(),
    handleAddProjectsFromParent: vi.fn(),
    handleOpenSession: vi.fn(),
    handleOpenSessionAtPosition: vi.fn(),
    handleAddTabToTile: vi.fn(),
    handleCloseTab: vi.fn(),
    handleCloseProjectTabs: vi.fn(),
    handleProjectCreated: vi.fn(),
    handleUndoCloseTab: vi.fn(),
    canUndoCloseTab: false,
  }),
}))

vi.mock('../components/TitleBar', () => ({ TitleBar: () => null }))
vi.mock('../components/Sidebar', () => ({ Sidebar: () => null }))
vi.mock('../components/terminal/Terminal', () => ({ Terminal: () => null }))
vi.mock('../components/WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }))
vi.mock('../components/WorkspaceViewToggle', () => ({ WorkspaceViewToggle: () => null }))
vi.mock('../components/SettingsModal', () => ({ SettingsModal: () => null }))
vi.mock('../components/MakeProjectModal', () => ({ MakeProjectModal: () => null }))
vi.mock('../components/canvas/CanvasWorkspaceView', () => ({ CanvasWorkspaceView: () => null }))

vi.mock('../components/tiled/index.js', () => ({
  TiledTerminalView: ({ tabs, api }: { tabs: OpenTab[]; api: Api }) => (
    <div data-testid={`workspace-${tabs[0]?.id}-view`}>
      {tabs.map(tab => <MockTerminal key={tab.id} ptyId={tab.id} api={api} />)}
    </div>
  ),
}))

function MockTerminal({ ptyId, api }: { ptyId: string; api: Api }): React.ReactElement {
  const [output, setOutput] = useState('')

  useEffect(() => {
    terminalLifecycle.mounts.set(ptyId, (terminalLifecycle.mounts.get(ptyId) ?? 0) + 1)
    const cleanup = api.onPtyData(ptyId, data => setOutput(current => current + data))
    return () => {
      terminalLifecycle.unmounts.set(ptyId, (terminalLifecycle.unmounts.get(ptyId) ?? 0) + 1)
      cleanup?.()
    }
  }, [api, ptyId])

  return <pre data-testid={`terminal-${ptyId}`}>{output}</pre>
}

function tab(id: string): OpenTab {
  return {
    id,
    ptyId: id,
    projectPath: `/projects/${id}`,
    title: id,
    backend: 'claude-codex',
  }
}

function workspace(id: string): WorkspaceSession {
  const openTab = tab(id)
  return {
    id: `workspace-${id}`,
    name: id,
    openTabs: [openTab],
    activeTabId: openTab.id,
    activeTileTree: null,
    canvasScene: null,
    activeView: 'tiles',
    isRestored: true,
  }
}

describe('MainApp restored workspace lifecycle', () => {
  beforeEach(() => {
    terminalLifecycle.mounts.clear()
    terminalLifecycle.unmounts.clear()
    sessionStorage.clear()
    useWorkspaceStore.getState().initSessions([workspace('a'), workspace('b')], 'workspace-a')
  })

  // AC: @multi-workspace-persistence ac-5
  // AC: @canvas-terminal-lifecycle ac-3
  it('keeps restored terminals mounted and subscribed while their workspace is inactive', () => {
    const listeners = new Map<string, (data: string) => void>()
    const api = {
      saveWorkspace: vi.fn(),
      onPtyData: vi.fn((id: string, listener: (data: string) => void) => {
        listeners.set(id, listener)
        return () => listeners.delete(id)
      }),
    } as unknown as Api

    render(<MainApp api={api} isElectron />)

    expect(terminalLifecycle.mounts).toEqual(new Map([['a', 1], ['b', 1]]))
    expect(screen.getByTestId('workspace-a-view').parentElement).not.toHaveStyle({ visibility: 'hidden' })
    expect(screen.getByTestId('workspace-b-view').parentElement).toHaveStyle({ visibility: 'hidden' })

    act(() => {
      listeners.get('a')?.('before switch\n')
      useWorkspaceStore.getState().switchSession('workspace-b')
      listeners.get('a')?.('while hidden\n')
    })

    expect(screen.getByTestId('workspace-a-view').parentElement).toHaveStyle({ visibility: 'hidden' })
    expect(screen.getByTestId('workspace-b-view').parentElement).not.toHaveStyle({ visibility: 'hidden' })

    act(() => useWorkspaceStore.getState().switchSession('workspace-a'))

    expect(screen.getByTestId('terminal-a')).toHaveTextContent('before switch while hidden')
    expect(terminalLifecycle.mounts.get('a')).toBe(1)
    expect(terminalLifecycle.unmounts.get('a')).toBeUndefined()
    expect(api.onPtyData).toHaveBeenCalledTimes(2)
  })
})
