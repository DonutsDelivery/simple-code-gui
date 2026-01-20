/**
 * MobileSidebarContent Component
 *
 * Full-screen sidebar content for mobile swipe layout.
 * Shows projects and allows opening sessions.
 */

import React from 'react'
import { Project } from '../../stores/workspace'

interface MobileSidebarContentProps {
  projects: Project[]
  onOpenSession: (projectPath: string) => void
}

export function MobileSidebarContent({
  projects,
  onOpenSession
}: MobileSidebarContentProps): React.ReactElement {
  return (
    <div className="mobile-sidebar-content">
      {/* Header */}
      <div className="mobile-sidebar-header">
        <h1 className="mobile-sidebar-title">Claude Terminal</h1>
        <p className="mobile-sidebar-subtitle">
          {projects.length} project{projects.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Project list */}
      <div className="mobile-project-list">
        {projects.length === 0 ? (
          <div className="mobile-empty-projects">
            <p>No projects yet</p>
            <p className="mobile-empty-hint">
              Add projects from your desktop app
            </p>
          </div>
        ) : (
          projects.map((project) => (
            <div
              key={project.path}
              className="mobile-project-item"
              onClick={() => onOpenSession(project.path)}
            >
              <div className="mobile-project-icon">◇</div>
              <div className="mobile-project-info">
                <span className="mobile-project-name">{project.name}</span>
                <span className="mobile-project-path">{project.path}</span>
              </div>
              <span className="mobile-project-arrow">→</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default MobileSidebarContent
