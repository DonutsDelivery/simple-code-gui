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
const DAEMON_BASE = `http://localhost:${DAEMON_PORT}`

/** Get the API base URL — direct to daemon on Electron, proxy through server on mobile */
function getApiBase(): string {
  if (window.electronAPI) return DAEMON_BASE
  // Mobile: proxy through the desktop server
  const config = (window as any).__hostConfig
  if (config) {
    const proto = config.secure ? 'https' : 'http'
    return `${proto}://${config.host}:${config.port}/api/projects/kspec`
  }
  // Fallback: try localStorage
  try {
    const stored = localStorage.getItem('claude-terminal-host-config')
    if (stored) {
      const cfg = JSON.parse(stored)
      const proto = cfg.secure ? 'https' : 'http'
      return `${proto}://${cfg.host}:${cfg.port}/api/projects/kspec`
    }
  } catch { /* ignore */ }
  return DAEMON_BASE
}

function headers(cwd: string): HeadersInit {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Kspec-Dir': cwd
  }
  // Add auth token for proxy requests
  if (!window.electronAPI) {
    try {
      const stored = localStorage.getItem('claude-terminal-host-config')
      if (stored) {
        const cfg = JSON.parse(stored)
        if (cfg.token) h['Authorization'] = `Bearer ${cfg.token}`
      }
    } catch { /* ignore */ }
  }
  return h
}

function apiPath(path: string, cwd: string): string {
  const base = getApiBase()
  if (base === DAEMON_BASE) {
    // Direct daemon: use /api/tasks paths
    return `${base}${path}`
  }
  // Proxy: /api/projects/kspec/tasks paths — add cwd as query param for GET/DELETE
  return `${base}${path.replace('/api/', '/')}`
}

async function api<T>(method: string, path: string, cwd: string, body?: unknown, adapter?: KspecAdapter): Promise<T> {
  const isProxy = getApiBase() !== DAEMON_BASE
  const url = apiPath(path, cwd)

  // For proxy: inject cwd into body for POST/PATCH, or query param for GET/DELETE
  let finalUrl = url
  let finalBody = body

  if (isProxy) {
    if (method === 'GET' || method === 'DELETE') {
      const sep = url.includes('?') ? '&' : '?'
      finalUrl = `${url}${sep}cwd=${encodeURIComponent(cwd)}`
    } else {
      finalBody = { ...(body as Record<string, unknown> || {}), cwd }
    }
  }

  const opts: RequestInit = {
    method,
    headers: headers(cwd)
  }
  if (finalBody && method !== 'GET' && method !== 'DELETE') {
    opts.body = JSON.stringify(finalBody)
  }

  let res: globalThis.Response
  try {
    res = await fetch(finalUrl, opts)
  } catch (e) {
    // Network error — daemon likely crashed, reset ensured flag on the instance
    if (adapter) adapter._daemonEnsuredFlag = false
    throw e
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  const json = await res.json()
  // kspec >= 0.13 wraps responses in { data, meta }.  Earlier versions
  // returned the payload at the top level (with shapes like { items: [] }
  // for lists or task fields directly).  Unwrap centrally so callers can
  // read the payload regardless of daemon version.
  if (
    json && typeof json === 'object' && !Array.isArray(json) &&
    'data' in json && 'meta' in json
  ) {
    return json.data as T
  }
  return json as T
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
    hasSpec: typeof raw.spec_ref === 'string' && raw.spec_ref.length > 0,
    _backend: 'kspec'
  }
}

export class KspecAdapter implements TaskAdapter {
  readonly kind = 'kspec' as const

  // Per-instance daemon state (avoids cross-instance interference from module-level globals)
  _daemonEnsuredFlag = true
  private _daemonEnsuredForCwd: string | null = null

  private async ensureDaemon(cwd: string): Promise<boolean> {
    // Reset flag when switching projects so we re-verify daemon for new cwd
    if (this._daemonEnsuredForCwd !== null && this._daemonEnsuredForCwd !== cwd) {
      this._daemonEnsuredFlag = false
    }

    // Quick health check first
    try {
      const res = await fetch(`${DAEMON_BASE}/api/health`)
      if (res.ok) { this._daemonEnsuredFlag = true; this._daemonEnsuredForCwd = cwd; return true }
    } catch { /* daemon not running */ }

    // Start daemon via IPC (only available in Electron)
    if (window.electronAPI?.kspecEnsureDaemon) {
      const result = await window.electronAPI.kspecEnsureDaemon(cwd)
      if (result?.success) { this._daemonEnsuredFlag = true; this._daemonEnsuredForCwd = cwd; return true }
    }

    // On mobile, the proxy handles routing — if check endpoint works, daemon is up
    if (!window.electronAPI) {
      const base = getApiBase()
      if (base !== DAEMON_BASE) {
        try {
          const res = await fetch(`${base}/check?cwd=${encodeURIComponent(cwd)}`, { headers: headers(cwd) })
          if (res.ok) {
            const data = await res.json().catch(() => ({}))
            if (data?.data?.exists) { this._daemonEnsuredFlag = true; this._daemonEnsuredForCwd = cwd; return true }
          }
        } catch { /* proxy unreachable */ }
      }
    }

    return false
  }

  /** Try an API call; on network error, restart the daemon and retry once. */
  private async withRetry<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      // Only retry on network errors (daemon down), not HTTP errors
      if (!(e instanceof TypeError)) throw e
      const started = await this.ensureDaemon(cwd)
      if (!started) throw e
      return await fn()
    }
  }

  async check(cwd: string): Promise<BackendStatus> {
    // Electron: check if .kspec/ exists via IPC
    if (window.electronAPI?.kspecCheck) {
      const hasKspec = await window.electronAPI.kspecCheck(cwd)
      if (!hasKspec?.exists) {
        return { kind: 'kspec', installed: true, initialized: false }
      }
      await this.ensureDaemon(cwd)
      return { kind: 'kspec', installed: true, initialized: true }
    }

    // Non-Electron (Android/web): check via server proxy
    try {
      const base = getApiBase()
      const url = base === DAEMON_BASE
        ? `${DAEMON_BASE}/api/tasks`
        : `${base}/check?cwd=${encodeURIComponent(cwd)}`
      const res = await fetch(url, { method: 'GET', headers: headers(cwd) })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        // Proxy returns { data: { exists: true/false } }
        if (data?.data?.exists === false) {
          return { kind: 'kspec', installed: true, initialized: false }
        }
        return { kind: 'kspec', installed: true, initialized: true }
      }
    } catch { /* daemon not reachable */ }
    return { kind: 'kspec', installed: true, initialized: false }
  }

  async init(cwd: string): Promise<{ success: boolean; error?: string }> {
    const result = await window.electronAPI?.kspecInit?.(cwd)
    return { success: !!result?.success, error: result?.error }
  }

  async list(cwd: string): Promise<UnifiedTask[]> {
    try {
      // kspec >= 0.13: api() unwraps { data, meta } so we get the array directly.
      // Earlier kspec returned { items: [...] } at top level. Support both.
      const raw = await this.withRetry(cwd, () =>
        api<Record<string, unknown>[] | { items: Record<string, unknown>[] }>(
          'GET', '/api/tasks', cwd, undefined, this
        ))
      const items = Array.isArray(raw) ? raw : (raw?.items ?? [])
      return items.map(toUnified)
    } catch (e) {
      console.warn('[kspec-adapter] task list failed:', e)
      return []
    }
  }

  async show(cwd: string, taskId: string): Promise<UnifiedTask | null> {
    try {
      const data = await this.withRetry(cwd, () =>
        api<Record<string, unknown>>('GET', `/api/tasks/${encodeURIComponent(taskId)}`, cwd, undefined, this))
      return toUnified(data)
    } catch {
      return null
    }
  }

  async create(cwd: string, params: CreateTaskParams): Promise<{ success: boolean; error?: string }> {
    try {
      await this.withRetry(cwd, () => api('POST', '/api/tasks', cwd, {
        title: params.title,
        description: params.description,
        priority: params.priority,
        type: params.type,
        tags: params.tags?.split(',').map(t => t.trim()).filter(Boolean),
        automation: params.automation || undefined
      }, this))
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async start(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.withRetry(cwd, () =>
        api('POST', `/api/tasks/${encodeURIComponent(taskId)}/start`, cwd, undefined, this))
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async complete(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.withRetry(cwd, () =>
        api('POST', `/api/tasks/${encodeURIComponent(taskId)}/complete`, cwd, undefined, this))
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async delete(cwd: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    // Daemon doesn't have a DELETE endpoint — use CLI via IPC (Electron) or proxy route (mobile)
    if (window.electronAPI?.kspecDeleteTask) {
      return window.electronAPI.kspecDeleteTask(cwd, taskId)
    }
    try {
      await this.withRetry(cwd, () =>
        api('DELETE', `/api/tasks/${encodeURIComponent(taskId)}`, cwd, undefined, this))
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
      await this.withRetry(cwd, () =>
        api('PATCH', `/api/tasks/${encodeURIComponent(taskId)}`, cwd, body, this))
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
          await this.withRetry(cwd, () =>
            api('PATCH', `/api/tasks/${encodeURIComponent(taskId)}`, cwd, { status: 'pending' }, this))
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
    // If switching projects, clean up old connection and pending reconnect timer
    if (this.watchedCwd !== cwd) {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
      if (this.ws) {
        this.ws.close()
        this.ws = null
      }
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
