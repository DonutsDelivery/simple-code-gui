import React, { useEffect, useState, useCallback, useRef, RefObject } from 'react'
import { TitleBar } from '../components/TitleBar'
import { Sidebar } from '../components/Sidebar'
import { TerminalTabs } from '../components/TerminalTabs'
import { Terminal } from '../components/terminal/Terminal'
import { TiledTerminalView } from '../components/TiledTerminalView'
import { SettingsModal } from '../components/SettingsModal'
import { MakeProjectModal } from '../components/MakeProjectModal'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { FileBrowser } from '../components/mobile/FileBrowser'
import type { HostConfig } from '../hooks/useHostConnection'
import { useWorkspaceStore } from '../stores/workspace'
import { useVoice } from '../contexts/VoiceContext'
import { useModals } from '../contexts/ModalContext'
import {
  useInstallation,
  useUpdater,
  useViewState,
  useWorkspaceLoader,
  useSessionPolling,
  useApiListeners,
  useProjectHandlers
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
    addProject,
    removeProject,
    updateProject,
    addTab,
    removeTab,
    updateTab,
    setActiveTab
  } = useWorkspaceStore()

  const { voiceOutputEnabled, setProjectVoice } = useVoice()
  const voiceOutputEnabledRef = useRef(voiceOutputEnabled)

  // Modal state from context
  const { settingsOpen, makeProjectOpen, openSettings, closeSettings, openMakeProject, closeMakeProject } = useModals()

  // Installation state from hook
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

  // Updater state from hook
  const { appVersion, updateStatus, downloadUpdate, installUpdate } = useUpdater()

  // View state from hook
  const {
    viewMode,
    tileLayout,
    lastFocusedTabId,
    sidebarWidth,
    sidebarCollapsed,
    setViewMode,
    setTileLayout,
    setLastFocusedTabId,
    setSidebarWidth,
    setSidebarCollapsed,
    toggleViewMode
  } = useViewState()

  // Workspace loader hook
  const {
    loading,
    currentTheme,
    settings,
    setCurrentTheme,
    setSettings
  } = useWorkspaceLoader({
    api,
    checkInstallation,
    setViewMode,
    setTileLayout
  })

  // Session polling hook
  useSessionPolling({ api, openTabs, updateTab })

  // API listeners hook
  useApiListeners({
    api,
    projects,
    settings,
    addTab,
    updateTab,
    setActiveTab
  })

  // Project handlers hook
  const {
    handleAddProject,
    handleAddProjectsFromParent,
    handleOpenSession,
    handleOpenSessionAtPosition,
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
    tileLayout,
    addProject,
    removeTab,
    addTab,
    setActiveTab,
    setTileLayout
  })

  // App-specific state
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [mobileConnectOpen, setMobileConnectOpen] = useState(false)
  const [showFileBrowser, setShowFileBrowser] = useState(false)
  const [fileBrowserPath, setFileBrowserPath] = useState<string | null>(null)
  const hadProjectsRef = useRef(false)
  const terminalContainerRef = useRef<HTMLDivElement>(null)

  // Keep ref in sync for callbacks
  useEffect(() => {
    voiceOutputEnabledRef.current = voiceOutputEnabled
  }, [voiceOutputEnabled])

  // Apply per-project voice settings when active tab changes
  useEffect(() => {
    if (!activeTabId) {
      setProjectVoice(null)
      return
    }
    const activeTab = openTabs.find(t => t.id === activeTabId)
    if (!activeTab) {
      setProjectVoice(null)
      return
    }
    const project = projects.find(p => p.path === activeTab.projectPath)
    if (project?.ttsVoice && project?.ttsEngine) {
      setProjectVoice({ ttsVoice: project.ttsVoice, ttsEngine: project.ttsEngine })
    } else {
      setProjectVoice(null)
    }
  }, [activeTabId, openTabs, projects, setProjectVoice])

  // Save workspace when it changes
  useEffect(() => {
    if (!loading) {
      const hadProjects = sessionStorage.getItem('hadProjects') === 'true' || hadProjectsRef.current

      if (projects.length === 0 && hadProjects) {
        console.warn('Skipping save: projects empty but previously had projects (likely hot reload)')
        return
      }

      if (projects.length > 0) {
        hadProjectsRef.current = true
        sessionStorage.setItem('hadProjects', 'true')
      }

      api.saveWorkspace({
        projects,
        openTabs: openTabs.map(t => ({
          id: t.id,
          projectPath: t.projectPath,
          sessionId: t.sessionId,
          title: t.title,
          ptyId: t.ptyId,
          backend: t.backend
        })),
        activeTabId,
        viewMode,
        tileLayout,
        categories
      })
    }
  }, [api, projects, openTabs, activeTabId, loading, viewMode, tileLayout, categories])

  // Mobile drawer handlers
  const openMobileDrawer = useCallback(() => {
    setMobileDrawerOpen(true)
  }, [])

  const closeMobileDrawer = useCallback(() => {
    setMobileDrawerOpen(false)
  }, [])

  // Open file browser (mobile only)
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

        {/* Mobile: render each terminal as its own slide */}
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

        {/* Desktop: wrap terminals in main-content */}
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
            ) : openTabs.length > 0 ? (
              <>
                <div className="terminal-header">
                  {viewMode === 'tabs' && (
                    <TerminalTabs
                      tabs={openTabs}
                      activeTabId={activeTabId}
                      onSelectTab={setActiveTab}
                      onCloseTab={handleCloseTab}
                      onNewSession={(projectPath) => handleOpenSession(projectPath, undefined, undefined, undefined, true)}
                      swipeContainerRef={terminalContainerRef as RefObject<HTMLElement>}
                      onOpenSidebar={openMobileDrawer}
                    />
                  )}
                  <button
                    className="view-toggle-btn"
                    onClick={toggleViewMode}
                    title={viewMode === 'tabs' ? 'Switch to tiled view' : 'Switch to tabs view'}
                  >
                    {viewMode === 'tabs' ? '\u229E' : '\u25AD'}
                  </button>
                </div>
                {viewMode === 'tabs' ? (
                  <div className="terminal-container" ref={terminalContainerRef}>
                    {openTabs.map((tab) => (
                      <div
                        key={tab.id}
                        className={`terminal-wrapper ${tab.id === activeTabId ? 'active' : ''}`}
                      >
                        <ErrorBoundary componentName={`Terminal (${tab.title || tab.id})`}>
                          <Terminal
                            ptyId={tab.id}
                            isActive={tab.id === activeTabId}
                            theme={currentTheme}
                            onFocus={() => setLastFocusedTabId(tab.id)}
                            projectPath={tab.projectPath}
                            backend={tab.backend}
                            api={api}
                          />
                        </ErrorBoundary>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ErrorBoundary componentName="TiledTerminalView">
                    <TiledTerminalView
                      tabs={openTabs}
                      projects={projects}
                      theme={currentTheme}
                      focusedTabId={lastFocusedTabId}
                      onCloseTab={handleCloseTab}
                      onFocusTab={setLastFocusedTabId}
                      layout={tileLayout}
                      onLayoutChange={setTileLayout}
                      onOpenSessionAtPosition={handleOpenSessionAtPosition}
                      onAddTab={(projectPath) => handleOpenSession(projectPath, undefined, undefined, undefined, true)}
                      onUndoCloseTab={canUndoCloseTab ? handleUndoCloseTab : undefined}
                      api={api}
                    />
                  </ErrorBoundary>
                )}
              </>
            ) : (
              <div className="empty-state">
                <h2>Simple Code GUI</h2>
                <p>Add a project from the sidebar, then click a session to open it</p>
              </div>
            )}
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

        {/* Mobile Connect Modal (QR Code) - only show in Electron */}
        {isElectron && (
          <MobileConnectModal
            isOpen={mobileConnectOpen}
            onClose={() => setMobileConnectOpen(false)}
            port={38470}
          />
        )}

        {/* File Browser Modal (mobile only) */}
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
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 100
            }}>
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
