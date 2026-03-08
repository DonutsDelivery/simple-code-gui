import { useState } from 'react'
import type { UnifiedTask, TaskAdapter } from './adapters/types.js'

export interface DetailModalState {
  showDetailModal: boolean
  setShowDetailModal: React.Dispatch<React.SetStateAction<boolean>>
  detailTask: UnifiedTask | null
  setDetailTask: React.Dispatch<React.SetStateAction<UnifiedTask | null>>
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
  handleOpenDetail: (task: UnifiedTask) => Promise<void>
  handleCloseDetail: () => void
  handleSaveDetail: () => Promise<void>
}

interface UseBeadsDetailParams {
  projectPath: string | null
  loadTasks: () => Promise<void>
  setError: (error: string) => void
  adapter: TaskAdapter | null
}

export function useBeadsDetail({
  projectPath,
  loadTasks,
  setError,
  adapter
}: UseBeadsDetailParams): DetailModalState & DetailModalCallbacks {
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [detailTask, setDetailTask] = useState<UnifiedTask | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editingDetail, setEditingDetail] = useState(false)
  const [editDetailTitle, setEditDetailTitle] = useState('')
  const [editDetailDescription, setEditDetailDescription] = useState('')
  const [editDetailPriority, setEditDetailPriority] = useState<number>(2)
  const [editDetailStatus, setEditDetailStatus] = useState<string>('open')

  const handleOpenDetail = async (task: UnifiedTask): Promise<void> => {
    if (!projectPath || !adapter) return

    setShowDetailModal(true)
    setDetailLoading(true)
    setEditingDetail(true)

    try {
      const fullTask = await adapter.show(projectPath, task.id)
      if (fullTask) {
        setDetailTask(fullTask)
        setEditDetailTitle(fullTask.title || '')
        setEditDetailDescription(fullTask.description || '')
        setEditDetailPriority(fullTask.priority ?? 2)
        setEditDetailStatus(fullTask.status || 'open')
      } else {
        setError('Failed to load task details')
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
    if (!projectPath || !detailTask || !adapter) return

    try {
      const result = await adapter.update(projectPath, detailTask.id, {
        status: editDetailStatus as UnifiedTask['status'],
        title: editDetailTitle.trim(),
        description: editDetailDescription.trim(),
        priority: editDetailPriority
      })
      if (result.success) {
        setDetailTask({
          ...detailTask,
          title: editDetailTitle.trim(),
          description: editDetailDescription.trim(),
          status: editDetailStatus as UnifiedTask['status'],
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
