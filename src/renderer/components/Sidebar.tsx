import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Project } from '../stores/workspace'
import { ProjectIcon } from './ProjectIcon'
import { BeadsPanel } from './BeadsPanel'

interface ClaudeSession {
  sessionId: string
  slug: string
  lastModified: number
}

interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
}

interface SidebarProps {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
  lastFocusedTabId: string | null
  onAddProject: () => void
  onRemoveProject: (path: string) => void
  onOpenSession: (projectPath: string, sessionId?: string, slug?: string) => void
  onSwitchToTab: (tabId: string) => void
  onOpenSettings: () => void
  onOpenMakeProject: () => void
  onUpdateProject: (path: string, updates: Partial<Project>) => void
  width: number
  collapsed: boolean
  onWidthChange: (width: number) => void
  onCollapsedChange: (collapsed: boolean) => void
}

export function Sidebar({ projects, openTabs, activeTabId, lastFocusedTabId, onAddProject, onRemoveProject, onOpenSession, onSwitchToTab, onOpenSettings, onOpenMakeProject, onUpdateProject, width, collapsed, onWidthChange, onCollapsedChange }: SidebarProps) {
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Record<string, ClaudeSession[]>>({})
  const [beadsExpanded, setBeadsExpanded] = useState(true)
  const [isResizing, setIsResizing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: Project } | null>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Resize handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newWidth = Math.min(Math.max(e.clientX, 200), 500)
      onWidthChange(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, onWidthChange])

  // Get project path from last focused tab (or active tab as fallback)
  const focusedTabId = lastFocusedTabId || activeTabId
  const focusedProjectPath = openTabs.find(t => t.id === focusedTabId)?.projectPath || null
  // Use expanded project if viewing sessions, otherwise use focused/active tab's project
  const beadsProjectPath = expandedProject || focusedProjectPath

  const handleSelectExecutable = async (project: Project) => {
    const executable = await window.electronAPI.selectExecutable()
    if (executable) {
      onUpdateProject(project.path, { executable })
    }
    setContextMenu(null)
  }

  const handleClearExecutable = (project: Project) => {
    onUpdateProject(project.path, { executable: undefined })
    setContextMenu(null)
  }

  const handleRunExecutable = async (project: Project) => {
    if (project.executable) {
      const result = await window.electronAPI.runExecutable(project.executable, project.path)
      if (!result.success) {
        console.error('Failed to run executable:', result.error)
      }
    }
    setContextMenu(null)
  }

  const handleContextMenu = (e: React.MouseEvent, project: Project) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, project })
  }

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    if (contextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu])

  useEffect(() => {
    const loadSessions = async () => {
      if (expandedProject) {
        try {
          const projectSessions = await window.electronAPI.discoverSessions(expandedProject)
          setSessions((prev) => ({ ...prev, [expandedProject]: projectSessions }))
        } catch (e) {
          console.error('Failed to discover sessions:', e)
        }
      }
    }
    loadSessions()
  }, [expandedProject])

  const toggleProject = (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    setExpandedProject(expandedProject === path ? null : path)
  }

  const openMostRecentSession = async (projectPath: string) => {
    // First check if any session from this project is already open
    const existingTab = openTabs.find(tab => tab.projectPath === projectPath)
    if (existingTab) {
      onSwitchToTab(existingTab.id)
      return
    }

    // Load sessions if not already loaded
    let projectSessions = sessions[projectPath]
    if (!projectSessions) {
      try {
        projectSessions = await window.electronAPI.discoverSessions(projectPath)
        setSessions((prev) => ({ ...prev, [projectPath]: projectSessions }))
      } catch (e) {
        console.error('Failed to discover sessions:', e)
        projectSessions = []
      }
    }

    if (projectSessions && projectSessions.length > 0) {
      // Open most recent session (first in list since sorted by lastModified)
      const mostRecent = projectSessions[0]
      onOpenSession(projectPath, mostRecent.sessionId, mostRecent.slug)
    } else {
      // No existing sessions, start a new one
      onOpenSession(projectPath)
    }
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (minutes < 1) {
      return 'Just now'
    } else if (minutes < 60) {
      return `${minutes}m ago`
    } else if (hours < 24) {
      return `${hours}h ago`
    } else if (days === 1) {
      return 'Yesterday'
    } else if (days < 7) {
      return `${days}d ago`
    } else {
      return date.toLocaleDateString()
    }
  }

  if (collapsed) {
    return (
      <div className="sidebar collapsed" ref={sidebarRef}>
        <button
          className="sidebar-collapse-btn"
          onClick={() => onCollapsedChange(false)}
          title="Expand sidebar"
        >
          ▶
        </button>
      </div>
    )
  }

  return (
    <div className="sidebar" ref={sidebarRef} style={{ width }}>
      <button
        className="sidebar-collapse-btn"
        onClick={() => onCollapsedChange(true)}
        title="Collapse sidebar"
      >
        ◀
      </button>
      <div className="sidebar-header">Projects</div>
      <div className="projects-list">
        {projects.map((project) => (
          <div key={project.path}>
            <div
              className={`project-item ${expandedProject === project.path ? 'expanded' : ''} ${openTabs.some(t => t.projectPath === project.path) ? 'has-open-tab' : ''} ${project.executable ? 'has-executable' : ''}`}
              onClick={() => openMostRecentSession(project.path)}
              onContextMenu={(e) => handleContextMenu(e, project)}
            >
              <span
                className="expand-arrow"
                onClick={(e) => toggleProject(e, project.path)}
                title="Show all sessions"
              >
                {expandedProject === project.path ? '▼' : '▶'}
              </span>
              <ProjectIcon projectName={project.name} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="project-name" title={project.name}>{project.name}</div>
                <div className="project-path" title={project.path}>{project.path}</div>
              </div>
              {project.executable && (
                <button
                  className="start-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRunExecutable(project)
                  }}
                  title={`Run: ${project.executable}`}
                >
                  ▶
                </button>
              )}
            </div>
            {expandedProject === project.path && (
              <div className="sessions-list">
                <div
                  className="session-item new-session"
                  onClick={() => onOpenSession(project.path)}
                >
                  <span>+</span>
                  <span>New Session</span>
                </div>
                {(sessions[project.path] || []).map((session, index) => (
                  <div
                    key={session.sessionId}
                    className={`session-item ${index === 0 ? 'most-recent' : ''}`}
                    onClick={() => onOpenSession(project.path, session.sessionId, session.slug)}
                    title={`Session ID: ${session.sessionId}`}
                  >
                    <span className="session-icon">{index === 0 ? '●' : '◦'}</span>
                    <span className="session-name" title={session.slug}>{session.slug}</span>
                    <span className="session-time">{formatDate(session.lastModified)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {projects.length === 0 && (
          <div className="empty-projects">
            No projects yet.<br />Click below to add one.
          </div>
        )}
      </div>
      <BeadsPanel
        projectPath={beadsProjectPath}
        isExpanded={beadsExpanded}
        onToggle={() => setBeadsExpanded(!beadsExpanded)}
      />
      <div className="sidebar-actions">
        {(() => {
          const focusedProject = projects.find(p => p.path === focusedProjectPath)
          if (focusedProject?.executable) {
            return (
              <button
                className="sidebar-btn run-app"
                onClick={() => handleRunExecutable(focusedProject)}
                title={`Run: ${focusedProject.executable}`}
              >
                <span className="icon">▶</span> Run App
              </button>
            )
          }
          return null
        })()}
        <button className="sidebar-btn" onClick={onOpenMakeProject}>
          <span className="icon">+</span> Make Project
        </button>
        <button className="sidebar-btn" onClick={onOpenSettings}>
          <span className="icon">⚙</span> Settings
        </button>
        <button className="sidebar-btn primary" onClick={onAddProject}>
          <span className="icon">📁</span> Add Project
        </button>
      </div>
      <div
        className="sidebar-resize-handle"
        onMouseDown={handleMouseDown}
      />

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.project.executable ? (
            <>
              <button onClick={() => handleRunExecutable(contextMenu.project)}>
                <span className="icon">▶</span> Run App
              </button>
              <button onClick={() => handleSelectExecutable(contextMenu.project)}>
                <span className="icon">⚡</span> Change Executable
              </button>
              <button onClick={() => handleClearExecutable(contextMenu.project)}>
                <span className="icon">✕</span> Clear Executable
              </button>
            </>
          ) : (
            <button onClick={() => handleSelectExecutable(contextMenu.project)}>
              <span className="icon">⚡</span> Set Executable
            </button>
          )}
          <div className="context-menu-divider" />
          <button
            className="danger"
            onClick={() => {
              onRemoveProject(contextMenu.project.path)
              setContextMenu(null)
            }}
          >
            <span className="icon">🗑</span> Remove Project
          </button>
        </div>
      )}
    </div>
  )
}
