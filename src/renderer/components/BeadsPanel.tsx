import React, { useState, useEffect, useCallback, useRef } from 'react'

interface BeadsTask {
  id: string
  title: string
  status: string
  priority?: number
  created?: string
  blockers?: string[]
}

interface BeadsPanelProps {
  projectPath: string | null
  isExpanded: boolean
  onToggle: () => void
}

// Storage key for panel height
const BEADS_HEIGHT_KEY = 'beads-panel-height'
const DEFAULT_HEIGHT = 200
const MIN_HEIGHT = 100
const MAX_HEIGHT = 500

// Cache tasks per project path to avoid reload flicker when switching
const tasksCache = new Map<string, BeadsTask[]>()
const beadsStatusCache = new Map<string, { installed: boolean; initialized: boolean }>()

export function BeadsPanel({ projectPath, isExpanded, onToggle }: BeadsPanelProps) {
  const [beadsInstalled, setBeadsInstalled] = useState(false)
  const [beadsInitialized, setBeadsInitialized] = useState(false)
  const [tasks, setTasks] = useState<BeadsTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState<'task' | 'bug' | 'feature' | 'epic' | 'chore'>('task')
  const [newTaskPriority, setNewTaskPriority] = useState<number>(2)
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [newTaskLabels, setNewTaskLabels] = useState('')
  const [initializing, setInitializing] = useState(false)
  const [installing, setInstalling] = useState<'beads' | 'python' | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [needsPython, setNeedsPython] = useState(false)
  const [installStatus, setInstallStatus] = useState<string | null>(null)
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = localStorage.getItem(BEADS_HEIGHT_KEY)
    return saved ? parseInt(saved, 10) : DEFAULT_HEIGHT
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const loadTasks = useCallback(async (showLoading = true) => {
    if (!projectPath) return

    if (showLoading) setLoading(true)
    setError(null)

    try {
      const status = await window.electronAPI.beadsCheck(projectPath)
      setBeadsInstalled(status.installed)
      setBeadsInitialized(status.initialized)
      beadsStatusCache.set(projectPath, status)

      if (status.installed && status.initialized) {
        const result = await window.electronAPI.beadsList(projectPath)
        if (result.success && result.tasks) {
          setTasks(result.tasks)
          tasksCache.set(projectPath, result.tasks)
        } else {
          setError(result.error || 'Failed to load tasks')
        }
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  const handleInitBeads = async () => {
    if (!projectPath) return

    setInitializing(true)
    setError(null)

    try {
      const result = await window.electronAPI.beadsInit(projectPath)
      if (result.success) {
        loadTasks()
      } else {
        setError(result.error || 'Failed to initialize beads')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setInitializing(false)
    }
  }

  const handleInstallPython = async () => {
    setInstalling('python')
    setInstallError(null)
    setInstallStatus('Downloading Python...')

    try {
      const result = await window.electronAPI.pythonInstall()
      if (result.success) {
        setNeedsPython(false)
        setInstallStatus(null)
        // Now try installing beads again
        handleInstallBeads()
      } else {
        setInstallError(result.error || 'Python installation failed')
        setInstallStatus(null)
      }
    } catch (e) {
      setInstallError(String(e))
      setInstallStatus(null)
    } finally {
      setInstalling(null)
    }
  }

  const handleInstallBeads = async () => {
    setInstalling('beads')
    setInstallError(null)
    setNeedsPython(false)

    try {
      const result = await window.electronAPI.beadsInstall()
      if (result.success) {
        setBeadsInstalled(true)
        loadTasks()
      } else if (result.needsPython) {
        setNeedsPython(true)
        setInstallError(result.error || 'Python is required')
      } else {
        setInstallError(result.error || 'Installation failed')
      }
    } catch (e) {
      setInstallError(String(e))
    } finally {
      setInstalling(null)
    }
  }

  // Listen for install progress
  useEffect(() => {
    const cleanup = window.electronAPI.onInstallProgress((data) => {
      if (data.type === 'python') {
        const percent = data.percent !== undefined ? ` (${data.percent}%)` : ''
        setInstallStatus(`${data.status}${percent}`)
      }
    })
    return cleanup
  }, [])

  // When project changes, load from cache immediately then refresh in background
  useEffect(() => {
    setError(null)
    if (projectPath) {
      // Load from cache instantly if available
      const cachedTasks = tasksCache.get(projectPath)
      const cachedStatus = beadsStatusCache.get(projectPath)
      if (cachedTasks && cachedStatus) {
        setTasks(cachedTasks)
        setBeadsInstalled(cachedStatus.installed)
        setBeadsInitialized(cachedStatus.initialized)
      } else {
        // No cache - clear and show loading
        setTasks([])
        setBeadsInitialized(false)
        setBeadsInstalled(false)
      }
    } else {
      setTasks([])
      setBeadsInitialized(false)
      setBeadsInstalled(false)
    }
  }, [projectPath])

  useEffect(() => {
    if (projectPath && isExpanded) {
      // Show loading only if no cached data
      const hasCachedData = tasksCache.has(projectPath)
      loadTasks(!hasCachedData)
      // Auto-refresh every 10 seconds (silent, no loading state)
      const interval = setInterval(() => loadTasks(false), 10000)
      return () => clearInterval(interval)
    }
  }, [projectPath, isExpanded, loadTasks])

  const handleCreateTask = async () => {
    if (!projectPath || !newTaskTitle.trim()) return

    try {
      const title = newTaskTitle.trim()
      const description = newTaskDescription.trim() || undefined
      const labels = newTaskLabels.trim() || undefined

      const result = await window.electronAPI.beadsCreate(
        projectPath,
        title,
        description,
        newTaskPriority,
        newTaskType,
        labels
      )
      if (result.success) {
        // Reset form
        setNewTaskTitle('')
        setNewTaskType('task')
        setNewTaskPriority(2)
        setNewTaskDescription('')
        setNewTaskLabels('')
        setShowCreateModal(false)
        loadTasks()
      } else {
        setError(result.error || 'Failed to create task')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const handleCompleteTask = async (taskId: string) => {
    if (!projectPath) return

    try {
      const result = await window.electronAPI.beadsComplete(projectPath, taskId)
      if (result.success) {
        loadTasks()
      } else {
        setError(result.error || 'Failed to complete task')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!projectPath) return

    try {
      const result = await window.electronAPI.beadsDelete(projectPath, taskId)
      if (result.success) {
        loadTasks()
      } else {
        setError(result.error || 'Failed to delete task')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const handleStartTask = async (taskId: string) => {
    if (!projectPath) return

    try {
      const result = await window.electronAPI.beadsStart(projectPath, taskId)
      if (result.success) {
        loadTasks()
      } else {
        setError(result.error || 'Failed to start task')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const handleCycleStatus = async (taskId: string, currentStatus: string) => {
    if (!projectPath) return

    // Cycle: open → in_progress → closed → open
    const nextStatus = currentStatus === 'open' ? 'in_progress'
      : currentStatus === 'in_progress' ? 'closed'
      : 'open'

    try {
      const result = await window.electronAPI.beadsUpdate(projectPath, taskId, nextStatus)
      if (result.success) {
        loadTasks()
      } else {
        setError(result.error || 'Failed to update task status')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const handleStartEdit = (task: BeadsTask) => {
    setEditingTaskId(task.id)
    setEditingTitle(task.title)
    setTimeout(() => editInputRef.current?.focus(), 0)
  }

  const handleSaveEdit = async () => {
    if (!projectPath || !editingTaskId || !editingTitle.trim()) {
      setEditingTaskId(null)
      return
    }

    const originalTask = tasks.find(t => t.id === editingTaskId)
    if (originalTask && originalTask.title === editingTitle.trim()) {
      setEditingTaskId(null)
      return
    }

    try {
      const result = await window.electronAPI.beadsUpdate(projectPath, editingTaskId, undefined, editingTitle.trim())
      if (result.success) {
        loadTasks()
      } else {
        setError(result.error || 'Failed to update task title')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setEditingTaskId(null)
    }
  }

  const handleCancelEdit = () => {
    setEditingTaskId(null)
    setEditingTitle('')
  }

  const handleClearCompleted = async () => {
    if (!projectPath) return

    const closedTasks = tasks.filter(t => t.status === 'closed')
    for (const task of closedTasks) {
      try {
        await window.electronAPI.beadsDelete(projectPath, task.id)
      } catch (e) {
        // Silently continue on error
      }
    }
    await loadTasks()
  }

  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { startY: e.clientY, startHeight: panelHeight }
    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return
      // Dragging up = larger panel (negative delta)
      const delta = resizeRef.current.startY - e.clientY
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeRef.current.startHeight + delta))
      setPanelHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      localStorage.setItem(BEADS_HEIGHT_KEY, String(panelHeight))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, panelHeight])

  const getPriorityClass = (priority?: number) => {
    if (priority === 0) return 'priority-critical'
    if (priority === 1) return 'priority-high'
    if (priority === 2) return 'priority-medium'
    return 'priority-low'
  }

  // Split on both / and \ for cross-platform support
  const projectName = projectPath ? projectPath.split(/[/\\]/).pop() : null

  return (
    <div className="beads-panel">
      <div className="beads-header" onClick={onToggle}>
        <span className="beads-toggle">{isExpanded ? '▼' : '▶'}</span>
        <span className="beads-icon">📿</span>
        <span className="beads-title">
          Beads{projectName ? `: ${projectName}` : ''}
        </span>
        {tasks.length > 0 && <span className="beads-count">{tasks.length}</span>}
      </div>

      {isExpanded && (
        <div className="beads-content">
          <div
            className={`beads-resize-handle ${isResizing ? 'active' : ''}`}
            onMouseDown={handleResizeStart}
            title="Drag to resize"
          />
          {!projectPath && (
            <div className="beads-empty">Select a project to view tasks</div>
          )}

          {projectPath && !beadsInstalled && !loading && (
            <div className="beads-empty">
              <p>Beads CLI (<code>bd</code>) not found.</p>
              {installError && <p className="beads-install-error">{installError}</p>}
              {installStatus && <p className="beads-install-status">{installStatus}</p>}
              <div className="beads-install-buttons">
                {needsPython && (
                  <button
                    className="beads-init-btn"
                    onClick={handleInstallPython}
                    disabled={installing !== null}
                  >
                    {installing === 'python' ? 'Installing Python...' : '1. Install Python'}
                  </button>
                )}
                <button
                  className="beads-init-btn"
                  onClick={handleInstallBeads}
                  disabled={installing !== null || needsPython}
                >
                  {installing === 'beads' ? 'Installing...' : needsPython ? '2. Install Beads' : 'Install Beads CLI'}
                </button>
              </div>
            </div>
          )}

          {projectPath && beadsInstalled && !beadsInitialized && !loading && (
            <div className="beads-empty">
              <p>No Beads initialized.</p>
              <button
                className="beads-init-btn"
                onClick={handleInitBeads}
                disabled={initializing}
              >
                {initializing ? 'Initializing...' : 'Initialize Beads'}
              </button>
            </div>
          )}

          {projectPath && loading && (
            <div className="beads-loading">Loading tasks...</div>
          )}

          {projectPath && beadsInitialized && !loading && error && (
            <div className="beads-error">{error}</div>
          )}

          {projectPath && beadsInitialized && !loading && !error && (
            <>
              <div className="beads-tasks" style={{ maxHeight: `${panelHeight}px` }}>
                {tasks.length === 0 ? (
                  <div className="beads-empty">No ready tasks</div>
                ) : (
                  tasks.map((task) => (
                    <div key={task.id} className={`beads-task ${getPriorityClass(task.priority)} status-${task.status}`}>
                      {task.status === 'closed' ? (
                        <span className="beads-task-done">✓</span>
                      ) : task.status === 'in_progress' ? (
                        <button
                          className="beads-task-check"
                          onClick={() => handleCompleteTask(task.id)}
                          title="Mark complete"
                        >
                          ○
                        </button>
                      ) : (
                        <button
                          className="beads-task-start"
                          onClick={() => handleStartTask(task.id)}
                          title="Start task"
                        >
                          ▶
                        </button>
                      )}
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
                                handleSaveEdit()
                              }
                              if (e.key === 'Escape') handleCancelEdit()
                            }}
                            onBlur={handleSaveEdit}
                          />
                        ) : (
                          <div
                            className={`beads-task-title ${task.status === 'closed' ? 'completed' : ''}`}
                            title="Double-click to edit"
                            onDoubleClick={() => handleStartEdit(task)}
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
                              handleCycleStatus(task.id, task.status)
                            }}
                            title="Click to cycle status"
                          >
                            {task.status === 'in_progress' ? 'In Progress' : task.status === 'closed' ? 'Done' : 'Open'}
                          </button>
                        </div>
                      </div>
                      <button
                        className="beads-task-delete"
                        onClick={() => handleDeleteTask(task.id)}
                        title="Delete task"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="beads-actions-row">
                <button
                  className="beads-add-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  + Add Task
                </button>
                {tasks.some(t => t.status === 'closed') && (
                  <button
                    className="beads-clear-btn"
                    onClick={handleClearCompleted}
                    title="Clear completed tasks"
                  >
                    ✓
                  </button>
                )}
                <button className="beads-refresh-btn" onClick={() => loadTasks()} title="Refresh">
                  ↻
                </button>
              </div>

              {showCreateModal && (
                <div className="beads-modal-overlay" onClick={() => setShowCreateModal(false)}>
                  <div className="beads-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="beads-modal-header">
                      <h3>Create Task</h3>
                      <button className="beads-modal-close" onClick={() => setShowCreateModal(false)}>×</button>
                    </div>
                    <div className="beads-modal-body">
                      <div className="beads-form-group">
                        <label htmlFor="task-title">Title *</label>
                        <input
                          id="task-title"
                          type="text"
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                          placeholder="Task title..."
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newTaskTitle.trim()) {
                              e.preventDefault()
                              handleCreateTask()
                            }
                            if (e.key === 'Escape') setShowCreateModal(false)
                          }}
                        />
                      </div>
                      <div className="beads-form-row">
                        <div className="beads-form-group">
                          <label htmlFor="task-type">Type</label>
                          <select
                            id="task-type"
                            value={newTaskType}
                            onChange={(e) => setNewTaskType(e.target.value as typeof newTaskType)}
                          >
                            <option value="task">Task</option>
                            <option value="bug">Bug</option>
                            <option value="feature">Feature</option>
                            <option value="epic">Epic</option>
                            <option value="chore">Chore</option>
                          </select>
                        </div>
                        <div className="beads-form-group">
                          <label htmlFor="task-priority">Priority</label>
                          <select
                            id="task-priority"
                            value={newTaskPriority}
                            onChange={(e) => setNewTaskPriority(parseInt(e.target.value))}
                          >
                            <option value="0">P0 - Critical</option>
                            <option value="1">P1 - High</option>
                            <option value="2">P2 - Medium</option>
                            <option value="3">P3 - Low</option>
                            <option value="4">P4 - Lowest</option>
                          </select>
                        </div>
                      </div>
                      <div className="beads-form-group">
                        <label htmlFor="task-description">Description</label>
                        <textarea
                          id="task-description"
                          value={newTaskDescription}
                          onChange={(e) => setNewTaskDescription(e.target.value)}
                          placeholder="Optional description..."
                          rows={3}
                        />
                      </div>
                      <div className="beads-form-group">
                        <label htmlFor="task-labels">Labels</label>
                        <input
                          id="task-labels"
                          type="text"
                          value={newTaskLabels}
                          onChange={(e) => setNewTaskLabels(e.target.value)}
                          placeholder="Comma-separated labels..."
                        />
                      </div>
                    </div>
                    <div className="beads-modal-footer">
                      <button className="beads-btn-cancel" onClick={() => setShowCreateModal(false)}>Cancel</button>
                      <button
                        className="beads-btn-create"
                        onClick={handleCreateTask}
                        disabled={!newTaskTitle.trim()}
                      >
                        Create
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
