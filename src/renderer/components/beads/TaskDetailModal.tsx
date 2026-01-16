import React from 'react'
import ReactDOM from 'react-dom'
import { BeadsTask, getPriorityClass, formatStatusLabel } from './types.js'

interface TaskDetailModalProps {
  show: boolean
  task: BeadsTask | null
  loading: boolean
  editing: boolean
  setEditing: (editing: boolean) => void
  editTitle: string
  setEditTitle: (title: string) => void
  editDescription: string
  setEditDescription: (description: string) => void
  editPriority: number
  setEditPriority: (priority: number) => void
  editStatus: string
  setEditStatus: (status: string) => void
  onClose: () => void
  onSave: () => void
}

export function TaskDetailModal({
  show, task, loading, editing, setEditing,
  editTitle, setEditTitle,
  editDescription, setEditDescription,
  editPriority, setEditPriority,
  editStatus, setEditStatus,
  onClose, onSave
}: TaskDetailModalProps) {
  if (!show) return null

  return ReactDOM.createPortal(
    <div className="beads-modal-overlay" onClick={onClose}>
      <div className="beads-modal beads-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="beads-modal-header">
          <h3>{task?.id || 'Task Details'}</h3>
          <button className="beads-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="beads-modal-body">
          {loading ? (
            <div className="beads-detail-loading">Loading...</div>
          ) : task ? (
            editing ? (
              <>
                <div className="beads-form-group">
                  <label htmlFor="detail-title">Title</label>
                  <input
                    id="detail-title"
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="beads-form-row">
                  <div className="beads-form-group">
                    <label htmlFor="detail-status">Status</label>
                    <select id="detail-status" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                  <div className="beads-form-group">
                    <label htmlFor="detail-priority">Priority</label>
                    <select id="detail-priority" value={editPriority} onChange={(e) => setEditPriority(parseInt(e.target.value))}>
                      <option value="0">P0 - Critical</option>
                      <option value="1">P1 - High</option>
                      <option value="2">P2 - Medium</option>
                      <option value="3">P3 - Low</option>
                      <option value="4">P4 - Lowest</option>
                    </select>
                  </div>
                </div>
                <div className="beads-form-group">
                  <label htmlFor="detail-description">Description</label>
                  <textarea
                    id="detail-description"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={5}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="beads-detail-title">{task.title}</div>
                <div className="beads-detail-meta">
                  <span className={`beads-detail-status status-${task.status}`}>
                    {formatStatusLabel(task.status)}
                  </span>
                  <span className={`beads-detail-priority ${getPriorityClass(task.priority)}`}>
                    P{task.priority ?? 2}
                  </span>
                  <span className="beads-detail-type">{task.issue_type || 'task'}</span>
                </div>
                {task.description && (
                  <div className="beads-detail-description">
                    <label>Description</label>
                    <p>{task.description}</p>
                  </div>
                )}
                <div className="beads-detail-timestamps">
                  {task.created_at && <span>Created: {new Date(task.created_at).toLocaleString()}</span>}
                  {task.updated_at && <span>Updated: {new Date(task.updated_at).toLocaleString()}</span>}
                </div>
                {(task.dependency_count !== undefined || task.dependent_count !== undefined) && (
                  <div className="beads-detail-deps">
                    {task.dependency_count !== undefined && task.dependency_count > 0 && (
                      <span>Blocked by: {task.dependency_count} task(s)</span>
                    )}
                    {task.dependent_count !== undefined && task.dependent_count > 0 && (
                      <span>Blocking: {task.dependent_count} task(s)</span>
                    )}
                  </div>
                )}
              </>
            )
          ) : (
            <div className="beads-detail-error">Task not found</div>
          )}
        </div>
        <div className="beads-modal-footer">
          {editing ? (
            <>
              <button className="beads-btn-cancel" onClick={() => setEditing(false)}>Cancel</button>
              <button className="beads-btn-create" onClick={onSave} disabled={!editTitle.trim()}>Save</button>
            </>
          ) : (
            <>
              <button className="beads-btn-cancel" onClick={onClose}>Close</button>
              <button className="beads-btn-create" onClick={() => setEditing(true)}>Edit</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
