/**
 * Kspec Adapter
 *
 * Talks to the kspec daemon HTTP API + IPC for init/check.
 * Normalizes kspec tasks into the unified TaskAdapter interface.
 */

import type {
  TaskAdapter,
  BackendStatus,
  UnifiedTask,
  CreateTaskParams,
  UpdateTaskParams,
  TaskStatus
} from './types.js'

const DAEMON_PORT = 3456
const API_BASE = `http://localhost:${DAEMON_PORT}`

function headers(cwd: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Kspec-Dir': cwd
  }
}

async function api<T>(method: string, path: string, cwd: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: headers(cwd)
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${API_BASE}${path}`, opts)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

function normalizeStatus(status: string): TaskStatus {
  switch (status) {
    case 'in_progress': return 'in_progress'
    case 'completed':
    case 'cancelled':
      return 'closed'
    case 'pending':
    case 'blocked':
    case 'pending_review':
    case 'needs_work':
    default:
      return 'open'
  }
}

function toUnified(raw: Record<string, unknown>): UnifiedTask {
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : undefined
  // kspec uses _ulid as primary ID and slugs[] for human-friendly refs
  const slugs = Array.isArray(raw.slugs) ? raw.slugs : []
  // Use slug if available, otherwise full ULID (needed for API calls)
  const id = slugs.length > 0 ? String(slugs[0]) : String(raw._ulid ?? raw.slug ?? raw.id ?? '')
  return {
    id,
    // Short display ID for the UI — slug or first 8 chars of ULID
    displayId: slugs.length > 0 ? String(slugs[0]) : (id.length > 12 ? id.slice(0, 8) : id),
    title: String(raw.title ?? ''),
    status: normalizeStatus(String(raw.status ?? 'pending')),
    priority: typeof raw.priority === 'number' ? raw.priority : undefined,
    type: typeof raw.type === 'string' ? raw.type : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
    tags,
    automation: typeof raw.automation === 'string' ? raw.automation as UnifiedTask['automation'] : undefined,
    _backend: 'kspec'
  }
}

export class KspecAdapter implements TaskAdapter {
  readonly kind = 'kspec' as const
  private daemonEnsured = false

  private async ensureDaemon(cwd: string): Promise<boolean> {
    // Quick health check first
    try {
      const res = await fetch(`${API_BASE}/api/health`)
      if (res.ok) { this.daemonEnsured = true; return true }
    } catch { /* daemon not running */ }

    // Start daemon via IPC
    if (!this.daemonEnsured) {
      const result = await window.electronAPI?.kspecEnsureDaemon?.(cwd)
      if (result?.success) { this.daemonEnsured = true; return true }
    }
    return false
  }

  async check(cwd: string): Promise<BackendStatus> {
    // Check if .kspec/ exists via IPC (filesystem check)
    const hasKspec = await window.electronAPI?.kspecCheck?.(cwd)
    if (!hasKspec?.exists) {
      return { kind: 'kspec', installed: true, initialized: false }
    }

    // Try to ensure daemon is running
    await this.ensureDaemon(cwd)
    return { kind: 'kspec', installed: true, initialized: true }
  }

  async init(cwd: string): Promise<{ success: boolean; error?: string }> {
    const result = await window.electronAPI?.kspecInit?.(cwd)
    return { success: !!result?.success, error: result?.error }
  }

  async list(cwd: string): Promise<UnifiedTask[]> {
    try {
      const data = await api<{ items: Record<string, unknown>[] }>('GET', '/api/tasks', cwd)
      return (data.items ?? []).map(toUnified)
    } catch {
      // Daemon might not be running — try to start it and retry once
      const started = await this.ensureDaemon(cwd)
      if (started) {
        try {
          const data = await api<{ items: Record<string, unknown>[] }>('GET', '/api/tasks', cwd)
          return (data.items ?? []).map(toUnified)
        } catch { /* still failed */ }
      }
      return []
    }
  }

  async show(cwd: string, taskId: string): Promise<UnifiedTask | null> {
    try {
      const data = await api<Record<string, unknown>>('GET', `/api/tasks/${encodeURIComponent(taskId)}`, cwd)
      return toUnified(data)
    } catch {
      return null
    }
  }

  async create(cwd: string, params: CreateTaskParams): Promise<{ success: boolean; error?: string }> {
    try {
      await api('POST', '/api/tasks', cwd, {
        title: params.title,
        description: params.description,
        priority: params.priority,
        type: params.type,
        tags: params.tags?.split(',').map(t => t.trim()).filter(Boolean),
        automation: params.automation || undefined
      })
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async start(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await api('POST', `/api/tasks/${encodeURIComponent(taskId)}/start`, cwd)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async complete(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await api('POST', `/api/tasks/${encodeURIComponent(taskId)}/complete`, cwd)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async delete(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await api('DELETE', `/api/tasks/${encodeURIComponent(taskId)}`, cwd)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async update(cwd: string, taskId: string, params: UpdateTaskParams): Promise<{ success: boolean; error?: string }> {
    try {
      await api('PATCH', `/api/tasks/${encodeURIComponent(taskId)}`, cwd, params)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async cycleStatus(cwd: string, taskId: string, currentStatus: TaskStatus): Promise<{ success: boolean; error?: string }> {
    switch (currentStatus) {
      case 'open': return this.start(cwd, taskId)
      case 'in_progress': return this.complete(cwd, taskId)
      default: return this.update(cwd, taskId, { status: 'open' })
    }
  }

  // Kspec uses WebSocket for live updates instead of file watching
  private ws: WebSocket | null = null
  private wsCallbacks: Set<(data: { cwd: string }) => void> = new Set()

  watch(cwd: string): void {
    if (this.ws) return
    try {
      this.ws = new WebSocket(`ws://localhost:${DAEMON_PORT}/ws?project=${encodeURIComponent(cwd)}`)
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.event === 'tasks:updates' || msg.event === 'task_updated') {
            this.wsCallbacks.forEach(cb => cb({ cwd }))
          }
        } catch { /* ignore parse errors */ }
      }
      this.ws.onclose = () => { this.ws = null }
    } catch { /* daemon not running */ }
  }

  unwatch(_cwd: string): void {
    this.ws?.close()
    this.ws = null
  }

  onTasksChanged(callback: (data: { cwd: string }) => void): () => void {
    this.wsCallbacks.add(callback)
    return () => { this.wsCallbacks.delete(callback) }
  }
}
