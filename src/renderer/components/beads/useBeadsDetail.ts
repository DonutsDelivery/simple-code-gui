import { useState } from 'react'
import type { BeadsTask } from './types.js'

export interface DetailModalState {
  showDetailModal: boolean
  setShowDetailModal: React.Dispatch<React.SetStateAction<boolean>>
  detailTask: BeadsTask | null
  setDetailTask: React.Dispatch<React.SetStateAction<BeadsTask | null>>
  detailLoading: boolean
  setDetailLoading: React.Dispatch<React.SetStateAction<boolean>>
  editingDetail: boolean
  setEditingDetail: React.Dispatch<React.SetStateAction<boolean>>
  editDetailTitle: string
  setEditDetailTitle: React.Dispatch<React.SetStateAction<string>>
  editDetailDescription: string
  setEditDetailDescription: React.Dispatch<React.SetStateAction<string>>
  editDetailPriority: number
  setEditDetailPriority: React.Dispatch<React.SetStateAction<number>>
  editDetailStatus: string
  setEditDetailStatus: React.Dispatch<React.SetStateAction<string>>
}

export interface DetailModalCallbacks {
  handleOpenDetail: (task: BeadsTask) => Promise<void>
  handleCloseDetail: () => void
  handleSaveDetail: () => Promise<void>
}

interface UseBeadsDetailParams {
  projectPath: string | null
  loadTasks: () => Promise<void>
  setError: (error: string) => void
}

export function useBeadsDetail({
  projectPath,
  loadTasks,
  setError
}: UseBeadsDetailParams): DetailModalState & DetailModalCallbacks {
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [detailTask, setDetailTask] = useState<BeadsTask | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editingDetail, setEditingDetail] = useState(false)
  const [editDetailTitle, setEditDetailTitle] = useState('')
  const [editDetailDescription, setEditDetailDescription] = useState('')
  const [editDetailPriority, setEditDetailPriority] = useState<number>(2)
  const [editDetailStatus, setEditDetailStatus] = useState<string>('open')

  const handleOpenDetail = async (task: BeadsTask): Promise<void> => {
    if (!projectPath) return

    setShowDetailModal(true)
    setDetailLoading(true)
    setEditingDetail(true)

    try {
      const result = await window.electronAPI?.beadsShow(projectPath, task.id)
      if (result?.success && result.task) {
        const fullTask = (Array.isArray(result.task) ? result.task[0] : result.task) as BeadsTask
        setDetailTask(fullTask)
        setEditDetailTitle(fullTask.title || '')
        setEditDetailDescription(fullTask.description || '')
        setEditDetailPriority(fullTask.priority ?? 2)
        setEditDetailStatus(fullTask.status || 'open')
      } else {
        setError(result?.error || 'Failed to load task details')
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
      if (result?.success) {
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
        setError(result?.error || 'Failed to update task')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  return {
    showDetailModal,
    setShowDetailModal,
    detailTask,
    setDetailTask,
    detailLoading,
    setDetailLoading,
    editingDetail,
    setEditingDetail,
    editDetailTitle,
    setEditDetailTitle,
    editDetailDescription,
    setEditDetailDescription,
    editDetailPriority,
    setEditDetailPriority,
    editDetailStatus,
    setEditDetailStatus,
    handleOpenDetail,
    handleCloseDetail,
    handleSaveDetail
  }
}
