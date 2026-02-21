import { useState, useEffect, useRef, useCallback } from 'react'
import { tasksCache, beadsStatusCache } from '../../utils/lruCache.js'
import type { BeadsTask } from './types.js'

// Discriminated union for beads panel state
export type BeadsState =
  | { status: 'loading' }
  | { status: 'not_installed'; installing: 'beads' | 'python' | null; needsPython: boolean; installError: string | null; installStatus: string | null }
  | { status: 'not_initialized'; initializing: boolean }
  | { status: 'ready' }
  | { status: 'error'; error: string }

export interface BeadsStateResult {
  beadsState: BeadsState
  setBeadsState: React.Dispatch<React.SetStateAction<BeadsState>>
  tasks: BeadsTask[]
  setTasks: React.Dispatch<React.SetStateAction<BeadsTask[]>>
  currentProjectRef: React.MutableRefObject<string | null>
  suppressWatcherReloadRef: React.MutableRefObject<boolean>
  setError: (error: string) => void
}

export function useBeadsState(projectPath: string | null): BeadsStateResult {
  const [beadsState, setBeadsState] = useState<BeadsState>({ status: 'loading' })
  const [tasks, setTasks] = useState<BeadsTask[]>([])
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

  // Initialize from cache on project change
  useEffect(() => {
    currentProjectRef.current = projectPath

    if (projectPath) {
      setTasks([])
      setBeadsState({ status: 'loading' })

      const cachedTasks = tasksCache.get(projectPath) as BeadsTask[] | undefined
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
    } else {
      setTasks([])
      setBeadsState({ status: 'loading' })
    }
  }, [projectPath])

  return {
    beadsState,
    setBeadsState,
    tasks,
    setTasks,
    currentProjectRef,
    suppressWatcherReloadRef,
    setError
  }
}
