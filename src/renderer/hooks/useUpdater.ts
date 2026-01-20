import { useState, useEffect, useCallback } from 'react'

export type UpdateStatusType = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateStatus {
  status: UpdateStatusType
  version?: string
  progress?: number
  error?: string
}

interface UseUpdaterReturn {
  appVersion: string
  updateStatus: UpdateStatus
  downloadUpdate: () => void
  installUpdate: () => void
}

export function useUpdater(): UseUpdaterReturn {
  const [appVersion, setAppVersion] = useState<string>('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' })

  // Load app version on mount
  useEffect(() => {
    window.electronAPI?.getVersion?.()?.then(setAppVersion)?.catch(console.error)
  }, [])

  // Subscribe to updater events
  useEffect(() => {
    if (!window.electronAPI?.onUpdaterStatus) return
    const unsubscribe = window.electronAPI?.onUpdaterStatus((data) => {
      setUpdateStatus({
        status: data.status as UpdateStatusType,
        version: data.version,
        progress: data.progress,
        error: data.error
      })
    })
    return () => unsubscribe?.()
  }, [])

  const downloadUpdate = useCallback(() => {
    if (!window.electronAPI?.downloadUpdate) return
    setUpdateStatus(prev => ({
      status: 'downloading',
      version: prev.version,
      progress: 0
    }))
    window.electronAPI?.downloadUpdate().then(result => {
      if (!result.success) {
        setUpdateStatus({ status: 'error', error: result.error })
      }
    }).catch(e => {
      setUpdateStatus({ status: 'error', error: String(e) })
    })
  }, [])

  const installUpdate = useCallback(() => {
    window.electronAPI?.installUpdate?.()
  }, [])

  return {
    appVersion,
    updateStatus,
    downloadUpdate,
    installUpdate
  }
}
