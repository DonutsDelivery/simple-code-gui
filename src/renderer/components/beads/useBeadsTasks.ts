import { useCallback, useEffect, useRef, useState } from 'react'
import { tasksCache, beadsStatusCache } from '../../utils/lruCache.js'
import type { BeadsTask } from './types.js'
import type { BeadsState } from './useBeadsState.js'

export interface TaskCrudCallbacks {
  loadTasks: (showLoading?: boolean) => Promise<void>
  handleInitBeads: () => Promise<void>
  handleInstallPython: () => Promise<void>
  handleInstallBeads: () => Promise<void>
  handleCreateTask: () => Promise<void>
  handleCompleteTask: (taskId: string) => Promise<void>
  handleDeleteTask: (taskId: string) => Promise<void>
  handleCycleStatus: (taskId: string, currentStatus: string) => Promise<void>
  handleSaveEdit: () => Promise<void>
  handleCancelEdit: () => void
  handleClearCompleted: () => Promise<void>
}

export interface TaskCrudState {
  showCreateModal: boolean
  setShowCreateModal: React.Dispatch<React.SetStateAction<boolean>>
  newTaskTitle: string
  setNewTaskTitle: React.Dispatch<React.SetStateAction<string>>
  newTaskType: 'task' | 'bug' | 'feature' | 'epic' | 'chore'
  setNewTaskType: React.Dispatch<React.SetStateAction<'task' | 'bug' | 'feature' | 'epic' | 'chore'>>
  newTaskPriority: number
  setNewTaskPriority: React.Dispatch<React.SetStateAction<number>>
  newTaskDescription: string
  setNewTaskDescription: React.Dispatch<React.SetStateAction<string>>
  newTaskLabels: string
  setNewTaskLabels: React.Dispatch<React.SetStateAction<string>>
  editingTaskId: string | null
  setEditingTaskId: React.Dispatch<React.SetStateAction<string | null>>
  editingTitle: string
  setEditingTitle: React.Dispatch<React.SetStateAction<string>>
  editInputRef: React.RefObject<HTMLInputElement>
}

interface UseBeadsTasksParams {
  projectPath: string | null
  beadsState: BeadsState
  setBeadsState: React.Dispatch<React.SetStateAction<BeadsState>>
  tasks: BeadsTask[]
  setTasks: React.Dispatch<React.SetStateAction<BeadsTask[]>>
  currentProjectRef: React.MutableRefObject<string | null>
  suppressWatcherReloadRef: React.MutableRefObject<boolean>
  setError: (error: string) => void
}

export function useBeadsTasks({
  projectPath,
  beadsState,
  setBeadsState,
  tasks,
  setTasks,
  currentProjectRef,
  suppressWatcherReloadRef,
  setError
}: UseBeadsTasksParams): TaskCrudCallbacks & TaskCrudState {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState<'task' | 'bug' | 'feature' | 'epic' | 'chore'>('task')
  const [newTaskPriority, setNewTaskPriority] = useState<number>(2)
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [newTaskLabels, setNewTaskLabels] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const loadTasks = useCallback(async (showLoading = true) => {
    if (!projectPath) return

    const loadingForProject = projectPath

    if (showLoading) setBeadsState({ status: 'loading' })

    try {
      const status = await window.electronAPI?.beadsCheck(loadingForProject)

      if (currentProjectRef.current !== loadingForProject) {
        return
      }

      if (!status) {
        setBeadsState({ status: 'error', error: 'Failed to check beads status' })
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

      if (result?.success && result.tasks) {
        setTasks(result.tasks as BeadsTask[])
        tasksCache.set(loadingForProject, result.tasks)
        setBeadsState({ status: 'ready' })
      } else {
        setBeadsState({ status: 'error', error: result?.error || 'Failed to load tasks' })
      }
    } catch (e) {
      if (currentProjectRef.current === loadingForProject) {
        setBeadsState({ status: 'error', error: String(e) })
      }
    }
  }, [projectPath, setBeadsState, setTasks, currentProjectRef])

  const handleInitBeads = async (): Promise<void> => {
    if (!projectPath) return
    if (beadsState.status !== 'not_initialized') return

    setBeadsState({ status: 'not_initialized', initializing: true })

    try {
      const result = await window.electronAPI?.beadsInit(projectPath)
      if (result?.success) {
        loadTasks()
      } else {
        setBeadsState({ status: 'error', error: result?.error || 'Failed to initialize beads' })
      }
    } catch (e) {
      setBeadsState({ status: 'error', error: String(e) })
    }
  }

  const handleInstallBeads = async (): Promise<void> => {
    setBeadsState({ status: 'not_installed', installing: 'beads', needsPython: false, installError: null, installStatus: null })

    try {
      const result = await window.electronAPI?.beadsInstall()
      if (result?.success) {
        loadTasks()
      } else if (result?.needsPython) {
        setBeadsState({ status: 'not_installed', installing: null, needsPython: true, installError: result.error || 'Python is required', installStatus: null })
      } else {
        setBeadsState({ status: 'not_installed', installing: null, needsPython: false, installError: result?.error || 'Installation failed', installStatus: null })
      }
    } catch (e) {
      setBeadsState({ status: 'not_installed', installing: null, needsPython: false, installError: String(e), installStatus: null })
    }
  }

  const handleInstallPython = async (): Promise<void> => {
    if (beadsState.status !== 'not_installed') return

    setBeadsState({ status: 'not_installed', installing: 'python', needsPython: true, installError: null, installStatus: 'Downloading Python...' })

    try {
      const result = await window.electronAPI?.pythonInstall()
      if (result?.success) {
        setBeadsState({ status: 'not_installed', installing: null, needsPython: false, installError: null, installStatus: null })
        handleInstallBeads()
      } else {
        setBeadsState({ status: 'not_installed', installing: null, needsPython: true, installError: result?.error || 'Python installation failed', installStatus: null })
      }
    } catch (e) {
      setBeadsState({ status: 'not_installed', installing: null, needsPython: true, installError: String(e), installStatus: null })
    }
  }

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
      if (result?.success) {
        setNewTaskTitle('')
        setNewTaskType('task')
        setNewTaskPriority(2)
        setNewTaskDescription('')
        setNewTaskLabels('')
        setShowCreateModal(false)
        loadTasks()
      } else {
        setError(result?.error || 'Failed to create task')
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
      if (!result?.success) {
        setTasks(previousTasks)
        tasksCache.set(projectPath, previousTasks)
        setError(result?.error || 'Failed to complete task')
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
      if (!result?.success) {
        setTasks(previousTasks)
        tasksCache.set(projectPath, previousTasks)
        setError(result?.error || 'Failed to delete task')
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
      if (!result?.success) {
        setTasks(previousTasks)
        tasksCache.set(projectPath, previousTasks)
        setError(result?.error || 'Failed to update task status')
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
      if (result?.success) {
        loadTasks()
      } else {
        setError(result?.error || 'Failed to update task title')
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

  // Set up file watcher
  useEffect(() => {
    const isReady = beadsState.status === 'ready'
    if (!projectPath || !isReady) return

    window.electronAPI?.beadsWatch(projectPath)

    const cleanup = window.electronAPI?.onBeadsTasksChanged((data: { cwd: string }) => {
      if (data.cwd === projectPath && !suppressWatcherReloadRef.current) {
        loadTasks(false)
      }
    })

    return () => {
      window.electronAPI?.beadsUnwatch(projectPath)
      cleanup?.()
    }
  }, [projectPath, beadsState.status, loadTasks, suppressWatcherReloadRef])

  // Load tasks on mount and when project changes (after cache init)
  useEffect(() => {
    if (projectPath) {
      loadTasks(false)
    }
  }, [projectPath, loadTasks])

  return {
    loadTasks,
    handleInitBeads,
    handleInstallPython,
    handleInstallBeads,
    handleCreateTask,
    handleCompleteTask,
    handleDeleteTask,
    handleCycleStatus,
    handleSaveEdit,
    handleCancelEdit,
    handleClearCompleted,
    showCreateModal,
    setShowCreateModal,
    newTaskTitle,
    setNewTaskTitle,
    newTaskType,
    setNewTaskType,
    newTaskPriority,
    setNewTaskPriority,
    newTaskDescription,
    setNewTaskDescription,
    newTaskLabels,
    setNewTaskLabels,
    editingTaskId,
    setEditingTaskId,
    editingTitle,
    setEditingTitle,
    editInputRef
  }
}
