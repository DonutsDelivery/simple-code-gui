import React from 'react'
import { Project } from '../../stores/workspace.js'
import { ProjectIcon } from '../ProjectIcon.js'
import { ClaudeSession, DropTarget } from './types.js'
import { formatDate } from './utils.js'
import type { OpenSessionOptions } from '../../hooks/useProjectHandlers.js'
import { useConnectionsStore } from '../../stores/connections.js'

interface ProjectItemProps {
  localServerId: string
  project: Project
  isExpanded: boolean
  isFocused: boolean
  hasOpenTab: boolean
  isDragging: boolean
  isEditing: boolean
  editingName: string
  sessions: ClaudeSession[]
  dropTarget: DropTarget | null
  editInputRef: React.RefObject<HTMLInputElement | null>
  onToggleExpand: (e: React.MouseEvent) => void
  onOpenSession: (options?: OpenSessionOptions) => void
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
  localServerId,
  project,
  isExpanded,
  isFocused,
  hasOpenTab,
  isDragging,
  isEditing,
  editingName,
  sessions,
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
  harnessId,
  onHarnessChange,
}: ProjectItemProps & { harnessId?: string; onHarnessChange?: (harnessId: string) => void }) {
  const connections = useConnectionsStore(state => state.connections)
  const isRemote = project.serverId !== localServerId
  const originName = connections.find(connection => connection.serverId === project.serverId)?.displayName || project.serverId.slice(0, 8)
  const serverHue = [...project.serverId].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 360, 0)
  const [newServerId, setNewServerId] = React.useState(project.serverId)
  const showDropBefore = dropTarget?.type === 'project' && dropTarget.id === project.path && dropTarget.position === 'before'
  const showDropAfter = dropTarget?.type === 'project' && dropTarget.id === project.path && dropTarget.position === 'after'

  return (
    <div>
      {showDropBefore && <div className="drop-indicator" />}

      <div
        className={`project-item ${isRemote ? 'project-item--remote' : 'project-item--local'} ${isExpanded ? 'expanded' : ''} ${hasOpenTab ? 'has-open-tab' : ''} ${project.executable ? 'has-executable' : ''} ${project.color ? 'has-color' : ''} ${isFocused ? 'focused' : ''} ${isDragging ? 'dragging' : ''}`}
        style={{ ...(project.color ? { backgroundColor: `${project.color}20` } : {}), '--server-color': `hsl(${serverHue} 72% 62%)` } as React.CSSProperties}
        draggable={!isEditing}
        onDragStart={(e) => {
          // Carry the sidebar's selected harness with the drag so dropped
          // sessions spawn with it instead of falling back to claude.
          e.dataTransfer.setData('application/x-sidebar-harness', harnessId || 'claude')
          onDragStart(e)
        }}
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
        <ProjectIcon projectName={project.name} customIcon={project.icon} size={24} />
        <div className="project-main">
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
        </div>
        {isRemote && <span className="backend-origin-badge" title={`Runs on ${originName}`}><span aria-hidden="true">⌁</span>{originName}</span>}

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
          <div className="session-origin" aria-label={`Project origin server ${project.serverId}`}>
            <span className="backend-origin-dot" aria-hidden="true" /> Origin: {originName}{isRemote ? ' · remote' : ' · local'}
          </div>
          <label className="session-launch-option">
            Server
            <select value={newServerId} onClick={event => event.stopPropagation()} onChange={event => setNewServerId(event.target.value)}>
              {(connections.length ? connections : [{ serverId: project.serverId, displayName: project.serverId }]).map(connection => (
                <option key={connection.serverId} value={connection.serverId}>{connection.displayName}</option>
              ))}
            </select>
          </label>
          <label className="session-launch-option">
            Harness
            <select
              value={harnessId || 'claude'}
              onClick={event => event.stopPropagation()}
              onChange={event => onHarnessChange?.(event.target.value)}
            >
              {['claude', 'hermes', 'codex', 'gemini', 'opencode', 'aider', 'droid', 'grok'].map(harness => (
                <option key={harness} value={harness}>{harness}</option>
              ))}
            </select>
          </label>
          <div
            className="session-item new-session"
            onClick={(e) => {
              e.stopPropagation()
              onOpenSession({ forceNewSession: true, serverId: newServerId, harnessId: (harnessId || 'claude') as OpenSessionOptions['harnessId'] })
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
                onOpenSession({
                  sessionId: session.sessionId,
                  slug: session.slug,
                  resumeCwd: session.cwd,
                })
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
