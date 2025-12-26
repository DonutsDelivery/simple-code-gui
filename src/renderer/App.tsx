import React, { useEffect, useState, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { TerminalTabs } from './components/TerminalTabs'
import { Terminal } from './components/Terminal'
import { useWorkspaceStore, OpenTab } from './stores/workspace'

declare global {
  interface Window {
    electronAPI: {
      getWorkspace: () => Promise<any>
      saveWorkspace: (workspace: any) => Promise<void>
      addProject: () => Promise<string | null>
      discoverSessions: (projectPath: string) => Promise<any[]>
      spawnPty: (cwd: string, sessionId?: string) => Promise<string>
      writePty: (id: string, data: string) => void
      resizePty: (id: string, cols: number, rows: number) => void
      killPty: (id: string) => void
      onPtyData: (id: string, callback: (data: string) => void) => () => void
      onPtyExit: (id: string, callback: (code: number) => void) => () => void
    }
  }
}

function App() {
  const {
    projects,
    openTabs,
    activeTabId,
    setProjects,
    addProject,
    removeProject,
    addTab,
    removeTab,
    setActiveTab
  } = useWorkspaceStore()

  const [loading, setLoading] = useState(true)

  // Load workspace on mount and restore tabs
  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        const workspace = await window.electronAPI.getWorkspace()
        if (workspace.projects) {
          setProjects(workspace.projects)
        }

        // Restore previously open tabs by spawning fresh PTY processes
        if (workspace.openTabs && workspace.openTabs.length > 0) {
          for (const savedTab of workspace.openTabs) {
            try {
              const ptyId = await window.electronAPI.spawnPty(
                savedTab.projectPath,
                savedTab.sessionId
              )
              addTab({
                id: ptyId,
                projectPath: savedTab.projectPath,
                sessionId: savedTab.sessionId,
                title: savedTab.title,
                ptyId
              })
            } catch (e) {
              console.error('Failed to restore tab:', savedTab.title, e)
            }
          }
        }
      } catch (e) {
        console.error('Failed to load workspace:', e)
      }
      setLoading(false)
    }
    loadWorkspace()
  }, [])

  // Save workspace when it changes
  useEffect(() => {
    if (!loading) {
      window.electronAPI.saveWorkspace({
        projects,
        openTabs: openTabs.map(t => ({
          id: t.id,
          projectPath: t.projectPath,
          sessionId: t.sessionId,
          title: t.title
        })),
        activeTabId
      })
    }
  }, [projects, openTabs, activeTabId, loading])

  const handleAddProject = useCallback(async () => {
    const path = await window.electronAPI.addProject()
    if (path) {
      const name = path.split('/').pop() || path
      addProject({ path, name })
    }
  }, [addProject])

  const handleOpenSession = useCallback(async (projectPath: string, sessionId?: string, slug?: string) => {
    // Check if this session is already open
    if (sessionId) {
      const existingTab = openTabs.find(tab => tab.sessionId === sessionId)
      if (existingTab) {
        setActiveTab(existingTab.id)
        return
      }
    }

    const projectName = projectPath.split('/').pop() || projectPath
    const title = slug ? `${projectName} - ${slug}` : `${projectName} - New`

    try {
      const ptyId = await window.electronAPI.spawnPty(projectPath, sessionId)
      addTab({
        id: ptyId,
        projectPath,
        sessionId,
        title,
        ptyId
      })
    } catch (e) {
      console.error('Failed to spawn PTY:', e)
    }
  }, [addTab, openTabs, setActiveTab])

  const handleCloseTab = useCallback((tabId: string) => {
    window.electronAPI.killPty(tabId)
    removeTab(tabId)
  }, [removeTab])

  if (loading) {
    return (
      <div className="app">
        <div className="empty-state">
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        openTabs={openTabs}
        onAddProject={handleAddProject}
        onRemoveProject={removeProject}
        onOpenSession={handleOpenSession}
        onSwitchToTab={setActiveTab}
      />
      <div className="main-content">
        {openTabs.length > 0 ? (
          <>
            <TerminalTabs
              tabs={openTabs}
              activeTabId={activeTabId}
              onSelectTab={setActiveTab}
              onCloseTab={handleCloseTab}
            />
            <div className="terminal-container">
              {openTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`terminal-wrapper ${tab.id === activeTabId ? 'active' : ''}`}
                >
                  <Terminal ptyId={tab.id} isActive={tab.id === activeTabId} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h2>Claude Terminal</h2>
            <p>Add a project from the sidebar, then click a session to open it</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
