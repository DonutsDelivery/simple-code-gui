/**
 * Unified Task Interface
 *
 * Backend-agnostic task type used by the TaskPanel.
 * Both beads and kspec tasks normalize to this shape.
 */

export interface UnifiedTask {
  id: string
  displayId?: string
  title: string
  status: TaskStatus
  priority?: number
  type?: string
  description?: string
  created_at?: string
  updated_at?: string
  tags?: string[]
  automation?: AutomationEligibility
  // Source tracking (invisible to user, used internally for routing)
  _backend: 'beads' | 'kspec'
}

export type TaskStatus = 'open' | 'in_progress' | 'closed'

// Beads types: task, bug, feature, epic, chore
// Kspec types: task, bug, epic, spike, infra
export type TaskType = 'task' | 'bug' | 'feature' | 'epic' | 'chore' | 'spike' | 'infra'

export type AutomationEligibility = 'eligible' | 'needs_review' | 'manual_only'

export interface CreateTaskParams {
  title: string
  description?: string
  priority?: number
  type?: TaskType
  tags?: string
  automation?: AutomationEligibility
}

export interface UpdateTaskParams {
  status?: TaskStatus
  title?: string
  description?: string
  priority?: number
  automation?: AutomationEligibility
}

export type BackendKind = 'beads' | 'kspec' | 'none'

export interface BackendStatus {
  kind: BackendKind
  installed: boolean
  initialized: boolean
}

/**
 * TaskAdapter — the contract both backends implement.
 * The panel calls these methods without knowing which backend is active.
 */
export interface TaskAdapter {
  readonly kind: BackendKind

  check(cwd: string): Promise<BackendStatus>
  init(cwd: string): Promise<{ success: boolean; error?: string }>
  list(cwd: string): Promise<UnifiedTask[]>
  show(cwd: string, taskId: string): Promise<UnifiedTask | null>
  create(cwd: string, params: CreateTaskParams): Promise<{ success: boolean; error?: string }>
  start(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }>
  complete(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }>
  delete(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }>
  update(cwd: string, taskId: string, params: UpdateTaskParams): Promise<{ success: boolean; error?: string }>
  cycleStatus(cwd: string, taskId: string, currentStatus: TaskStatus): Promise<{ success: boolean; error?: string }>

  watch(cwd: string): void
  unwatch(cwd: string): void
  onTasksChanged(callback: (data: { cwd: string }) => void): () => void
}
