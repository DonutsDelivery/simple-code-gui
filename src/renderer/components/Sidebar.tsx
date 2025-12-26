import React, { useState, useEffect } from 'react'
import { Project } from '../stores/workspace'
import { ProjectIcon } from './ProjectIcon'

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
  onAddProject: () => void
  onRemoveProject: (path: string) => void
  onOpenSession: (projectPath: string, sessionId?: string, slug?: string) => void
  onSwitchToTab: (tabId: string) => void
}

export function Sidebar({ projects, openTabs, onAddProject, onRemoveProject, onOpenSession, onSwitchToTab }: SidebarProps) {
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Record<string, ClaudeSession[]>>({})

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

  return (
    <div className="sidebar">
      <div className="sidebar-header">Projects</div>
      <div className="projects-list">
        {projects.map((project) => (
          <div key={project.path}>
            <div
              className={`project-item ${expandedProject === project.path ? 'expanded' : ''}`}
              onClick={() => openMostRecentSession(project.path)}
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
                <div className="project-name">{project.name}</div>
                <div className="project-path">{project.path}</div>
              </div>
              <button
                className="remove-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemoveProject(project.path)
                }}
                title="Remove project"
              >
                ×
              </button>
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
                    <span className="session-name">{session.slug}</span>
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
      <button className="add-project-btn" onClick={onAddProject}>
        + Add Project
      </button>
    </div>
  )
}
