import { useCallback, useEffect, useRef, useState } from 'react'
import { tasksCache, beadsStatusCache } from '../../utils/lruCache.js'
import type { UnifiedTask, TaskAdapter, BackendKind, AutomationEligibility, CreateTaskParams } from './adapters/types.js'
import { detectBackend, getAdapter } from './adapters/detect.js'
import type { BeadsState } from './useBeadsState.js'

export interface TaskCrudCallbacks {
  loadTasks: (showLoading?: boolean) => Promise<void>
  handleInitBeads: () => Promise<void>
  handleInitKspec: () => Promise<void>
  handleUpgradeToKspec: () => Promise<void>
  handleInstallPython: () => Promise<void>
  handleInstallBeads: () => Promise<void>
  handleCreateTask: () => Promise<void>
  handleCompleteTask: (taskId: string) => Promise<void>
  handleDeleteTask: (taskId: string) => Promise<void>
  handleCycleStatus: (taskId: string, currentStatus: string) => Promise<void>
  handleSaveEdit: () => Promise<void>
  handleCancelEdit: () => void
  handleClearCompleted: () => Promise<void>
  upgrading: boolean
}

export interface TaskCrudState {
  showCreateModal: boolean
  setShowCreateModal: React.Dispatch<React.SetStateAction<boolean>>
  newTaskTitle: string
  setNewTaskTitle: React.Dispatch<React.SetStateAction<string>>
  newTaskType: string
  setNewTaskType: React.Dispatch<React.SetStateAction<string>>
  newTaskPriority: number
  setNewTaskPriority: React.Dispatch<React.SetStateAction<number>>
  newTaskDescription: string
  setNewTaskDescription: React.Dispatch<React.SetStateAction<string>>
  newTaskLabels: string
  setNewTaskLabels: React.Dispatch<React.SetStateAction<string>>
  newTaskAutomation: AutomationEligibility | ''
  setNewTaskAutomation: React.Dispatch<React.SetStateAction<AutomationEligibility | ''>>
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
  tasks: UnifiedTask[]
  setTasks: React.Dispatch<React.SetStateAction<UnifiedTask[]>>
  currentProjectRef: React.MutableRefObject<string | null>
  suppressWatcherReloadRef: React.MutableRefObject<boolean>
  setError: (error: string) => void
  adapter: TaskAdapter | null
  backendKind: BackendKind
}

export function useBeadsTasks({
  projectPath,
  beadsState,
  setBeadsState,
  tasks,
  setTasks,
  currentProjectRef,
  suppressWatcherReloadRef,
  setError,
  adapter,
  backendKind
}: UseBeadsTasksParams): TaskCrudCallbacks & TaskCrudState {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState<string>('task')
  const [newTaskPriority, setNewTaskPriority] = useState<number>(2)
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [newTaskLabels, setNewTaskLabels] = useState('')
  const [newTaskAutomation, setNewTaskAutomation] = useState<AutomationEligibility | ''>('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const [upgrading, setUpgrading] = useState(false)

  const loadTasks = useCallback(async (showLoading = true) => {
    if (!projectPath) return

    const loadingForProject = projectPath

    if (showLoading) setBeadsState({ status: 'loading' })

    try {
      // Detect backend if we don't have an adapter yet
      const kind = backendKind !== 'none' ? backendKind : await detectBackend(loadingForProject)
      const currentAdapter = kind !== 'none' ? getAdapter(kind) : null

      if (currentProjectRef.current !== loadingForProject) return

      if (!currentAdapter) {
        // Check if beads is at least installable
        const beadsStatus = await window.electronAPI?.beadsCheck(loadingForProject)
        if (currentProjectRef.current !== loadingForProject) return

        if (!beadsStatus?.installed) {
          setBeadsState({ status: 'not_installed', installing: null, needsPython: false, installError: null, installStatus: null })
          return
        }

        // Neither backend initialized — offer choice
        setBeadsState({ status: 'not_initialized', initializing: false, availableBackends: ['beads', 'kspec'] })
        return
      }

      // Backend found — check status
      const status = await currentAdapter.check(loadingForProject)
      if (currentProjectRef.current !== loadingForProject) return

      beadsStatusCache.set(loadingForProject, status)

      if (!status.initialized) {
        setBeadsState({ status: 'not_initialized', initializing: false, availableBackends: [kind] })
        return
      }

      // Load tasks via adapter
      const taskList = await currentAdapter.list(loadingForProject)
      if (currentProjectRef.current !== loadingForProject) return

      setTasks(taskList)
      tasksCache.set(loadingForProject, taskList)
      setBeadsState({ status: 'ready' })
    } catch (e) {
      if (currentProjectRef.current === loadingForProject) {
        setBeadsState({ status: 'error', error: String(e) })
      }
    }
  }, [projectPath, setBeadsState, setTasks, currentProjectRef, backendKind])

  const handleInitBeads = async (): Promise<void> => {
    if (!projectPath) return
    if (beadsState.status !== 'not_initialized') return

    setBeadsState({ status: 'not_initialized', initializing: true, availableBackends: ['beads'] })

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

  const handleInitKspec = async (): Promise<void> => {
    if (!projectPath) return
    if (beadsState.status !== 'not_initialized') return

    setBeadsState({ status: 'not_initialized', initializing: true, availableBackends: ['kspec'] })

    try {
      const result = await window.electronAPI?.kspecInit?.(projectPath)
      if (result?.success) {
        // Ensure daemon is running
        await window.electronAPI?.kspecEnsureDaemon?.(projectPath)
        loadTasks()
      } else {
        setBeadsState({ status: 'error', error: result?.error || 'Failed to initialize kspec' })
      }
    } catch (e) {
      setBeadsState({ status: 'error', error: String(e) })
    }
  }

  const handleUpgradeToKspec = async (): Promise<void> => {
    if (!projectPath) return
    setUpgrading(true)

    try {
      // Check if kspec CLI is installed, install if not
      const cliCheck = await window.electronAPI?.kspecCheckCli?.()
      if (!cliCheck?.installed) {
        const installResult = await window.electronAPI?.kspecInstallCli?.()
        if (!installResult?.success) {
          setError(installResult?.error || 'Failed to install kspec CLI')
          setUpgrading(false)
          return
        }
      }

      // Run migration: reads beads tasks, inits kspec, creates tasks, removes .beads/
      const result = await window.electronAPI?.kspecMigrateFromBeads?.(projectPath)
      if (!result?.success) {
        setError(result?.error || 'Migration failed')
        setUpgrading(false)
        return
      }

      // Ensure daemon is running
      await window.electronAPI?.kspecEnsureDaemon?.(projectPath)

      // Clear caches and reload — backend has changed from beads to kspec
      tasksCache.delete(projectPath)
      beadsStatusCache.delete(projectPath)
      loadTasks()
    } catch (e) {
      setError(String(e))
    } finally {
      setUpgrading(false)
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
    if (!projectPath || !newTaskTitle.trim() || !adapter) return

    try {
      const result = await adapter.create(projectPath, {
        title: newTaskTitle.trim(),
        description: newTaskDescription.trim() || undefined,
        priority: newTaskPriority,
        type: newTaskType as CreateTaskParams['type'],
        tags: newTaskLabels.trim() || undefined,
        automation: newTaskAutomation || undefined
      })
      if (result.success) {
        setNewTaskTitle('')
        setNewTaskType('task')
        setNewTaskPriority(backendKind === 'kspec' ? 3 : 2)
        setNewTaskDescription('')
        setNewTaskLabels('')
        setNewTaskAutomation('')
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
    if (!projectPath || !adapter) return

    const previousTasks = [...tasks]
    const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, status: 'closed' as const } : t)
    setTasks(updatedTasks)
    tasksCache.set(projectPath, updatedTasks)

    try {
      const result = await adapter.complete(projectPath, taskId)
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
    if (!projectPath || !adapter) return

    const previousTasks = [...tasks]
    const updatedTasks = tasks.filter(t => t.id !== taskId)
    setTasks(updatedTasks)
    tasksCache.set(projectPath, updatedTasks)

    try {
      const result = await adapter.delete(projectPath, taskId)
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
    if (!projectPath || !adapter) return

    let nextStatus: string
    switch (currentStatus) {
      case 'open': nextStatus = 'in_progress'; break
      case 'in_progress': nextStatus = 'closed'; break
      default: nextStatus = 'open'
    }

    const previousTasks = [...tasks]
    const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, status: nextStatus as UnifiedTask['status'] } : t)
    setTasks(updatedTasks)
    tasksCache.set(projectPath, updatedTasks)

    try {
      const result = await adapter.update(projectPath, taskId, { status: nextStatus as UnifiedTask['status'] })
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
    if (!projectPath || !editingTaskId || !editingTitle.trim() || !adapter) {
      setEditingTaskId(null)
      return
    }

    const originalTask = tasks.find(t => t.id === editingTaskId)
    if (originalTask && originalTask.title === editingTitle.trim()) {
      setEditingTaskId(null)
      return
    }

    try {
      const result = await adapter.update(projectPath, editingTaskId, { title: editingTitle.trim() })
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

  const handleClearCompleted = async (): Promise<void> => {
    if (!projectPath || !adapter) return

    const closedTasks = tasks.filter(t => t.status === 'closed')
    if (closedTasks.length === 0) return

    const updatedTasks = tasks.filter(t => t.status !== 'closed')
    setTasks(updatedTasks)
    tasksCache.set(projectPath, updatedTasks)

    suppressWatcherReloadRef.current = true

    try {
      await Promise.allSettled(
        closedTasks.map(task => adapter.delete(projectPath, task.id))
      )
    } finally {
      suppressWatcherReloadRef.current = false
    }
  }

  // Set up watcher via adapter
  useEffect(() => {
    const isReady = beadsState.status === 'ready'
    if (!projectPath || !isReady || !adapter) return

    adapter.watch(projectPath)

    const cleanup = adapter.onTasksChanged((data: { cwd: string }) => {
      if (data.cwd === projectPath && !suppressWatcherReloadRef.current) {
        loadTasks(false)
      }
    })

    return () => {
      adapter.unwatch(projectPath)
      cleanup()
    }
  }, [projectPath, beadsState.status, loadTasks, suppressWatcherReloadRef, adapter])

  // Load tasks on mount and when project changes
  useEffect(() => {
    if (projectPath) {
      loadTasks(false)
    }
  }, [projectPath, loadTasks])

  return {
    loadTasks,
    handleInitBeads,
    handleInitKspec,
    handleUpgradeToKspec,
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
    newTaskAutomation,
    setNewTaskAutomation,
    editingTaskId,
    setEditingTaskId,
    editingTitle,
    setEditingTitle,
    editInputRef,
    upgrading
  }
}
