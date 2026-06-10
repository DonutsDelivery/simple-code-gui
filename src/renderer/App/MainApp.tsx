import React, { useEffect, useState, useCallback, useRef, RefObject } from 'react'
import { TitleBar } from '../components/TitleBar'
import { Sidebar } from '../components/Sidebar'
import { Terminal } from '../components/terminal/Terminal'
import { TiledTerminalView } from '../components/tiled/index.js'
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher'
import { getAllTabIds, createLeaf, createBranch, generateTileId } from '../components/tile-tree'
import { SettingsModal } from '../components/SettingsModal'
import { MakeProjectModal } from '../components/MakeProjectModal'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { FileBrowser } from '../components/mobile/FileBrowser'
import type { HostConfig } from '../hooks/useHostConnection'
import { useWorkspaceStore } from '../stores/workspace'
import { serializeSessionsForSave } from '../stores/workspace-persistence'
import { useVoice } from '../contexts/VoiceContext'
import { useModals } from '../contexts/ModalContext'
import {
  useInstallation,
  useUpdater,
  useViewState,
  useWorkspaceLoader,
  useSessionPolling,
  useApiListeners,
  useProjectHandlers,
} from '../hooks'
import type { Api } from '../api'
import { InstallationPrompt } from './InstallationPrompt'
import { MobileConnectModal } from './MobileConnectModal'

export interface MainAppProps {
  api: Api
  isElectron: boolean
  onDisconnect?: () => void
}

export function MainApp({ api, isElectron, onDisconnect }: MainAppProps): React.ReactElement {
  const {
    projects,
    openTabs,
    activeTabId,
    categories,
    sessions,
    activeSessionId,
    activeTileTree,
    addProject,
    removeProject,
    updateProject,
    addTab,
    removeTab,
    updateTab,
    setActiveTab,
    setActiveTileTree,
    addSession,
    removeSession,
    renameSession,
    reorderSessions,
    switchSession,
    setSessionSavedData,
  } = useWorkspaceStore()

  const { voiceOutputEnabled, setProjectVoice } = useVoice()
  const voiceOutputEnabledRef = useRef(voiceOutputEnabled)

  const { settingsOpen, makeProjectOpen, openSettings, closeSettings, openMakeProject, closeMakeProject } = useModals()

  const {
    claudeInstalled,
    npmInstalled,
    gitBashInstalled,
    installing,
    installError,
    installMessage,
    checkInstallation,
    handleInstallNode,
    handleInstallGit,
    handleInstallClaude
  } = useInstallation()

  const { appVersion, updateStatus, downloadUpdate, installUpdate } = useUpdater()

  const {
    lastFocusedTabId,
    sidebarWidth,
    sidebarCollapsed,
    setLastFocusedTabId,
    setSidebarWidth,
    setSidebarCollapsed,
  } = useViewState()

  const {
    loading,
    currentTheme,
    settings,
    setCurrentTheme,
    setSettings,
    restoreSession,
  } = useWorkspaceLoader({
    api,
    checkInstallation,
  })

  useSessionPolling({ api, projects, openTabs, updateTab })

  useApiListeners({
    api,
    projects,
    settings,
    addTab,
    updateTab,
    setActiveTab,
    tileTree: activeTileTree,
    setTileTree: setActiveTileTree,
    openTabs,
  })

  const {
    handleAddProject,
    handleAddProjectsFromParent,
    handleOpenSession,
    handleOpenSessionAtPosition,
    handleAddTabToTile,
    handleCloseTab,
    handleCloseProjectTabs,
    handleProjectCreated,
    handleUndoCloseTab,
    canUndoCloseTab
  } = useProjectHandlers({
    api,
    projects,
    openTabs,
    settings,
    tileTree: activeTileTree,
    addProject,
    removeTab,
    addTab,
    setActiveTab,
    setTileTree: setActiveTileTree,
  })

  const handleRenameTab = useCallback((id: string, title: string) => {
    updateTab(id, { title, customTitle: true })
  }, [updateTab])

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [mobileConnectOpen, setMobileConnectOpen] = useState(false)
  const [showFileBrowser, setShowFileBrowser] = useState(false)
  const [fileBrowserPath, setFileBrowserPath] = useState<string | null>(null)
  const hadProjectsRef = useRef(false)
  const terminalContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    voiceOutputEnabledRef.current = voiceOutputEnabled
  }, [voiceOutputEnabled])

  // Orphan healer: every openTab in the active session must appear in its tileTree
  useEffect(() => {
    const tabIds = openTabs.map(t => t.id)
    if (tabIds.length === 0) return
    const tabsInTree = activeTileTree ? getAllTabIds(activeTileTree) : new Set<string>()
    const orphanIds = tabIds.filter(id => !tabsInTree.has(id))
    if (orphanIds.length === 0) return
    const orphanLeaf = createLeaf(generateTileId(), orphanIds, orphanIds[0])
    const newTree = activeTileTree
      ? createBranch(generateTileId(), 'horizontal', [activeTileTree, orphanLeaf])
      : orphanLeaf
    setActiveTileTree(newTree)
  }, [openTabs, activeTileTree, setActiveTileTree])

  // Apply per-project voice when active tab changes
  useEffect(() => {
    if (!activeTabId) { setProjectVoice(null); return }
    const activeTab = openTabs.find(t => t.id === activeTabId)
    if (!activeTab) { setProjectVoice(null); return }
    const project = projects.find(p => p.path === activeTab.projectPath)
    if (project?.ttsVoice && project?.ttsEngine) {
      setProjectVoice({ ttsVoice: project.ttsVoice, ttsEngine: project.ttsEngine })
    } else {
      setProjectVoice(null)
    }
  }, [activeTabId, openTabs, projects, setProjectVoice])

  // Save workspace when state changes
  useEffect(() => {
    if (loading) return

    const hadProjects = sessionStorage.getItem('hadProjects') === 'true' || hadProjectsRef.current
    if (projects.length === 0 && hadProjects) {
      console.warn('Skipping save: projects empty but previously had projects (likely hot reload)')
      return
    }
    if (projects.length > 0) {
      hadProjectsRef.current = true
      sessionStorage.setItem('hadProjects', 'true')
    }

    const allSessions = useWorkspaceStore.getState().sessions
    const savedSessions = serializeSessionsForSave(allSessions)

    api.saveWorkspace({
      projects,
      categories,
      sessions: savedSessions,
      activeSessionId,
    })
  }, [api, projects, openTabs, activeTabId, loading, activeTileTree, categories, sessions, activeSessionId])

  // Workspace switcher handlers
  const handleSwitchSession = useCallback(async (id: string) => {
    const state = useWorkspaceStore.getState()
    const session = state.sessions.find(s => s.id === id)
    if (!session) return

    if (!session.isRestored) {
      // Lazy restore before switching
      await restoreSession(id)
    }
    switchSession(id)
    // Trigger resize so terminals refit
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
    setTimeout(() => window.dispatchEvent(new Event('resize')), 200)
  }, [restoreSession, switchSession])

  const handleAddSession = useCallback(() => {
    addSession()
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  }, [addSession])

  const handleRemoveSession = useCallback((id: string) => {
    const state = useWorkspaceStore.getState()
    const session = state.sessions.find(s => s.id === id)
    if (session) {
      for (const tab of session.openTabs) {
        api.killPty(tab.id)
      }
    }
    removeSession(id)
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  }, [api, removeSession])

  const openMobileDrawer = useCallback(() => setMobileDrawerOpen(true), [])
  const closeMobileDrawer = useCallback(() => setMobileDrawerOpen(false), [])

  const handleOpenFileBrowser = useCallback((projectPath?: string) => {
    setFileBrowserPath(projectPath || null)
    setShowFileBrowser(true)
  }, [])

  if (loading) {
    return (
      <div className="app">
        <div className="empty-state" role="status" aria-live="polite">
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  const isMobile = !isElectron

  return (
    <div className="app">
      <TitleBar />
      <div className="app-content">
        <Sidebar
          projects={projects}
          openTabs={openTabs}
          activeTabId={activeTabId}
          lastFocusedTabId={lastFocusedTabId}
          onAddProject={handleAddProject}
          onAddProjectsFromParent={handleAddProjectsFromParent}
          onRemoveProject={removeProject}
          onOpenSession={handleOpenSession}
          onSwitchToTab={setActiveTab}
          onOpenSettings={openSettings}
          onOpenMakeProject={openMakeProject}
          onUpdateProject={updateProject}
          onCloseProjectTabs={handleCloseProjectTabs}
          width={sidebarWidth}
          collapsed={sidebarCollapsed}
          onWidthChange={setSidebarWidth}
          onCollapsedChange={setSidebarCollapsed}
          isMobileOpen={mobileDrawerOpen}
          onMobileClose={closeMobileDrawer}
          onOpenMobileConnect={() => setMobileConnectOpen(true)}
          onDisconnect={onDisconnect}
        />

        {/* Mobile: each terminal as its own slide */}
        {isMobile && openTabs.map((tab) => (
          <div key={tab.id} className="mobile-terminal-slide">
            <div className="mobile-slide-header">
              <span className="mobile-slide-title">{tab.title}</span>
              <button className="mobile-slide-close" onClick={() => handleCloseTab(tab.id)}>×</button>
            </div>
            <div className="mobile-slide-content">
              <ErrorBoundary componentName={`Terminal (${tab.title || tab.id})`}>
                <Terminal
                  ptyId={tab.id}
                  isActive={true}
                  theme={currentTheme}
                  onFocus={() => setLastFocusedTabId(tab.id)}
                  projectPath={tab.projectPath}
                  backend={tab.backend}
                  api={api}
                  isMobile={true}
                  onOpenFileBrowser={() => handleOpenFileBrowser(tab.projectPath || undefined)}
                />
              </ErrorBoundary>
            </div>
          </div>
        ))}

        {/* Desktop */}
        {!isMobile && (
          <div className="main-content">
            {claudeInstalled === false || gitBashInstalled === false ? (
              <InstallationPrompt
                claudeInstalled={claudeInstalled}
                npmInstalled={npmInstalled}
                gitBashInstalled={gitBashInstalled}
                installing={installing}
                installError={installError}
                installMessage={installMessage}
                onInstallNode={handleInstallNode}
                onInstallGit={handleInstallGit}
                onInstallClaude={handleInstallClaude}
              />
            ) : (
              <>
                <WorkspaceSwitcher
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  onSwitch={handleSwitchSession}
                  onAdd={handleAddSession}
                  onRemove={handleRemoveSession}
                  onRename={renameSession}
                  onReorder={reorderSessions}
                />
                {openTabs.length > 0 ? (
                  <ErrorBoundary componentName="TiledTerminalView">
                    <TiledTerminalView
                      tabs={openTabs}
                      projects={projects}
                      theme={currentTheme}
                      focusedTabId={lastFocusedTabId}
                      onCloseTab={handleCloseTab}
                      onRenameTab={handleRenameTab}
                      onFocusTab={setLastFocusedTabId}
                      tileTree={activeTileTree}
                      onTreeChange={setActiveTileTree}
                      onOpenSessionAtPosition={handleOpenSessionAtPosition}
                      onAddTab={handleAddTabToTile}
                      onUndoCloseTab={canUndoCloseTab ? handleUndoCloseTab : undefined}
                      api={api}
                    />
                  </ErrorBoundary>
                ) : (
                  <div className="empty-state">
                    <h2>Simple Code GUI</h2>
                    <p>Add a project from the sidebar, then click a session to open it</p>
                  </div>
                )}
              </>
            )}
            {/* Background terminals: keep inactive workspace PTYs mounted to preserve xterm/PTY state */}
            {sessions
              .filter(s => s.id !== activeSessionId && s.isRestored && s.openTabs.length > 0)
              .flatMap(s => s.openTabs)
              .map(tab => (
                <div
                  key={tab.id}
                  style={{ position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' }}
                >
                  <ErrorBoundary componentName={`BgTerminal(${tab.id})`}>
                    <Terminal
                      ptyId={tab.id}
                      isActive={false}
                      theme={currentTheme}
                      onFocus={() => {}}
                      projectPath={tab.projectPath}
                      backend={tab.backend}
                      api={api}
                      isMobile={false}
                    />
                  </ErrorBoundary>
                </div>
              ))
            }
          </div>
        )}

        <SettingsModal
          isOpen={settingsOpen}
          onClose={closeSettings}
          onThemeChange={setCurrentTheme}
          onSaved={(newSettings) => setSettings(newSettings)}
          appVersion={appVersion}
          updateStatus={updateStatus}
          onDownloadUpdate={downloadUpdate}
          onInstallUpdate={installUpdate}
        />

        <MakeProjectModal
          isOpen={makeProjectOpen}
          onClose={closeMakeProject}
          onProjectCreated={handleProjectCreated}
        />

        {isElectron && (
          <MobileConnectModal
            isOpen={mobileConnectOpen}
            onClose={() => setMobileConnectOpen(false)}
            port={38470}
          />
        )}

        {isMobile && showFileBrowser && fileBrowserPath && (() => {
          const connInfo = api.getConnectionInfo?.()
          if (!connInfo) return null
          const hostConfig: HostConfig = {
            id: 'current',
            name: 'Desktop',
            host: connInfo.host,
            port: connInfo.port,
            token: connInfo.token
          }
          return (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 }}>
              <FileBrowser
                host={hostConfig}
                basePath={fileBrowserPath}
                onClose={() => setShowFileBrowser(false)}
              />
            </div>
          )
        })()}
      </div>
    </div>
  )
}
