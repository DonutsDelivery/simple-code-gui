/**
 * Beads Adapter
 *
 * Wraps existing window.electronAPI.beads* calls into the TaskAdapter interface.
 * This is a thin shim — all logic stays in the existing IPC handlers.
 */

import type {
  TaskAdapter,
  BackendStatus,
  UnifiedTask,
  CreateTaskParams,
  UpdateTaskParams,
  TaskStatus
} from './types.js'

function normalizeStatus(status: string): TaskStatus {
  switch (status) {
    case 'in_progress': return 'in_progress'
    case 'closed': return 'closed'
    default: return 'open'
  }
}

function toUnified(raw: Record<string, unknown>): UnifiedTask {
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    status: normalizeStatus(String(raw.status ?? 'open')),
    priority: typeof raw.priority === 'number' ? raw.priority : undefined,
    type: typeof raw.issue_type === 'string' ? raw.issue_type : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : typeof raw.created === 'string' ? raw.created : undefined,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
    _backend: 'beads'
  }
}

export class BeadsAdapter implements TaskAdapter {
  readonly kind = 'beads' as const

  async check(cwd: string): Promise<BackendStatus> {
    const status = await window.electronAPI?.beadsCheck(cwd)
    if (!status) {
      return { kind: 'beads', installed: false, initialized: false }
    }
    return {
      kind: 'beads',
      installed: status.installed,
      initialized: status.initialized
    }
  }

  async init(cwd: string): Promise<{ success: boolean; error?: string }> {
    const result = await window.electronAPI?.beadsInit(cwd)
    return { success: !!result?.success, error: result?.error }
  }

  async list(cwd: string): Promise<UnifiedTask[]> {
    const result = await window.electronAPI?.beadsList(cwd)
    if (!result?.success || !result.tasks) return []
    return (result.tasks as Record<string, unknown>[]).map(toUnified)
  }

  async show(cwd: string, taskId: string): Promise<UnifiedTask | null> {
    const result = await window.electronAPI?.beadsShow(cwd, taskId)
    if (!result?.success || !result.task) return null
    return toUnified(result.task as Record<string, unknown>)
  }

  async create(cwd: string, params: CreateTaskParams): Promise<{ success: boolean; error?: string }> {
    const result = await window.electronAPI?.beadsCreate(
      cwd,
      params.title,
      params.description,
      params.priority,
      params.type,
      params.tags
    )
    return { success: !!result?.success, error: result?.error }
  }

  async start(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    const result = await window.electronAPI?.beadsStart(cwd, taskId)
    return { success: !!result?.success, error: result?.error }
  }

  async complete(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    const result = await window.electronAPI?.beadsComplete(cwd, taskId)
    return { success: !!result?.success, error: result?.error }
  }

  async delete(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    const result = await window.electronAPI?.beadsDelete(cwd, taskId)
    return { success: !!result?.success, error: result?.error }
  }

  async update(cwd: string, taskId: string, params: UpdateTaskParams): Promise<{ success: boolean; error?: string }> {
    const result = await window.electronAPI?.beadsUpdate(
      cwd,
      taskId,
      params.status,
      params.title,
      params.description,
      params.priority
    )
    return { success: !!result?.success, error: result?.error }
  }

  async cycleStatus(cwd: string, taskId: string, currentStatus: TaskStatus): Promise<{ success: boolean; error?: string }> {
    let nextStatus: string
    switch (currentStatus) {
      case 'open': nextStatus = 'in_progress'; break
      case 'in_progress': nextStatus = 'closed'; break
      default: nextStatus = 'open'
    }
    return this.update(cwd, taskId, { status: nextStatus as TaskStatus })
  }

  watch(cwd: string): void {
    window.electronAPI?.beadsWatch(cwd)
  }

  unwatch(cwd: string): void {
    window.electronAPI?.beadsUnwatch(cwd)
  }

  onTasksChanged(callback: (data: { cwd: string }) => void): () => void {
    return window.electronAPI?.onBeadsTasksChanged(callback) ?? (() => {})
  }
}
