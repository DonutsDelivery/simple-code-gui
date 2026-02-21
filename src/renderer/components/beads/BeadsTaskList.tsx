import React from 'react'
import type { BeadsTask } from './types.js'
import { getPriorityClass, formatStatusLabel } from './types.js'
import { TaskStatusButton } from './TaskStatusButton.js'

interface BeadsTaskListProps {
  tasks: BeadsTask[]
  panelHeight: number
  editingTaskId: string | null
  editingTitle: string
  editInputRef: React.RefObject<HTMLInputElement>
  onComplete: (taskId: string) => void
  onStart: (e: React.MouseEvent, taskId: string) => void
  onCycleStatus: (taskId: string, currentStatus: string) => void
  onDelete: (taskId: string) => void
  onOpenDetail: (task: BeadsTask) => void
  setEditingTitle: (title: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
}

export function BeadsTaskList({
  tasks,
  panelHeight,
  editingTaskId,
  editingTitle,
  editInputRef,
  onComplete,
  onStart,
  onCycleStatus,
  onDelete,
  onOpenDetail,
  setEditingTitle,
  onSaveEdit,
  onCancelEdit
}: BeadsTaskListProps): React.ReactElement {
  if (tasks.length === 0) {
    return (
      <div className="beads-tasks" style={{ maxHeight: `${panelHeight}px` }}>
        <div className="beads-empty">No ready tasks</div>
      </div>
    )
  }

  return (
    <div className="beads-tasks" style={{ maxHeight: `${panelHeight}px` }}>
      {tasks.map((task) => (
        <div key={task.id} className={`beads-task ${getPriorityClass(task.priority)} status-${task.status}`}>
          <TaskStatusButton
            status={task.status}
            taskId={task.id}
            onComplete={onComplete}
            onStart={onStart}
          />
          <div className="beads-task-content">
            {editingTaskId === task.id ? (
              <input
                ref={editInputRef}
                className="beads-task-edit-input"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onSaveEdit()
                  }
                  if (e.key === 'Escape') onCancelEdit()
                }}
                onBlur={onSaveEdit}
              />
            ) : (
              <div
                className={`beads-task-title clickable ${task.status === 'closed' ? 'completed' : ''}`}
                title="Click to view details"
                onClick={() => onOpenDetail(task)}
              >
                {task.title}
              </div>
            )}
            <div className="beads-task-meta">
              <span className="beads-task-id">{task.id}</span>
              <button
                className={`beads-task-status status-${task.status}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onCycleStatus(task.id, task.status)
                }}
                title="Click to cycle status"
              >
                {formatStatusLabel(task.status)}
              </button>
            </div>
          </div>
          <button
            className="beads-task-delete"
            onClick={() => onDelete(task.id)}
            title="Delete task"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
