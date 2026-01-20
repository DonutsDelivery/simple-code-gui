import React, { useState, useEffect, useCallback, useRef } from 'react'
import { tasksCache, beadsStatusCache } from '../utils/lruCache.js'
import {
  BeadsTask,
  BEADS_HEIGHT_KEY,
  DEFAULT_HEIGHT,
  MIN_HEIGHT,
  MAX_HEIGHT,
  getPriorityClass,
  formatStatusLabel
} from './beads/types.js'
import { CreateTaskModal } from './beads/CreateTaskModal.js'
import { TaskDetailModal } from './beads/TaskDetailModal.js'
import { BrowserModal } from './beads/BrowserModal.js'
import { StartDropdown } from './beads/StartDropdown.js'

interface BeadsPanelProps {
  projectPath: string | null
  isExpanded: boolean
  onToggle: () => void
  onStartTaskInNewTab?: (prompt: string) => void
  onSendToCurrentTab?: (prompt: string) => void
  currentTabPtyId?: string | null
}

// Discriminated union for beads panel state
type BeadsState =
  | { status: 'loading' }
  | { status: 'not_installed'; installing: 'beads' | 'python' | null; needsPython: boolean; installError: string | null; installStatus: string | null }
  | { status: 'not_initialized'; initializing: boolean }
  | { status: 'ready' }
  | { status: 'error'; error: string }

function renderTaskStatusButton(
  status: string,
  taskId: string,
  onComplete: (id: string) => void,
  onStart: (e: React.MouseEvent, id: string) => void
): React.ReactNode {
  switch (status) {
    case 'closed':
      return <span className="beads-task-done">&#10003;</span>
    case 'in_progress':
      return (
        <button
          className="beads-task-check"
          onClick={() => onComplete(taskId)}
          title="Mark complete"
        >
          &#9675;
        </button>
      )
    default:
      return (
        <button
          className="beads-task-start"
          onClick={(e) => onStart(e, taskId)}
          title="Start task"
        >
          &#9654;
        </button>
      )
  }
}

export function BeadsPanel({ projectPath, isExpanded, onToggle, onStartTaskInNewTab, onSendToCurrentTab, currentTabPtyId }: BeadsPanelProps): React.ReactElement {
  const [beadsState, setBeadsState] = useState<BeadsState>({ status: 'loading' })
  const [tasks, setTasks] = useState<BeadsTask[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState<'task' | 'bug' | 'feature' | 'epic' | 'chore'>('task')
  const [newTaskPriority, setNewTaskPriority] = useState<number>(2)
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [newTaskLabels, setNewTaskLabels] = useState('')
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = localStorage.getItem(BEADS_HEIGHT_KEY)
    return saved ? parseInt(saved, 10) : DEFAULT_HEIGHT
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const currentProjectRef = useRef<string | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const [showDetailModal, setShowDetailModal] = useState(false)
  const [detailTask, setDetailTask] = useState<BeadsTask | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editingDetail, setEditingDetail] = useState(false)
  const [editDetailTitle, setEditDetailTitle] = useState('')
  const [editDetailDescription, setEditDetailDescription] = useState('')
  const [editDetailPriority, setEditDetailPriority] = useState<number>(2)
  const [editDetailStatus, setEditDetailStatus] = useState<string>('open')

  const [showBrowser, setShowBrowser] = useState(false)
  const [browserFilter, setBrowserFilter] = useState<'all' | 'open' | 'in_progress' | 'closed'>('all')
  const [browserSort, setBrowserSort] = useState<'priority' | 'created' | 'status'>('priority')

  const [startDropdownTaskId, setStartDropdownTaskId] = useState<string | null>(null)
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null)
  const suppressWatcherReloadRef = useRef(false)

  const handleStartButtonClick = (e: React.MouseEvent, taskId: string): void => {
    if (startDropdownTaskId === taskId) {
      setStartDropdownTaskId(null)
      setDropdownPosition(null)
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setDropdownPosition({ top: rect.bottom + 4, left: rect.left })
      setStartDropdownTaskId(taskId)
    }
  }

  const loadTasks = useCallback(async (showLoading = true) => {
    if (!projectPath) return

    const loadingForProject = projectPath

    if (showLoading) setBeadsState({ status: 'loading' })

    try {
      const status = await window.electronAPI?.beadsCheck(loadingForProject)

      if (currentProjectRef.current !== loadingForProject) {
        return
      }

      beadsStatusCache.set(loadingForProject, status)

      if (!status.installed) {
        setBeadsState({ status: 'not_installed', installing: null, needsPython: false, installError: null, installStatus: null })
        return
      }

      if (!status.initialized) {
        setBeadsState({ status: 'not_initialized', initializing: false })
        return
      }

      const result = await window.electronAPI?.beadsList(loadingForProject)

      if (currentProjectRef.current !== loadingForProject) {
        return
      }

      if (result.success && result.tasks) {
        setTasks(result.tasks)
        tasksCache.set(loadingForProject, result.tasks)
        setBeadsState({ status: 'ready' })
      } else {
        setBeadsState({ status: 'error', error: result.error || 'Failed to load tasks' })
      }
    } catch (e) {
      if (currentProjectRef.current === loadingForProject) {
        setBeadsState({ status: 'error', error: String(e) })
      }
    }
  }, [projectPath])

  const handleInitBeads = async (): Promise<void> => {
    if (!projectPath) return
    if (beadsState.status !== 'not_initialized') return

    setBeadsState({ status: 'not_initialized', initializing: true })

    try {
      const result = await window.electronAPI?.beadsInit(projectPath)
      if (result.success) {
        loadTasks()
      } else {
        setBeadsState({ status: 'error', error: result.error || 'Failed to initialize beads' })
      }
    } catch (e) {
      setBeadsState({ status: 'error', error: String(e) })
    }
  }

  const handleInstallPython = async (): Promise<void> => {
    if (beadsState.status !== 'not_installed') return

    setBeadsState({ status: 'not_installed', installing: 'python', needsPython: true, installError: null, installStatus: 'Downloading Python...' })

    try {
      const result = await window.electronAPI?.pythonInstall()
      if (result.success) {
        setBeadsState({ status: 'not_installed', installing: null, needsPython: false, installError: null, installStatus: null })
        handleInstallBeads()
      } else {
        setBeadsState({ status: 'not_installed', installing: null, needsPython: true, installError: result.error || 'Python installation failed', installStatus: null })
      }
    } catch (e) {
      setBeadsState({ status: 'not_installed', installing: null, needsPython: true, installError: String(e), installStatus: null })
    }
  }

  const handleInstallBeads = async (): Promise<void> => {
    setBeadsState({ status: 'not_installed', installing: 'beads', needsPython: false, installError: null, installStatus: null })

    try {
      const result = await window.electronAPI?.beadsInstall()
      if (result.success) {
        loadTasks()
      } else if (result.needsPython) {
        setBeadsState({ status: 'not_installed', installing: null, needsPython: true, installError: result.error || 'Python is required', installStatus: null })
      } else {
        setBeadsState({ status: 'not_installed', installing: null, needsPython: false, installError: result.error || 'Installation failed', installStatus: null })
      }
    } catch (e) {
      setBeadsState({ status: 'not_installed', installing: null, needsPython: false, installError: String(e), installStatus: null })
    }
  }

  useEffect(() => {
    const cleanup = window.electronAPI?.onInstallProgress((data) => {
      if (data.type === 'python') {
        const percent = data.percent !== undefined ? ` (${data.percent}%)` : ''
        setBeadsState((prev) => {
          if (prev.status !== 'not_installed') return prev
          return { ...prev, installStatus: `${data.status}${percent}` }
        })
      }
    })
    return cleanup
  }, [])

  useEffect(() => {
    currentProjectRef.current = projectPath

    if (projectPath) {
      setTasks([])
      setBeadsState({ status: 'loading' })

      const cachedTasks = tasksCache.get(projectPath)
      const cachedStatus = beadsStatusCache.get(projectPath)
      if (cachedTasks && cachedStatus) {
        setTasks(cachedTasks)
        if (cachedStatus.installed && cachedStatus.initialized) {
          setBeadsState({ status: 'ready' })
        } else if (cachedStatus.installed) {
          setBeadsState({ status: 'not_initialized', initializing: false })
        } else {
          setBeadsState({ status: 'not_installed', installing: null, needsPython: false, installError: null, installStatus: null })
        }
      }

      loadTasks(false)
    } else {
      setTasks([])
      setBeadsState({ status: 'loading' })
    }
  }, [projectPath]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const isReady = beadsState.status === 'ready'
    if (!projectPath || !isReady) return

    window.electronAPI?.beadsWatch(projectPath)

    const cleanup = window.electronAPI?.onBeadsTasksChanged((data) => {
      if (data.cwd === projectPath && !suppressWatcherReloadRef.current) {
        loadTasks(false)
      }
    })

    return () => {
      window.electronAPI?.beadsUnwatch(projectPath)
      cleanup()
    }
  }, [projectPath, beadsState.status, loadTasks])

  const setError = useCallback((error: string) => {
    setBeadsState({ status: 'error', error })
  }, [])

  const handleCreateTask = async (): Promise<void> => {
    if (!projectPath || !newTaskTitle.trim()) return

    try {
      const title = newTaskTitle.trim()
      const description = newTaskDescription.trim() || undefined
      const labels = newTaskLabels.trim() || undefined

      const result = await window.electronAPI?.beadsCreate(
        projectPath,
        title,
        description,
        newTaskPriority,
        newTaskType,
        labels
      )
      if (result.success) {
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

  const handleCompleteTask = async (taskId: string): Promise<void> => {
    if (!projectPath) return

    const previousTasks = [...tasks]
    const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, status: 'closed' } : t)
    setTasks(updatedTasks)
    tasksCache.set(projectPath, updatedTasks)

    try {
      const result = await window.electronAPI?.beadsComplete(projectPath, taskId)
      if (!result.success) {
        setTasks(previousTasks)
        tasksCache.set(projectPath, previousTasks)
        setError(result.error || 'Failed to complete task')
      }
    } catch (e) {
      setTasks(previousTasks)
      tasksCache.set(projectPath, previousTasks)
      setError(String(e))
    }
  }

  const handleDeleteTask = async (taskId: string): Promise<void> => {
    if (!projectPath) return

    const previousTasks = [...tasks]
    const updatedTasks = tasks.filter(t => t.id !== taskId)
    setTasks(updatedTasks)
    tasksCache.set(projectPath, updatedTasks)

    try {
      const result = await window.electronAPI?.beadsDelete(projectPath, taskId)
      if (!result.success) {
        setTasks(previousTasks)
        tasksCache.set(projectPath, previousTasks)
        setError(result.error || 'Failed to delete task')
      }
    } catch (e) {
      setTasks(previousTasks)
      tasksCache.set(projectPath, previousTasks)
      setError(String(e))
    }
  }

  const handleCycleStatus = async (taskId: string, currentStatus: string): Promise<void> => {
    if (!projectPath) return

    let nextStatus: string
    switch (currentStatus) {
      case 'open': nextStatus = 'in_progress'; break
      case 'in_progress': nextStatus = 'closed'; break
      default: nextStatus = 'open'
    }

    const previousTasks = [...tasks]
    const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, status: nextStatus } : t)
    setTasks(updatedTasks)
    tasksCache.set(projectPath, updatedTasks)

    try {
      const result = await window.electronAPI?.beadsUpdate(projectPath, taskId, nextStatus)
      if (!result.success) {
        setTasks(previousTasks)
        tasksCache.set(projectPath, previousTasks)
        setError(result.error || 'Failed to update task status')
      }
    } catch (e) {
      setTasks(previousTasks)
      tasksCache.set(projectPath, previousTasks)
      setError(String(e))
    }
  }

  const handleSaveEdit = async (): Promise<void> => {
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
      const result = await window.electronAPI?.beadsUpdate(projectPath, editingTaskId, undefined, editingTitle.trim())
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

  const handleCancelEdit = (): void => {
    setEditingTaskId(null)
    setEditingTitle('')
  }

  const handleOpenDetail = async (task: BeadsTask): Promise<void> => {
    if (!projectPath) return

    setShowDetailModal(true)
    setDetailLoading(true)
    setEditingDetail(true)

    try {
      const result = await window.electronAPI?.beadsShow(projectPath, task.id)
      if (result.success && result.task) {
        const fullTask = Array.isArray(result.task) ? result.task[0] : result.task
        setDetailTask(fullTask)
        setEditDetailTitle(fullTask.title || '')
        setEditDetailDescription(fullTask.description || '')
        setEditDetailPriority(fullTask.priority ?? 2)
        setEditDetailStatus(fullTask.status || 'open')
      } else {
        setError(result.error || 'Failed to load task details')
        setShowDetailModal(false)
      }
    } catch (e) {
      setError(String(e))
      setShowDetailModal(false)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleCloseDetail = (): void => {
    setShowDetailModal(false)
    setDetailTask(null)
    setEditingDetail(false)
  }

  const handleSaveDetail = async (): Promise<void> => {
    if (!projectPath || !detailTask) return

    try {
      const result = await window.electronAPI?.beadsUpdate(
        projectPath,
        detailTask.id,
        editDetailStatus,
        editDetailTitle.trim(),
        editDetailDescription.trim(),
        editDetailPriority
      )
      if (result.success) {
        setDetailTask({
          ...detailTask,
          title: editDetailTitle.trim(),
          description: editDetailDescription.trim(),
          status: editDetailStatus,
          priority: editDetailPriority
        })
        setEditingDetail(false)
        loadTasks()
      } else {
        setError(result.error || 'Failed to update task')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const handleClearCompleted = async (): Promise<void> => {
    if (!projectPath) return

    const closedTasks = tasks.filter(t => t.status === 'closed')
    if (closedTasks.length === 0) return

    const updatedTasks = tasks.filter(t => t.status !== 'closed')
    setTasks(updatedTasks)
    tasksCache.set(projectPath, updatedTasks)

    suppressWatcherReloadRef.current = true

    try {
      await Promise.allSettled(
        closedTasks.map(task => window.electronAPI?.beadsDelete(projectPath, task.id))
      )
    } finally {
      suppressWatcherReloadRef.current = false
    }
  }

  const handleResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault()
    resizeRef.current = { startY: e.clientY, startHeight: panelHeight }
    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return

    let rafId: number | null = null
    const handleMouseMove = (e: MouseEvent): void => {
      if (!resizeRef.current) return
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (!resizeRef.current) return
        const delta = resizeRef.current.startY - e.clientY
        const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeRef.current.startHeight + delta))
        setPanelHeight(newHeight)
      })
    }

    const handleMouseUp = (): void => {
      setIsResizing(false)
      localStorage.setItem(BEADS_HEIGHT_KEY, String(panelHeight))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, panelHeight])

  const handleOpenBrowser = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const isReady = beadsState.status === 'ready'
    if (projectPath && isReady) {
      setShowBrowser(true)
    }
  }

  const projectName = projectPath ? projectPath.split(/[/\\]/).pop() : null

  const isLoading = beadsState.status === 'loading'
  const isReady = beadsState.status === 'ready'
  const isNotInstalled = beadsState.status === 'not_installed'
  const isNotInitialized = beadsState.status === 'not_initialized'
  const errorMessage = beadsState.status === 'error' ? beadsState.error : null

  return (
    <div className="beads-panel">
      <div className="beads-header">
        <button
          className="beads-toggle"
          onClick={onToggle}
          title={isExpanded ? 'Collapse list' : 'Expand list'}
          aria-expanded={isExpanded}
          aria-label="Toggle beads panel"
        >
          {isExpanded ? '&#9660;' : '&#9654;'}
        </button>
        <span className="beads-icon">&#128255;</span>
        <span
          className={`beads-title ${projectPath && isReady ? 'clickable' : ''}`}
          role={projectPath && isReady ? 'button' : undefined}
          tabIndex={projectPath && isReady ? 0 : undefined}
          onClick={handleOpenBrowser}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && projectPath && isReady) {
              e.preventDefault()
              handleOpenBrowser(e as unknown as React.MouseEvent)
            }
          }}
          title={projectPath && isReady ? 'Open task browser' : ''}
        >
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

          {projectPath && isNotInstalled && (
            <div className="beads-empty">
              <p>Beads CLI (<code>bd</code>) not found.</p>
              {beadsState.installError && <p className="beads-install-error" role="alert" aria-live="assertive">{beadsState.installError}</p>}
              {beadsState.installStatus && <p className="beads-install-status" role="status" aria-live="polite">{beadsState.installStatus}</p>}
              <div className="beads-install-buttons">
                {beadsState.needsPython && (
                  <button
                    className="beads-init-btn"
                    onClick={handleInstallPython}
                    disabled={beadsState.installing !== null}
                  >
                    {beadsState.installing === 'python' ? 'Installing Python...' : '1. Install Python'}
                  </button>
                )}
                <button
                  className="beads-init-btn"
                  onClick={handleInstallBeads}
                  disabled={beadsState.installing !== null || beadsState.needsPython}
                >
                  {beadsState.installing === 'beads' ? 'Installing...' : beadsState.needsPython ? '2. Install Beads' : 'Install Beads CLI'}
                </button>
              </div>
            </div>
          )}

          {projectPath && isNotInitialized && (
            <div className="beads-empty">
              <p>No Beads initialized.</p>
              <button
                className="beads-init-btn"
                onClick={handleInitBeads}
                disabled={beadsState.initializing}
              >
                {beadsState.initializing ? 'Initializing...' : 'Initialize Beads'}
              </button>
            </div>
          )}

          {projectPath && isLoading && (
            <div className="beads-loading" role="status" aria-live="polite">Loading tasks...</div>
          )}

          {projectPath && errorMessage && (
            <div className="beads-error" role="alert" aria-live="assertive">{errorMessage}</div>
          )}

          {projectPath && isReady && (
            <>
              <div className="beads-tasks" style={{ maxHeight: `${panelHeight}px` }}>
                {tasks.length === 0 ? (
                  <div className="beads-empty">No ready tasks</div>
                ) : (
                  tasks.map((task) => (
                    <div key={task.id} className={`beads-task ${getPriorityClass(task.priority)} status-${task.status}`}>
                      {renderTaskStatusButton(task.status, task.id, handleCompleteTask, handleStartButtonClick)}
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
                            className={`beads-task-title clickable ${task.status === 'closed' ? 'completed' : ''}`}
                            title="Click to view details"
                            onClick={() => handleOpenDetail(task)}
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
                            {formatStatusLabel(task.status)}
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
                    &#10003;
                  </button>
                )}
                <button className="beads-refresh-btn" onClick={() => loadTasks()} title="Refresh">
                  &#8635;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <CreateTaskModal
        show={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateTask}
        title={newTaskTitle}
        setTitle={setNewTaskTitle}
        type={newTaskType}
        setType={setNewTaskType}
        priority={newTaskPriority}
        setPriority={setNewTaskPriority}
        description={newTaskDescription}
        setDescription={setNewTaskDescription}
        labels={newTaskLabels}
        setLabels={setNewTaskLabels}
      />

      <TaskDetailModal
        show={showDetailModal}
        task={detailTask}
        loading={detailLoading}
        editing={editingDetail}
        setEditing={setEditingDetail}
        editTitle={editDetailTitle}
        setEditTitle={setEditDetailTitle}
        editDescription={editDetailDescription}
        setEditDescription={setEditDetailDescription}
        editPriority={editDetailPriority}
        setEditPriority={setEditDetailPriority}
        editStatus={editDetailStatus}
        setEditStatus={setEditDetailStatus}
        onClose={handleCloseDetail}
        onSave={handleSaveDetail}
      />

      <BrowserModal
        show={showBrowser}
        onClose={() => setShowBrowser(false)}
        projectName={projectName ?? null}
        tasks={tasks}
        filter={browserFilter}
        setFilter={setBrowserFilter}
        sort={browserSort}
        setSort={setBrowserSort}
        onRefresh={() => loadTasks()}
        onCreateNew={() => {
          setShowBrowser(false)
          setShowCreateModal(true)
        }}
        onComplete={handleCompleteTask}
        onStart={handleStartButtonClick}
        onCycleStatus={handleCycleStatus}
        onDelete={handleDeleteTask}
        onOpenDetail={handleOpenDetail}
        onClearCompleted={handleClearCompleted}
      />

      <StartDropdown
        taskId={startDropdownTaskId}
        position={dropdownPosition}
        tasks={tasks}
        currentTabPtyId={currentTabPtyId}
        onStartInNewTab={onStartTaskInNewTab}
        onSendToCurrentTab={onSendToCurrentTab}
        onClose={() => setStartDropdownTaskId(null)}
        onCloseBrowser={() => setShowBrowser(false)}
      />
    </div>
  )
}
