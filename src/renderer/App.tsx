import React, { useEffect, useState, useCallback, useRef, RefObject } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { TerminalTabs } from './components/TerminalTabs'
import { Terminal, clearTerminalBuffer, cleanupOrphanedBuffers } from './components/Terminal'
import { TiledTerminalView, TileLayout } from './components/TiledTerminalView'
import { SettingsModal } from './components/SettingsModal'
import { MakeProjectModal } from './components/MakeProjectModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useWorkspaceStore, OpenTab } from './stores/workspace'
import { Theme, getThemeById, applyTheme, themes } from './themes'
import { useVoice } from './contexts/VoiceContext'
import { useModals } from './contexts/ModalContext'
import { useInstallation, useUpdater, useViewState, AppSettings } from './hooks'
import type { ElectronAPI } from '../preload/index'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

function App() {
  const {
    projects,
    openTabs,
    activeTabId,
    categories,
    setProjects,
    setCategories,
    addProject,
    removeProject,
    updateProject,
    addTab,
    removeTab,
    updateTab,
    setActiveTab,
    clearTabs
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

  // App-specific state that needs to stay in App.tsx
  const [loading, setLoading] = useState(true)
  const [currentTheme, setCurrentTheme] = useState<Theme>(themes[0])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const initRef = useRef(false)
  const hadProjectsRef = useRef(false) // Track if we ever had projects loaded
  const terminalContainerRef = useRef<HTMLDivElement>(null)

  // Mobile drawer handlers
  const openMobileDrawer = useCallback(() => {
    setMobileDrawerOpen(true)
  }, [])

  const closeMobileDrawer = useCallback(() => {
    setMobileDrawerOpen(false)
  }, [])

  // Load workspace on mount and restore tabs
  useEffect(() => {
    // Prevent double initialization from StrictMode
    if (initRef.current) return
    initRef.current = true

    const loadWorkspace = async () => {
      try {
        // Check if Claude, npm, and git-bash are installed
        await checkInstallation()

        // Load and apply theme
        const settings = await window.electronAPI.getSettings()
        setSettings(settings)
        const theme = getThemeById(settings.theme || 'default')
        applyTheme(theme)
        setCurrentTheme(theme)

        // Kill any existing PTYs from hot reload (but don't clear buffers - they'll be restored)
        const existingTabs = useWorkspaceStore.getState().openTabs
        for (const tab of existingTabs) {
          window.electronAPI.killPty(tab.id)
          // Note: Don't clear buffers here - they're used for HMR recovery
        }
        clearTabs()

        const workspace = await window.electronAPI.getWorkspace()
        if (workspace.projects) {
          setProjects(workspace.projects)
          if (workspace.projects.length > 0) {
            hadProjectsRef.current = true
          }
          // Install TTS instructions for all existing projects
          for (const project of workspace.projects) {
            await window.electronAPI.ttsInstallInstructions?.(project.path)
          }
        }
        // Load categories
        if (workspace.categories) {
          setCategories(workspace.categories)
        }

        // Restore previously open tabs (only if not already open)
        // Track old ID -> new ID mapping for layout restoration
        const idMapping = new Map<string, string>()

        if (workspace.openTabs && workspace.openTabs.length > 0) {
          const currentTabs = useWorkspaceStore.getState().openTabs
          const usedSessionIds = new Set(currentTabs.map(t => t.sessionId).filter(Boolean))
          const sessionsCache = new Map<string, { list: { sessionId: string; slug: string }[]; nextIndex: number }>()

          for (const savedTab of workspace.openTabs) {
            try {
              // Always install TTS instructions so Claude uses <tts> tags
              await window.electronAPI.ttsInstallInstructions?.(savedTab.projectPath)

              const projectName = savedTab.projectPath.split(/[/\\]/).pop() || savedTab.projectPath
              let titleToRestore = savedTab.title || `${projectName} - New`

              // Get project and determine effective backend for restored tab
              const projectForTab = workspace.projects?.find((p: { path: string }) => p.path === savedTab.projectPath)
              const savedBackend = savedTab.backend && savedTab.backend !== 'default'
                ? savedTab.backend
                : undefined
              const effectiveBackendForTab = savedBackend
                || (projectForTab?.backend && projectForTab.backend !== 'default'
                  ? projectForTab.backend
                  : settings?.backend || 'claude')

              let sessionIdToRestore: string | undefined = savedTab.sessionId

              // Always discover sessions to find the most recent one
              // This handles cases where session changed after save (e.g., user did /clear)
              if (effectiveBackendForTab === 'claude' || effectiveBackendForTab === 'opencode') {
                let sessionsForProject = sessionsCache.get(savedTab.projectPath)
                if (!sessionsForProject) {
                  const backendForDiscovery = effectiveBackendForTab === 'opencode' ? 'opencode' : 'claude'
                  const list = await window.electronAPI.discoverSessions(savedTab.projectPath, backendForDiscovery)
                  sessionsForProject = { list, nextIndex: 0 }
                  sessionsCache.set(savedTab.projectPath, sessionsForProject)
                }

                const list = sessionsForProject.list || []
                for (let i = sessionsForProject.nextIndex; i < list.length; i++) {
                  const candidate = list[i]
                  if (!usedSessionIds.has(candidate.sessionId)) {
                    // Use discovered session (most recent not already in use)
                    sessionIdToRestore = candidate.sessionId
                    titleToRestore = `${projectName} - ${candidate.slug}`
                    sessionsForProject.nextIndex = i + 1
                    break
                  }
                }
              }

              const ptyId = await window.electronAPI.spawnPty(
                savedTab.projectPath,
                sessionIdToRestore,
                undefined, // model
                effectiveBackendForTab
              )
              // Map old tab ID to new ptyId for layout restoration
              if (savedTab.id) {
                idMapping.set(savedTab.id, ptyId)
              }

              addTab({
                id: ptyId,
                projectPath: savedTab.projectPath,
                sessionId: sessionIdToRestore,
                title: titleToRestore,
                ptyId,
                backend: effectiveBackendForTab
              })
              if (sessionIdToRestore) {
                usedSessionIds.add(sessionIdToRestore)
              }
            } catch (e) {
            }
          }
        }

        // Clean up orphaned terminal buffers from previous session/HMR
        // This prevents unbounded memory growth from buffers with old PTY IDs
        const activeTabIds = useWorkspaceStore.getState().openTabs.map(t => t.id)
        cleanupOrphanedBuffers(activeTabIds)

        // Restore view mode (layout auto-generates based on tab count)
        if (workspace.viewMode) {
          setViewMode(workspace.viewMode)
        }
        // Don't restore tileLayout - let it auto-generate for clean grid
      } catch (e) {
        console.error('Failed to load workspace:', e)
      }
      setLoading(false)
    }
    loadWorkspace()
  }, [addTab, clearTabs, checkInstallation, setProjects, setCategories, setViewMode])

  // Save workspace when it changes
  useEffect(() => {
    if (!loading) {
      // Protect against hot reload wiping data:
      // Use sessionStorage to persist flag across HMR (refs get reset)
      const hadProjects = sessionStorage.getItem('hadProjects') === 'true' || hadProjectsRef.current

      if (projects.length === 0 && hadProjects) {
        console.warn('Skipping save: projects empty but previously had projects (likely hot reload)')
        return
      }

      // Track that we have projects (both in ref and sessionStorage for HMR)
      if (projects.length > 0) {
        hadProjectsRef.current = true
        sessionStorage.setItem('hadProjects', 'true')
      }

      window.electronAPI.saveWorkspace({
        projects,
        openTabs: openTabs.map(t => ({
          id: t.id,
          projectPath: t.projectPath,
          sessionId: t.sessionId,
          title: t.title,
          backend: t.backend
        })),
        activeTabId,
        viewMode,
        tileLayout,
        categories
      })
    }
  }, [projects, openTabs, activeTabId, loading, viewMode, tileLayout, categories])

  // Poll for session IDs - update tabs without sessions and detect when sessions change (e.g., after /clear)
  // Uses 30s interval to reduce IPC overhead, only polls tabs that need session discovery
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      if (openTabs.length === 0) return

      // Only poll tabs that don't have a session yet (reduces unnecessary IPC calls)
      const tabsNeedingSession = openTabs.filter(tab => !tab.sessionId)
      if (tabsNeedingSession.length === 0) return

      // Run discovery in parallel for tabs needing sessions (async so non-blocking)
      try {
        await Promise.all(tabsNeedingSession.map(async (tab) => {
          try {
            const effectiveBackend = tab.backend === 'opencode' ? 'opencode' : 'claude'
            const sessions = await window.electronAPI.discoverSessions(tab.projectPath, effectiveBackend)
            if (sessions.length > 0) {
              const mostRecent = sessions[0]

              // Check if we already have this session in another tab
              const alreadyOpen = openTabs.some(t => t.id !== tab.id && t.sessionId === mostRecent.sessionId)
              if (!alreadyOpen) {
                const projectName = tab.projectPath.split(/[/\\]/).pop() || tab.projectPath
                updateTab(tab.id, {
                  sessionId: mostRecent.sessionId,
                  title: `${projectName} - ${mostRecent.slug}`
                })
              }
            }
          } catch (e) {
            console.error('Failed to discover sessions for tab:', e)
          }
        }))
      } catch (e) {
        console.error('Session discovery polling error:', e)
      }
    }, 30000) // Poll every 30 seconds (reduced from 5s to minimize IPC overhead)

    return () => clearInterval(pollInterval)
  }, [openTabs, updateTab])

  // Listen for API requests to open new sessions
  useEffect(() => {
    const unsubscribe = window.electronAPI.onApiOpenSession(async ({ projectPath, autoClose, model }) => {
      // Open a new session for this project (API-triggered)
      const modelLabel = model && model !== 'default' ? ` [${model}]` : ''
      const title = `${projectPath.split(/[/\\]/).pop() || projectPath} - API${modelLabel}${autoClose ? ' (auto-close)' : ''}`

      // Get project and determine effective backend
      const project = projects.find(p => p.path === projectPath)
      const effectiveBackend = project?.backend && project.backend !== 'default'
        ? project.backend
        : settings?.backend || 'claude'

      try {
        // Always install TTS instructions so Claude uses <tts> tags
        await window.electronAPI.ttsInstallInstructions?.(projectPath)

        const ptyId = await window.electronAPI.spawnPty(projectPath, undefined, model, effectiveBackend)
        addTab({
          id: ptyId,
          projectPath,
          title,
          ptyId,
          backend: effectiveBackend
        })
      } catch (e: any) {
        console.error('Failed to spawn PTY for API request:', e)
      }
    })

    return unsubscribe
  }, [addTab, projects, settings?.backend])

  // Listen for PTY recreation events
  useEffect(() => {
    const unsubscribe = window.electronAPI.onPtyRecreated(({ oldId, newId, backend }) => {
      console.log(`PTY recreated: ${oldId} -> ${newId} with backend ${backend}`)
      // Find the tab with the old ID
      const tab = useWorkspaceStore.getState().openTabs.find(t => t.id === oldId)
      if (tab) {
        // Update the tab with the new ID and backend
        updateTab(oldId, { id: newId, ptyId: newId, backend })
        // If it was the active tab, update the active tab ID
        if (useWorkspaceStore.getState().activeTabId === oldId) {
          setActiveTab(newId)
        }
      }
    })
    return unsubscribe
  }, [updateTab, setActiveTab])

  const handleAddProject = useCallback(async () => {
    const path = await window.electronAPI.addProject()
    if (path) {
      // Split on both / and \ for cross-platform support
      const name = path.split(/[/\\]/).pop() || path
      addProject({ path, name })
      // Install TTS instructions for the new project
      await window.electronAPI.ttsInstallInstructions?.(path)
    }
  }, [addProject])

  const handleOpenSession = useCallback(async (projectPath: string, sessionId?: string, slug?: string, initialPrompt?: string, forceNewSession?: boolean) => {
    // Check if this session is already open
    if (sessionId) {
      const existingTab = openTabs.find(tab => tab.sessionId === sessionId)
      if (existingTab) {
        setActiveTab(existingTab.id)
        return
      }
    }

    // Get project and determine effective backend
    const project = projects.find(p => p.path === projectPath)
    const effectiveBackend = project?.backend && project.backend !== 'default'
      ? project.backend
      : settings?.backend || 'claude'

    if (!forceNewSession) {
      try {
        const sessions = await window.electronAPI.discoverSessions(projectPath, effectiveBackend === 'opencode' ? 'opencode' : 'claude')
        if (sessions.length > 0) {
          const [mostRecent] = sessions
          const existingTab = openTabs.find(tab => tab.sessionId === mostRecent.sessionId)
          if (existingTab) {
            setActiveTab(existingTab.id)
            return
          }
          sessionId = mostRecent.sessionId
          slug = mostRecent.slug
        }
      } catch (e) {
        console.error('Failed to discover sessions for project:', e)
      }
    }

    // Split on both / and \ for cross-platform support
    const projectName = projectPath.split(/[/\\]/).pop() || projectPath
    const title = slug ? `${projectName} - ${slug}` : `${projectName} - New`

    try {
      // Always install TTS instructions so Claude uses <tts> tags
      await window.electronAPI.ttsInstallInstructions?.(projectPath)

      // ptyId = await window.electronAPI.spawnPty(projectPath, sessionId, model?, backend?)
      const ptyId = await window.electronAPI.spawnPty(projectPath, sessionId, undefined, effectiveBackend)
      addTab({
        id: ptyId,
        projectPath,
        sessionId,
        title,
        ptyId,
        backend: effectiveBackend
      })

      // If an initial prompt was provided, send it after a short delay to let the terminal initialize
      if (initialPrompt) {
        setTimeout(() => {
          window.electronAPI.writePty(ptyId, initialPrompt)
          // Send enter to submit
          setTimeout(() => {
            window.electronAPI.writePty(ptyId, '\r')
          }, 100)
        }, 1500) // Wait for backend to fully start
      }
    } catch (e: any) {
      console.error('Failed to spawn PTY:', e)
      // Show error to user
      const errorMsg = e?.message || String(e)
      alert(`Failed to start Claude session:\n\n${errorMsg}\n\nPlease ensure Claude Code is installed and try restarting the application.`)
    }
  }, [addTab, openTabs, projects, setActiveTab, settings?.backend, settings])

  const handleCloseTab = useCallback((tabId: string) => {
    window.electronAPI.killPty(tabId)
    clearTerminalBuffer(tabId)
    removeTab(tabId)
  }, [removeTab])

  const handleCloseProjectTabs = useCallback((projectPath: string) => {
    const tabsToClose = openTabs.filter(tab => tab.projectPath === projectPath)
    tabsToClose.forEach(tab => {
      window.electronAPI.killPty(tab.id)
      clearTerminalBuffer(tab.id)
      removeTab(tab.id)
    })
  }, [openTabs, removeTab])

  const handleProjectCreated = useCallback((projectPath: string, projectName: string) => {
    addProject({ path: projectPath, name: projectName })
    handleOpenSession(projectPath, undefined, undefined, undefined, false)
  }, [addProject, handleOpenSession])

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
      />
      <div className="main-content">
        {claudeInstalled === false || gitBashInstalled === false ? (
          <div className="empty-state">
            <h2>{claudeInstalled === false ? 'Claude Code Not Found' : 'Git Required'}</h2>
            <p>{claudeInstalled === false
              ? 'Claude Code needs to be installed to use this application.'
              : 'Claude Code requires Git (git-bash) on Windows.'}</p>
            {installError && (
              <p className="error-message" role="alert" aria-live="assertive">{installError}</p>
            )}
            {installMessage && (
              <p className="install-message" role="status" aria-live="polite">{installMessage}</p>
            )}
            <div className="install-buttons">
              {gitBashInstalled === false && (
                <button
                  className="install-btn"
                  onClick={handleInstallGit}
                  disabled={installing !== null}
                >
                  {installing === 'git' ? 'Installing Git...' : '1. Install Git'}
                </button>
              )}
              {!npmInstalled && (
                <button
                  className="install-btn"
                  onClick={handleInstallNode}
                  disabled={installing !== null}
                >
                  {installing === 'node' ? 'Installing Node.js...' : gitBashInstalled === false ? '2. Install Node.js' : '1. Install Node.js'}
                </button>
              )}
              {claudeInstalled === false && (
                <button
                  className="install-btn"
                  onClick={handleInstallClaude}
                  disabled={installing !== null || !npmInstalled}
                >
                  {installing === 'claude' ? 'Installing Claude...' :
                    (!npmInstalled && gitBashInstalled === false) ? '3. Install Claude Code' :
                    !npmInstalled ? '2. Install Claude Code' : 'Install Claude Code'}
                </button>
              )}
            </div>
            {(gitBashInstalled === false || !npmInstalled) && (
              <p className="install-note">
                {gitBashInstalled === false && !npmInstalled
                  ? 'Git and Node.js are required for Claude Code.'
                  : gitBashInstalled === false
                    ? 'Git is required for Claude Code on Windows.'
                    : 'Node.js is required to install Claude Code.'}
              </p>
            )}
          </div>
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
                  onCloseTab={handleCloseTab}
                  onFocusTab={setLastFocusedTabId}
                  layout={tileLayout}
                  onLayoutChange={setTileLayout}
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

      <SettingsModal
        isOpen={settingsOpen}
        onClose={closeSettings}
        onThemeChange={setCurrentTheme}
        onSaved={(newSettings) => setSettings(newSettings)}
      />

      <MakeProjectModal
        isOpen={makeProjectOpen}
        onClose={closeMakeProject}
        onProjectCreated={handleProjectCreated}
      />
      </div>

      {/* Version indicator */}
      {appVersion && (
        <div className="version-indicator">
          <span className="version-text">v{appVersion}</span>
          {updateStatus.status === 'available' && (
            <button
              className="update-btn"
              onClick={downloadUpdate}
              title={`Update to v${updateStatus.version}`}
            >
              Update available
            </button>
          )}
          {updateStatus.status === 'downloading' && (
            <span className="update-progress" role="status" aria-live="polite" aria-atomic="true">
              Downloading... {Math.round(updateStatus.progress || 0)}%
            </span>
          )}
          {updateStatus.status === 'downloaded' && (
            <button
              className="update-btn ready"
              onClick={installUpdate}
              title="Restart and install update"
            >
              Restart to update
            </button>
          )}
          {updateStatus.status === 'error' && (
            <span className="update-error" role="alert" aria-live="assertive" title={updateStatus.error}>
              Update failed
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default App
