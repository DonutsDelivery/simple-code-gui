import React, { useEffect, useState, useCallback, useRef, RefObject } from 'react'
import { TitleBar } from '../components/TitleBar'
import { Sidebar } from '../components/Sidebar'
import { Terminal } from '../components/terminal/Terminal'
import { TiledTerminalView } from '../components/tiled/index.js'
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher'
import { WorkspaceViewToggle } from '../components/WorkspaceViewToggle'
import { CanvasWorkspaceView } from '../components/canvas/CanvasWorkspaceView'
import type { CanvasPoint } from '../components/canvas/scene-model'
import { getAllTabIds, createLeaf, createBranch, generateTileId, findLeafById, remapTabIds } from '../components/tile-tree'
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
  useAgentNotifications,
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
  const isMobile = !isElectron
  const {
    projects,
    openTabs,
    activeTabId,
    categories,
    sessions,
    activeSessionId,
    activeTileTree,
    activeCanvasScene,
    activeView,
    attentionByTabId,
    addProject,
    removeProject,
    updateProject,
    addTab,
    removeTab,
    updateTab,
    setActiveTab,
    setActiveTileTree,
    setActiveCanvasScene,
    setActiveView,
    addSession,
    removeSession,
    renameSession,
    reorderSessions,
    switchSession,
    setSessionSavedData,
    moveTabsToSession,
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

  useAgentNotifications({ api, settings, isMobile })

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

  const handleFocusCanvasTab = useCallback((id: string) => {
    setActiveTab(id)
    setLastFocusedTabId(id)
  }, [setActiveTab, setLastFocusedTabId])

  const handleRenameTab = useCallback((id: string, title: string) => {
    updateTab(id, { title, customTitle: true })
  }, [updateTab])

  const handleResumeTab = useCallback(async (id: string) => {
    const tab = useWorkspaceStore.getState().openTabs.find(candidate => candidate.id === id)
    if (!tab) return

    const backend = !tab.backend || tab.backend === 'default' ? 'claude' : tab.backend
    const newPtyId = await api.spawnPty(
      tab.projectPath,
      tab.sessionId,
      undefined,
      backend
    )

    updateTab(id, { id: newPtyId, ptyId: newPtyId })
    if (activeTileTree) {
      setActiveTileTree(remapTabIds(activeTileTree, new Map([[id, newPtyId]])))
    }
    setActiveTab(newPtyId)
  }, [activeTileTree, api, setActiveTab, setActiveTileTree, updateTab])

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
  }, [restoreSession, switchSession])

  // Move a sub-tab or whole tile from the active session into another workspace session
  const handleMoveTabs = useCallback(async (
    toSessionId: string,
    payload: { type: 'subtab'; tabId: string } | { type: 'tile'; tileId: string }
  ) => {
    if (toSessionId === useWorkspaceStore.getState().activeSessionId) return
    let tabIds: string[] = []
    if (payload.type === 'subtab') {
      tabIds = [payload.tabId]
    } else {
      const tree = useWorkspaceStore.getState().activeTileTree
      const leaf = tree ? findLeafById(tree, payload.tileId) : null
      if (!leaf) return
      tabIds = [...leaf.tabIds]
    }
    if (tabIds.length === 0) return

    // Restore the target session if it's lazily loaded so its tile tree exists
    const target = useWorkspaceStore.getState().sessions.find(s => s.id === toSessionId)
    if (target && !target.isRestored) {
      await restoreSession(toSessionId)
    }
    moveTabsToSession(tabIds, toSessionId)
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  }, [restoreSession, moveTabsToSession])

  const handleDropProjectOnCanvas = useCallback(async (projectPath: string, point: CanvasPoint) => {
    const before = new Set(useWorkspaceStore.getState().openTabs.map(tab => tab.id))
    await handleOpenSessionAtPosition(
      projectPath,
      null,
      { width: window.innerWidth, height: window.innerHeight }
    )

    const state = useWorkspaceStore.getState()
    const addedTab = state.openTabs.find(tab => !before.has(tab.id) && tab.projectPath === projectPath)
    const scene = state.activeCanvasScene
    if (!addedTab || !scene) return
    const node = scene.nodes.find(candidate => candidate.tabIds.includes(addedTab.id))
    if (!node) return
    setActiveCanvasScene({
      ...scene,
      nodes: scene.nodes.map(candidate => candidate.id === node.id
        ? { ...candidate, rect: { ...candidate.rect, x: point.x, y: point.y } }
        : candidate),
    })
  }, [handleOpenSessionAtPosition, setActiveCanvasScene])

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
          <div
            key={tab.id}
            data-agent-visible-tab-id={tab.id}
            className={`mobile-terminal-slide${attentionByTabId[tab.id] ? ` has-agent-attention has-agent-attention--${attentionByTabId[tab.id]}` : ''}`}
          >
            <div className="mobile-slide-header" aria-label={`${tab.title}${attentionByTabId[tab.id] === 'needs-input' ? ', needs your input' : attentionByTabId[tab.id] === 'completed' ? ', agent completed' : ''}`}>
              <span className="mobile-slide-title">{tab.title}</span>
              {attentionByTabId[tab.id] && <span className="agent-attention-dot" aria-hidden="true" />}
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
                <div className="workspace-top-bar">
                  <WorkspaceSwitcher
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    onSwitch={handleSwitchSession}
                    onAdd={handleAddSession}
                    onRemove={handleRemoveSession}
                    onRename={renameSession}
                    onReorder={reorderSessions}
                    onMoveTabs={handleMoveTabs}
                  />
                  <WorkspaceViewToggle value={activeView} onChange={setActiveView} />
                </div>
                {activeView === 'tiles' && openTabs.length === 0 && (
                  <div className="empty-state">
                    <h2>Simple Code GUI</h2>
                    <p>Add a project from the sidebar, then click a session to open it</p>
                  </div>
                )}
                {sessions
                  // Keep background PTYs alive, but mount renderers only for the
                  // active workspace and its selected layout.
                  .filter(session => session.id === activeSessionId && session.isRestored)
                  .map(session => {
                    const isWorkspaceActive = session.id === activeSessionId
                    return (
                      <div
                        key={session.id}
                        style={isWorkspaceActive
                          ? { display: 'flex', flex: 1, minHeight: 0, position: 'relative' }
                          : { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' }}
                      >
                        {session.activeView === 'canvas' && (session.canvasScene ?? activeCanvasScene) ? (
                          <ErrorBoundary componentName={`CanvasWorkspaceView(${session.id})`}>
                            <CanvasWorkspaceView
                              tabs={session.openTabs}
                              projects={projects}
                              theme={currentTheme}
                              scene={(session.canvasScene ?? activeCanvasScene)!}
                              onSceneChange={setActiveCanvasScene}
                              focusedTabId={lastFocusedTabId}
                              onFocusTab={handleFocusCanvasTab}
                              onCloseTab={handleCloseTab}
                              onResumeTab={handleResumeTab}
                              onRenameTab={handleRenameTab}
                              onDropProject={handleDropProjectOnCanvas}
                              api={api}
                              isWorkspaceActive={isWorkspaceActive}
                            />
                          </ErrorBoundary>
                        ) : (
                          <ErrorBoundary componentName={`TiledTerminalView(${session.id})`}>
                            <TiledTerminalView
                              tabs={session.openTabs}
                              projects={projects}
                              theme={currentTheme}
                              focusedTabId={isWorkspaceActive ? lastFocusedTabId : null}
                              onCloseTab={handleCloseTab}
                              onRenameTab={handleRenameTab}
                              onFocusTab={isWorkspaceActive ? setLastFocusedTabId : () => {}}
                              tileTree={session.activeTileTree}
                              onTreeChange={isWorkspaceActive ? setActiveTileTree : () => {}}
                              onOpenSessionAtPosition={isWorkspaceActive ? handleOpenSessionAtPosition : undefined}
                              onAddTab={isWorkspaceActive ? handleAddTabToTile : undefined}
                              onUndoCloseTab={isWorkspaceActive && canUndoCloseTab ? handleUndoCloseTab : undefined}
                              api={api}
                            />
                          </ErrorBoundary>
                        )}
                      </div>
                    )
                  })}
              </>
            )}
          </div>
        )}

        <SettingsModal
          isOpen={settingsOpen}
          api={api}
          settings={settings}
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
