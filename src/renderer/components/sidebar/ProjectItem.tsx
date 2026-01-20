import React from 'react'
import { Project } from '../../stores/workspace.js'
import { ProjectIcon } from '../ProjectIcon.js'
import { ClaudeSession, DropTarget } from './types.js'
import { formatDate } from './utils.js'

interface ProjectItemProps {
  project: Project
  isExpanded: boolean
  isFocused: boolean
  hasOpenTab: boolean
  isDragging: boolean
  isEditing: boolean
  editingName: string
  sessions: ClaudeSession[]
  taskCounts?: { open: number; inProgress: number }
  dropTarget: DropTarget | null
  editInputRef: React.RefObject<HTMLInputElement | null>
  onToggleExpand: (e: React.MouseEvent) => void
  onOpenSession: (sessionId?: string, slug?: string, isNewSession?: boolean) => void
  onRunExecutable: () => void
  onCloseProjectTabs: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onStartRename: (e: React.MouseEvent) => void
  onEditingChange: (name: string) => void
  onRenameSubmit: () => void
  onRenameKeyDown: (e: React.KeyboardEvent) => void
}

export const ProjectItem = React.memo(function ProjectItem({
  project,
  isExpanded,
  isFocused,
  hasOpenTab,
  isDragging,
  isEditing,
  editingName,
  sessions,
  taskCounts,
  dropTarget,
  editInputRef,
  onToggleExpand,
  onOpenSession,
  onRunExecutable,
  onCloseProjectTabs,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onStartRename,
  onEditingChange,
  onRenameSubmit,
  onRenameKeyDown,
}: ProjectItemProps) {
  const showDropBefore = dropTarget?.type === 'project' && dropTarget.id === project.path && dropTarget.position === 'before'
  const showDropAfter = dropTarget?.type === 'project' && dropTarget.id === project.path && dropTarget.position === 'after'

  return (
    <div>
      {showDropBefore && <div className="drop-indicator" />}

      <div
        className={`project-item ${isExpanded ? 'expanded' : ''} ${hasOpenTab ? 'has-open-tab' : ''} ${project.executable ? 'has-executable' : ''} ${project.color ? 'has-color' : ''} ${isFocused ? 'focused' : ''} ${isDragging ? 'dragging' : ''}`}
        style={project.color ? { backgroundColor: `${project.color}20` } : undefined}
        draggable={!isEditing}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => onOpenSession()}
        onContextMenu={onContextMenu}
      >
        <button
          className="expand-arrow"
          onClick={onToggleExpand}
          title="Show all sessions"
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} sessions for ${project.name}`}
        >
          {isExpanded ? '▼' : '▶'}
        </button>
        <ProjectIcon projectName={project.name} size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            <input
              ref={editInputRef}
              type="text"
              className="project-name-input"
              value={editingName}
              onChange={(e) => onEditingChange(e.target.value)}
              onKeyDown={onRenameKeyDown}
              onBlur={onRenameSubmit}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div
              className="project-name"
              title={project.name}
              onDoubleClick={onStartRename}
            >
              {project.name}
            </div>
          )}
          {taskCounts ? (
            <div className="project-tasks" title={project.path}>
              {taskCounts.open + taskCounts.inProgress > 0 ? (
                <>
                  <span className="task-count">{taskCounts.open + taskCounts.inProgress} tasks</span>
                  {taskCounts.inProgress > 0 && (
                    <span className="task-in-progress">({taskCounts.inProgress} active)</span>
                  )}
                </>
              ) : (
                <span className="task-count task-done">No open tasks</span>
              )}
            </div>
          ) : (
            <div className="project-path" title={project.path}>{project.path}</div>
          )}
        </div>
        {project.executable && (
          <button
            className="start-btn"
            onClick={(e) => {
              e.stopPropagation()
              onRunExecutable()
            }}
            title={`Run: ${project.executable}`}
          >
            ▶
          </button>
        )}
        {hasOpenTab && (
          <button
            className="close-project-btn"
            onClick={(e) => {
              e.stopPropagation()
              onCloseProjectTabs()
            }}
            title="Close all terminals for this project"
          >
            ×
          </button>
        )}
      </div>

      {showDropAfter && <div className="drop-indicator" />}

      {isExpanded && (
        <div className="sessions-list">
          <div
            className="session-item new-session"
            onClick={(e) => {
              e.stopPropagation()
              onOpenSession(undefined, undefined, true)
            }}
          >
            <span>+</span>
            <span>New Session</span>
          </div>
          {sessions.map((session, index) => (
            <div
              key={session.sessionId}
              className={`session-item ${index === 0 ? 'most-recent' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onOpenSession(session.sessionId, session.slug)
              }}
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
  )
})
