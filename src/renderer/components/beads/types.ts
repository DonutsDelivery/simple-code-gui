import type { UnifiedTask } from './adapters/types.js'

// Re-export UnifiedTask as the canonical task type
export type { UnifiedTask }

// Legacy alias for backward compatibility
export type BeadsTask = UnifiedTask

export const PRIORITY_LABELS = ['Critical', 'High', 'Medium', 'Low', 'Lowest']

// Task status ordering for sorting
export type TaskStatus = 'open' | 'in_progress' | 'closed'
export const STATUS_ORDER: Record<TaskStatus, number> = { open: 0, in_progress: 1, closed: 2 }

export function getStatusOrder(status: string): number {
  return status in STATUS_ORDER ? STATUS_ORDER[status as TaskStatus] : 0
}

export const BEADS_HEIGHT_KEY = 'beads-panel-height'
export const DEFAULT_HEIGHT = 200
export const MIN_HEIGHT = 100
export const MAX_HEIGHT = 500

export function getPriorityClass(priority?: number): string {
  switch (priority) {
    case 0: return 'priority-critical'
    case 1: return 'priority-high'
    case 2: return 'priority-medium'
    default: return 'priority-low'
  }
}

export function getPriorityLabel(priority?: number): string {
  return PRIORITY_LABELS[priority ?? 4] || 'Lowest'
}

export function formatStatusLabel(status: string): string {
  switch (status) {
    case 'in_progress': return 'In Progress'
    case 'closed': return 'Done'
    default: return 'Open'
  }
}

export function formatTaskPrompt(task: UnifiedTask): string {
  let prompt = `Work on this task:\n\n**${task.title}** (${task.id})`
  if (task.description) {
    prompt += `\n\nDescription:\n${task.description}`
  }
  if (task.type) {
    prompt += `\n\nType: ${task.type}`
  }
  if (task.priority !== undefined) {
    prompt += `\nPriority: ${getPriorityLabel(task.priority)}`
  }
  prompt += '\n\nPlease analyze this task and begin working on it. Update the task status to in_progress when you start.'
  return prompt
}
