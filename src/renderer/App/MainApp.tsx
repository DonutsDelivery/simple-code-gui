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
import { serverResourceKey, tabResourceKey, useWorkspaceStore } from '../stores/workspace'
import {
  EnvironmentCacheInvalidatedError,
  resolveAuthoritativeEnvironmentEvent,
  saveAuthoritativeWorkspace,
  consumeAuthoritativeSaveSuppression,
  serializeSessionsForSave,
} from '../stores/workspace-persistence'
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
import { getApi, getConnectedServerIds, type Api } from '../api'
import { InstallationPrompt } from './InstallationPrompt'
import { MobileConnectModal } from './MobileConnectModal'
import { ConnectionsModal } from '../components/ConnectionsModal'

export interface MainAppProps {
  serverId: string
  api: Api
  isElectron: boolean
  onDisconnect?: () => void
}

export function MainApp({ serverId, api, isElectron, onDisconnect }: MainAppProps): React.ReactElement {
  const isMobile = !isElectron
  const getApiForServer = useCallback((targetServerId: string): Api | undefined =>
    getApi(targetServerId) || undefined, [])
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
    applyAuthoritativeWorkspace,
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
    serverId,
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

  useAgentNotifications({ serverId, api, settings, isMobile })

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
    serverId,
    api,
    getApiForServer,
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
    const tabApi = getApiForServer(tab.serverId)
    if (!tabApi) throw new Error(`Server ${tab.serverId} is disconnected`)
    const newPtyId = await tabApi.spawnPty(
      tab.projectPath,
      tab.sessionId,
      undefined,
      backend,
      tab.agentSessionId || tab.sessionId || tab.authorityTabId || id,
    )
    const rendererTabId = serverResourceKey(tab.serverId, newPtyId)

    updateTab(id, {
      id: rendererTabId,
      authorityTabId: newPtyId,
      ptyId: newPtyId,
      agentSessionId: tab.agentSessionId || tab.sessionId || tab.authorityTabId || id,
    })
    if (activeTileTree) {
      setActiveTileTree(remapTabIds(activeTileTree, new Map([[id, rendererTabId]])))
    }
    setActiveTab(rendererTabId)
  }, [activeTileTree, getApiForServer, setActiveTab, setActiveTileTree, updateTab])

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [mobileConnectOpen, setMobileConnectOpen] = useState(false)
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [showFileBrowser, setShowFileBrowser] = useState(false)
  const [fileBrowserPath, setFileBrowserPath] = useState<string | null>(null)
  const hadProjectsRef = useRef(false)
  const terminalContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    voiceOutputEnabledRef.current = voiceOutputEnabled
  }, [voiceOutputEnabled])

  useEffect(() => {
    if (!api.onEnvironmentEvent) return
    let mounted = true
    const unsubscribe = api.onEnvironmentEvent((event) => {
      void resolveAuthoritativeEnvironmentEvent(api, serverId, event)
        .then((snapshot) => {
          if (!mounted || !snapshot) return
          applyAuthoritativeWorkspace(serverId, snapshot.workspace)
        })
        .catch(error => console.error('Failed to synchronize server environment:', error))
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [api, applyAuthoritativeWorkspace, serverId])

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
    const project = projects.find(p => p.serverId === activeTab.serverId && p.path === activeTab.projectPath)
    if (project?.ttsVoice && project?.ttsEngine) {
      setProjectVoice({ ttsVoice: project.ttsVoice, ttsEngine: project.ttsEngine })
    } else {
      setProjectVoice(null)
    }
  }, [activeTabId, openTabs, projects, setProjectVoice])

  // Save workspace when state changes
  useEffect(() => {
    if (loading) return
    // The authoritative event/catch-up/snapshot path marks a per-server flag
    // when it applied that server's state to the store (MainApp's handler AND
    // the runtime-connections subscriber both flow through it). Consume it per
    // target server so the server's own echo does not bounce a redundant save
    // back (save loop) — without letting one server's authoritative apply
    // suppress a genuine local state change for another connected server.
    const hadProjects = sessionStorage.getItem('hadProjects') === 'true' || hadProjectsRef.current
    if (projects.length === 0 && hadProjects) {
      console.warn('Skipping save: projects empty but previously had projects (likely hot reload)')
      return
    }
    if (projects.length > 0) {
      hadProjectsRef.current = true
      sessionStorage.setItem('hadProjects', 'true')
    }

    // Save the workspace slice of every connected server, not just the active
    // one. Sessions can be created on a paired remote server while another
    // server is active (sidebar project click carries the origin serverId);
    // without a per-server save those sessions never persist to their server
    // and the next authoritative snapshot wipes the tab.
    const allSessions = useWorkspaceStore.getState().sessions
    const connectedIds = getConnectedServerIds()
    const serverIds = connectedIds.includes(serverId) ? connectedIds : [...connectedIds, serverId]
    for (const targetServerId of serverIds) {
      if (consumeAuthoritativeSaveSuppression(targetServerId)) continue
      const targetApi = targetServerId === serverId ? api : getApi(targetServerId)
      if (!targetApi) continue
      const targetProtocol = targetApi.getServerProtocol?.()
      if (targetProtocol && !targetProtocol.capabilities.workspaceWrite) continue
      const hasContent = projects.some(project => project.serverId === targetServerId)
        || allSessions.some(session => session.serverId === targetServerId)
      if (!hasContent) continue

      const savedSessions = serializeSessionsForSave(allSessions, targetServerId)
      const serverPrefix = `${targetServerId}\0`
      const toAuthorityId = (id: string): string => id.startsWith(serverPrefix) ? id.slice(serverPrefix.length) : id
      const savedProjects = projects
        .filter(project => project.serverId === targetServerId)
        .map(({ serverId: _serverId, ...project }) => ({
          ...project,
          categoryId: project.categoryId ? toAuthorityId(project.categoryId) : undefined,
        }))
      const savedCategories = categories
        .filter(category => category.serverId === targetServerId)
        .map(({ serverId: _serverId, ...category }) => ({ ...category, id: toAuthorityId(category.id) }))

      void saveAuthoritativeWorkspace(targetApi, targetServerId, {
        projects: savedProjects,
        categories: savedCategories,
        sessions: savedSessions,
        activeSessionId: allSessions.find(session => session.id === activeSessionId && session.serverId === targetServerId)?.authoritySessionId ?? null,
      }).catch(error => {
        if (!(error instanceof EnvironmentCacheInvalidatedError)) {
          console.error('Failed to save workspace:', error)
        }
      })
    }
  }, [api, serverId, projects, openTabs, activeTabId, loading, activeTileTree, categories, sessions, activeSessionId])

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

  const handleDropProjectOnCanvas = useCallback(async (projectPath: string, point: CanvasPoint, harnessId?: string) => {
    const before = new Set(useWorkspaceStore.getState().openTabs.map(tab => tab.id))
    await handleOpenSessionAtPosition(
      projectPath,
      null,
      { width: window.innerWidth, height: window.innerHeight },
      undefined,
      harnessId
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
    addSession(serverId)
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  }, [addSession, serverId])

  const handleRemoveSession = useCallback((id: string) => {
    const state = useWorkspaceStore.getState()
    const session = state.sessions.find(s => s.id === id)
    if (session) {
      for (const tab of session.openTabs) {
        getApiForServer(tab.serverId)?.killPty(tab.id)
      }
    }
    removeSession(id)
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  }, [getApiForServer, removeSession])

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
          serverId={serverId}
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
          onOpenMobileConnect={() => setConnectionsOpen(true)}
          onTranscription={(text) => {
            const tabId = lastFocusedTabId || activeTabId
            const tab = openTabs.find(candidate => candidate.id === tabId)
            if (!tab) return
            const tabApi = getApiForServer(tab.serverId)
            if (!tabApi) throw new Error(`Server ${tab.serverId} is disconnected`)
            const ptyId = tab.ptyId || tab.authorityTabId
            if (!ptyId) throw new Error(`Tab ${tab.id} has no PTY identity`)
            tabApi.writePty(ptyId, text)
            setTimeout(() => tabApi.writePty(ptyId, '\r'), 100)
          }}
          onDisconnect={onDisconnect}
          getApiForServer={getApiForServer}
          defaultHarnessId={settings?.defaultHarnessId ?? settings?.backend ?? 'default'}
        />

        {/* Mobile: each terminal as its own slide */}
        {isMobile && openTabs.map((tab) => (
          <div
            key={tab.id}
            data-agent-visible-tab-id={tabResourceKey(tab)}
            className={`mobile-terminal-slide${attentionByTabId[tabResourceKey(tab)] ? ` has-agent-attention has-agent-attention--${attentionByTabId[tabResourceKey(tab)]}` : ''}`}
          >
            <div className="mobile-slide-header" aria-label={`${tab.title}${attentionByTabId[tabResourceKey(tab)] === 'needs-input' ? ', needs your input' : attentionByTabId[tabResourceKey(tab)] === 'completed' ? ', agent completed' : ''}`}>
              <span className="mobile-slide-title">{tab.title}</span>
              {attentionByTabId[tabResourceKey(tab)] && <span className="agent-attention-dot" aria-hidden="true" />}
              <button className="mobile-slide-close" onClick={() => handleCloseTab(tab.id)}>×</button>
            </div>
            <div className="mobile-slide-content">
              <ErrorBoundary componentName={`Terminal (${tab.title || tab.id})`}>
                <Terminal
                  ptyId={tab.ptyId || tab.authorityTabId || tab.id}
                  isActive={true}
                  theme={currentTheme}
                  onFocus={() => setLastFocusedTabId(tab.id)}
                  projectPath={tab.projectPath}
                  backend={tab.backend}
                  api={getApiForServer(tab.serverId)}
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
            {claudeInstalled === false && (settings?.defaultHarnessId ?? settings?.backend ?? 'default') === 'claude' ? (
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
                  <div className="empty-state workspace-empty-state">
                    <h2>DonutCode</h2>
                    <p>Add a project from the sidebar, then click a session to open it</p>
                  </div>
                )}
                {sessions
                  // Preserve xterm scrollback and subscriptions after a workspace
                  // has been restored; inactive workspaces remain hidden below.
                  .filter(session => session.isRestored)
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
                              getApiForServer={getApiForServer}
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
                              attentionByTabId={attentionByTabId}
                              onCloseTab={handleCloseTab}
                              onRenameTab={handleRenameTab}
                              onFocusTab={isWorkspaceActive ? setLastFocusedTabId : () => {}}
                              tileTree={session.activeTileTree}
                              onTreeChange={isWorkspaceActive ? setActiveTileTree : () => {}}
                              onOpenSessionAtPosition={isWorkspaceActive ? handleOpenSessionAtPosition : undefined}
                              onAddTab={isWorkspaceActive ? handleAddTabToTile : undefined}
                              onUndoCloseTab={isWorkspaceActive && canUndoCloseTab ? handleUndoCloseTab : undefined}
                              api={api}
                              getApiForServer={getApiForServer}
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

        {connectionsOpen && (
          <ConnectionsModal activeServerId={serverId} onClose={() => setConnectionsOpen(false)} />
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
