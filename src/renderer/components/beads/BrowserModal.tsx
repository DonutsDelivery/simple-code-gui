import React from 'react'
import ReactDOM from 'react-dom'
import type { UnifiedTask } from './adapters/types.js'
import { getPriorityClass, getPriorityLabel, formatStatusLabel, getStatusOrder } from './types.js'

interface BrowserModalProps {
  show: boolean
  onClose: () => void
  projectName: string | null
  backendLabel: string
  tasks: UnifiedTask[]
  filter: 'all' | 'open' | 'in_progress' | 'closed'
  setFilter: (filter: 'all' | 'open' | 'in_progress' | 'closed') => void
  sort: 'priority' | 'created' | 'status'
  setSort: (sort: 'priority' | 'created' | 'status') => void
  onRefresh: () => void
  onCreateNew: () => void
  onComplete: (taskId: string) => void
  onStart: (e: React.MouseEvent, taskId: string) => void
  onCycleStatus: (taskId: string, status: string) => void
  onDelete: (taskId: string) => void
  onOpenDetail: (task: UnifiedTask) => void
  onClearCompleted: () => void
}

export function BrowserModal({
  show, onClose, projectName, backendLabel, tasks,
  filter, setFilter, sort, setSort,
  onRefresh, onCreateNew, onComplete, onStart,
  onCycleStatus, onDelete, onOpenDetail, onClearCompleted
}: BrowserModalProps) {
  if (!show) return null

  const getFilteredTasks = () => {
    let filtered = [...tasks]

    if (filter !== 'all') {
      filtered = filtered.filter(t => t.status === filter)
    }

    filtered.sort((a, b) => {
      if (sort === 'priority') {
        return (a.priority ?? 2) - (b.priority ?? 2)
      }
      if (sort === 'status') {
        return getStatusOrder(a.status) - getStatusOrder(b.status)
      }
      if (sort === 'created') {
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0
        return bDate - aDate
      }
      return 0
    })

    return filtered
  }

  const filteredTasks = getFilteredTasks()

  return ReactDOM.createPortal(
    <div className="beads-modal-overlay" onClick={onClose}>
      <div className="beads-browser-modal" onClick={(e) => e.stopPropagation()}>
        <div className="beads-browser-header">
          <div className="beads-browser-title-row">
            <span className="beads-icon">&#128255;</span>
            <h2>{backendLabel} Tasks</h2>
            <span className="beads-browser-project">{projectName}</span>
          </div>
          <button className="beads-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="beads-browser-toolbar">
          <div className="beads-browser-filters">
            <label>Filter:</label>
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">All ({tasks.length})</option>
              <option value="open">Open ({tasks.filter(t => t.status === 'open').length})</option>
              <option value="in_progress">In Progress ({tasks.filter(t => t.status === 'in_progress').length})</option>
              <option value="closed">Closed ({tasks.filter(t => t.status === 'closed').length})</option>
            </select>
          </div>
          <div className="beads-browser-sort">
            <label>Sort:</label>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="priority">Priority</option>
              <option value="status">Status</option>
              <option value="created">Created</option>
            </select>
          </div>
          <div className="beads-browser-actions">
            <button className="beads-refresh-btn" onClick={onRefresh} title="Refresh">&#8635;</button>
            <button className="beads-btn-create" onClick={onCreateNew}>+ New Task</button>
          </div>
        </div>

        <div className="beads-browser-content">
          {filteredTasks.length === 0 ? (
            <div className="beads-browser-empty">
              {filter === 'all' ? 'No tasks yet' : `No ${filter.replace('_', ' ')} tasks`}
            </div>
          ) : (
            <div className="beads-browser-list">
              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  className={`beads-browser-item ${getPriorityClass(task.priority)} status-${task.status}`}
                >
                  <div className="beads-browser-item-header">
                    <div className="beads-browser-item-status">
                      {task.status === 'closed' ? (
                        <span className="beads-task-done">&#10003;</span>
                      ) : task.status === 'in_progress' ? (
                        <button
                          className="beads-task-check"
                          onClick={() => onComplete(task.id)}
                          title="Mark complete"
                        >
                          &#9675;
                        </button>
                      ) : (
                        <button
                          className="beads-task-start"
                          onClick={(e) => onStart(e, task.id)}
                          title="Start task"
                        >
                          &#9654;
                        </button>
                      )}
                    </div>
                    <div className="beads-browser-item-title-row">
                      <span
                        className={`beads-browser-item-title ${task.status === 'closed' ? 'completed' : ''}`}
                        onClick={() => onOpenDetail(task)}
                      >
                        {task.title}
                      </span>
                      <span className="beads-browser-item-id" title={task.id}>{task.displayId ?? task.id}</span>
                    </div>
                    <div className="beads-browser-item-actions">
                      <button
                        className={`beads-browser-status-btn status-${task.status}`}
                        onClick={() => onCycleStatus(task.id, task.status)}
                        title="Click to cycle status"
                      >
                        {formatStatusLabel(task.status)}
                      </button>
                      <button
                        className="beads-task-delete"
                        onClick={() => onDelete(task.id)}
                        title="Delete task"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  <div className="beads-browser-item-meta">
                    <span className={`beads-browser-priority ${getPriorityClass(task.priority)}`}>
                      P{task.priority ?? 2} {getPriorityLabel(task.priority)}
                    </span>
                    {task.type && (
                      <span className="beads-browser-type">{task.type}</span>
                    )}
                    {task.created_at && (
                      <span className="beads-browser-date">
                        {new Date(task.created_at).toLocaleDateString()}
                      </span>
                    )}
                    {task.tags && task.tags.length > 0 && (
                      <span className="beads-browser-tags">
                        {task.tags.join(', ')}
                      </span>
                    )}
                  </div>

                  {task.description && (
                    <div className="beads-browser-item-desc">{task.description}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="beads-browser-footer">
          <span className="beads-browser-stats">
            {tasks.filter(t => t.status === 'open').length} open,
            {' '}{tasks.filter(t => t.status === 'in_progress').length} in progress,
            {' '}{tasks.filter(t => t.status === 'closed').length} closed
          </span>
          {tasks.some(t => t.status === 'closed') && (
            <button
              className="beads-clear-btn"
              onClick={onClearCompleted}
              title="Clear completed tasks"
            >
              Clear Completed
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
