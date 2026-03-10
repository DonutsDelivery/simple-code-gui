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

// Shared flag so API failures can signal the adapter to re-check daemon
let _daemonEnsuredFlag = true
// Last project dir we ensured daemon for — reset flag on project switch
let _daemonEnsuredForCwd: string | null = null

async function api<T>(method: string, path: string, cwd: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: headers(cwd)
  }
  if (body) opts.body = JSON.stringify(body)
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, opts)
  } catch (e) {
    // Network error — daemon likely crashed, reset ensured flag
    _daemonEnsuredFlag = false
    throw e
  }
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

  private async ensureDaemon(cwd: string): Promise<boolean> {
    // Reset flag when switching projects so we re-verify daemon for new cwd
    if (_daemonEnsuredForCwd !== null && _daemonEnsuredForCwd !== cwd) {
      _daemonEnsuredFlag = false
    }

    // Quick health check first
    try {
      const res = await fetch(`${API_BASE}/api/health`)
      if (res.ok) { _daemonEnsuredFlag = true; _daemonEnsuredForCwd = cwd; return true }
    } catch { /* daemon not running */ }

    // Start daemon via IPC (always attempt if health check failed)
    const result = await window.electronAPI?.kspecEnsureDaemon?.(cwd)
    if (result?.success) { _daemonEnsuredFlag = true; _daemonEnsuredForCwd = cwd; return true }
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
      // Map unified status names back to kspec native status names
      const body = { ...params }
      if (body.status === 'open') body.status = 'pending' as TaskStatus
      if (body.status === 'closed') body.status = 'completed' as TaskStatus
      await api('PATCH', `/api/tasks/${encodeURIComponent(taskId)}`, cwd, body)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async cycleStatus(cwd: string, taskId: string, currentStatus: TaskStatus): Promise<{ success: boolean; error?: string }> {
    switch (currentStatus) {
      case 'open': return this.start(cwd, taskId)
      case 'in_progress': return this.complete(cwd, taskId)
      default:
        // Kspec uses 'pending' internally — 'open' is only the unified status
        try {
          await api('PATCH', `/api/tasks/${encodeURIComponent(taskId)}`, cwd, { status: 'pending' })
          return { success: true }
        } catch (e) {
          return { success: false, error: String(e) }
        }
    }
  }

  // Kspec uses WebSocket for live updates instead of file watching
  private ws: WebSocket | null = null
  private wsCallbacks: Set<(data: { cwd: string }) => void> = new Set()
  private watchedCwd: string | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private watching = false

  watch(cwd: string): void {
    // If switching projects, close old connection first
    if (this.ws && this.watchedCwd !== cwd) {
      this.ws.close()
      this.ws = null
    }
    this.watching = true
    this.watchedCwd = cwd
    this.reconnectDelay = 1000
    this.connectWs(cwd)
  }

  private connectWs(cwd: string): void {
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
      this.ws.onopen = () => {
        this.reconnectDelay = 1000 // Reset backoff on successful connection
      }
      this.ws.onclose = () => {
        this.ws = null
        // Auto-reconnect with exponential backoff (cap at 30s)
        if (this.watching && this.watchedCwd === cwd) {
          this.reconnectTimer = setTimeout(() => this.connectWs(cwd), this.reconnectDelay)
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
        }
      }
      this.ws.onerror = () => {
        // onclose will fire after onerror, triggering reconnect
      }
    } catch { /* daemon not running — reconnect will retry */ }
  }

  unwatch(_cwd: string): void {
    this.watching = false
    this.watchedCwd = null
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }

  onTasksChanged(callback: (data: { cwd: string }) => void): () => void {
    this.wsCallbacks.add(callback)
    return () => { this.wsCallbacks.delete(callback) }
  }
}
