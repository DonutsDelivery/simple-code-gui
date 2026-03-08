import { useState, useEffect, useRef, useCallback } from 'react'
import { tasksCache, beadsStatusCache } from '../../utils/lruCache.js'
import type { UnifiedTask } from './adapters/types.js'
import type { BackendKind, TaskAdapter } from './adapters/types.js'
import { detectBackend, getAdapter, beadsAdapter, kspecAdapter } from './adapters/detect.js'

// Discriminated union for panel state
export type BeadsState =
  | { status: 'loading' }
  | { status: 'not_installed'; installing: 'beads' | 'python' | null; needsPython: boolean; installError: string | null; installStatus: string | null }
  | { status: 'not_initialized'; initializing: boolean; availableBackends: BackendKind[] }
  | { status: 'ready' }
  | { status: 'error'; error: string }

export interface BeadsStateResult {
  beadsState: BeadsState
  setBeadsState: React.Dispatch<React.SetStateAction<BeadsState>>
  tasks: UnifiedTask[]
  setTasks: React.Dispatch<React.SetStateAction<UnifiedTask[]>>
  currentProjectRef: React.MutableRefObject<string | null>
  suppressWatcherReloadRef: React.MutableRefObject<boolean>
  setError: (error: string) => void
  backendKind: BackendKind
  adapter: TaskAdapter | null
}

export function useBeadsState(projectPath: string | null): BeadsStateResult {
  const [beadsState, setBeadsState] = useState<BeadsState>({ status: 'loading' })
  const [tasks, setTasks] = useState<UnifiedTask[]>([])
  const [backendKind, setBackendKind] = useState<BackendKind>('none')
  const currentProjectRef = useRef<string | null>(null)
  const suppressWatcherReloadRef = useRef(false)

  const setError = useCallback((error: string) => {
    setBeadsState({ status: 'error', error })
  }, [])

  // Handle install progress events
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

  // Detect backend on project change
  useEffect(() => {
    currentProjectRef.current = projectPath

    if (projectPath) {
      setTasks([])
      setBeadsState({ status: 'loading' })

      // Check cache first
      const cachedTasks = tasksCache.get(projectPath) as UnifiedTask[] | undefined
      const cachedStatus = beadsStatusCache.get(projectPath)
      if (cachedTasks && cachedStatus) {
        setTasks(cachedTasks)
        if (cachedStatus.installed && cachedStatus.initialized) {
          setBeadsState({ status: 'ready' })
        } else if (cachedStatus.installed) {
          setBeadsState({ status: 'not_initialized', initializing: false, availableBackends: ['beads', 'kspec'] })
        } else {
          setBeadsState({ status: 'not_installed', installing: null, needsPython: false, installError: null, installStatus: null })
        }
      }

      // Detect backend
      detectBackend(projectPath).then(kind => {
        if (currentProjectRef.current !== projectPath) return
        setBackendKind(kind)
      })
    } else {
      setTasks([])
      setBackendKind('none')
      setBeadsState({ status: 'loading' })
    }
  }, [projectPath])

  const adapter = getAdapter(backendKind)

  return {
    beadsState,
    setBeadsState,
    tasks,
    setTasks,
    currentProjectRef,
    suppressWatcherReloadRef,
    setError,
    backendKind,
    adapter
  }
}
