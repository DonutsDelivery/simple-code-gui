import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { useWorkspaceStore } from '../stores/workspace.js'

// ─── Debug Bridge ───
// Installs window.__ctDebug so the main process (via webContents.executeJavaScript,
// exposed through the orchestrator /debug/* HTTP routes) can introspect renderer
// state: workspace store, per-terminal xterm scroll state, and a trace ring of
// debug events. Everything returned must be plain JSON-serializable data.

export interface TerminalRegistration {
  terminal: XTerm
  fitAddon: FitAddon | null
  userScrolledUpRef: { current: boolean }
  container: HTMLElement | null
  webglActive: () => boolean
}

interface DebugEvent {
  seq: number
  ts: number
  type: string
  data: Record<string, unknown>
}

const EVENT_RING_CAP = 1000

const terminals = new Map<string, TerminalRegistration>()
const events: DebugEvent[] = []
let eventSeq = 0

export function registerTerminal(ptyId: string, reg: TerminalRegistration): void {
  terminals.set(ptyId, reg)
  debugTrace('terminal:register', { ptyId })
}

export function unregisterTerminal(ptyId: string): void {
  if (terminals.delete(ptyId)) {
    debugTrace('terminal:unregister', { ptyId })
  }
}

export function debugTrace(type: string, data: Record<string, unknown>): void {
  events.push({ seq: ++eventSeq, ts: Date.now(), type, data })
  if (events.length > EVENT_RING_CAP) {
    events.splice(0, events.length - EVENT_RING_CAP)
  }
}

function snapshotTerminal(ptyId: string): Record<string, unknown> | null {
  const reg = terminals.get(ptyId)
  if (!reg) return null
  const { terminal, container, userScrolledUpRef } = reg
  const buffer = terminal.buffer.active
  const rect = container?.getBoundingClientRect()
  return {
    ptyId,
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
    atBottom: buffer.viewportY >= buffer.baseY,
    rows: terminal.rows,
    cols: terminal.cols,
    scrollbackLines: buffer.length,
    bufferType: buffer.type,
    userScrolledUp: userScrolledUpRef.current,
    webglActive: reg.webglActive(),
    hasFocus: !!container && container.contains(document.activeElement),
    rect: rect
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : null,
  }
}

function getState(): Record<string, unknown> {
  const s = useWorkspaceStore.getState()
  return {
    activeSessionId: s.activeSessionId,
    sessions: s.sessions.map(ws => ({
      id: ws.id,
      name: ws.name,
      isRestored: ws.isRestored,
      hasSavedData: !!ws.savedData,
      tabCount: ws.openTabs.length,
      activeTabId: ws.activeTabId,
      tabs: ws.openTabs.map(t => ({
        id: t.id,
        title: t.title,
        ptyId: t.ptyId,
        projectPath: t.projectPath,
        backend: t.backend ?? null,
      })),
    })),
    openTabs: s.openTabs.map(t => ({
      id: t.id,
      title: t.title,
      ptyId: t.ptyId,
      projectPath: t.projectPath,
      backend: t.backend ?? null,
    })),
    activeTabId: s.activeTabId,
    activeTileTree: s.activeTileTree ?? null,
    projectCount: s.projects.length,
    registeredTerminalIds: [...terminals.keys()],
  }
}

function action(
  name: string,
  args: Record<string, any> = {},
): Record<string, unknown> | Promise<Record<string, unknown>> {
  const store = useWorkspaceStore.getState()
  const terminalSnapshot = (ptyId?: string) =>
    ptyId ? snapshotTerminal(ptyId) : null

  switch (name) {
    case 'switch_workspace': {
      const before = { activeSessionId: store.activeSessionId }
      if (!store.sessions.some(ws => ws.id === args.sessionId)) {
        return { ok: false, error: `unknown sessionId: ${args.sessionId}` }
      }
      store.switchSession(args.sessionId)
      const after = { activeSessionId: useWorkspaceStore.getState().activeSessionId }
      return { ok: after.activeSessionId === args.sessionId, before, after }
    }
    case 'set_active_tab': {
      const before = { activeTabId: store.activeTabId }
      if (!store.openTabs.some(t => t.id === args.tabId)) {
        return { ok: false, error: `unknown tabId: ${args.tabId}` }
      }
      store.setActiveTab(args.tabId)
      const after = { activeTabId: useWorkspaceStore.getState().activeTabId }
      return { ok: after.activeTabId === args.tabId, before, after }
    }
    case 'scroll_terminal': {
      const reg = terminals.get(args.ptyId)
      if (!reg) return { ok: false, error: `no registered terminal: ${args.ptyId}` }
      const before = terminalSnapshot(args.ptyId)
      reg.terminal.scrollLines(args.lines ?? 0)
      return { ok: true, before, after: terminalSnapshot(args.ptyId) }
    }
    case 'scroll_to_bottom': {
      const reg = terminals.get(args.ptyId)
      if (!reg) return { ok: false, error: `no registered terminal: ${args.ptyId}` }
      const before = terminalSnapshot(args.ptyId)
      reg.terminal.scrollToBottom()
      reg.userScrolledUpRef.current = false
      return { ok: true, before, after: terminalSnapshot(args.ptyId) }
    }
    case 'focus_terminal': {
      const reg = terminals.get(args.ptyId)
      if (!reg) return { ok: false, error: `no registered terminal: ${args.ptyId}` }
      reg.terminal.focus()
      return { ok: true, after: terminalSnapshot(args.ptyId) }
    }
    case 'dispatch_wheel': {
      // Synthetic WheelEvent on the xterm screen element. Bypasses Chromium's
      // input pipeline — prefer /debug/input-event (sendInputEvent) for real-path
      // testing; this exists to isolate the handler itself.
      const reg = terminals.get(args.ptyId)
      if (!reg || !reg.container) return { ok: false, error: `no registered terminal: ${args.ptyId}` }
      const screen = reg.container.querySelector('.xterm-screen')
      if (!screen) return { ok: false, error: 'no .xterm-screen element' }
      const before = terminalSnapshot(args.ptyId)
      const rect = screen.getBoundingClientRect()
      screen.dispatchEvent(new WheelEvent('wheel', {
        deltaY: args.deltaY ?? 0,
        deltaX: args.deltaX ?? 0,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
        bubbles: true,
        cancelable: true,
      }))
      return { ok: true, before, after: terminalSnapshot(args.ptyId) }
    }
    case 'inject_output': {
      // Write data into the xterm buffer only (NOT the PTY) — deterministic
      // scrollback for scroll testing without involving a real CLI process.
      const reg = terminals.get(args.ptyId)
      if (!reg) return { ok: false, error: `no registered terminal: ${args.ptyId}` }
      const before = terminalSnapshot(args.ptyId)
      let data: string
      if (typeof args.data === 'string') {
        data = args.data
      } else {
        const lines = Math.min(Number(args.lines ?? 100), 10000)
        data = Array.from({ length: lines }, (_, i) => `debug-inject line ${i + 1} of ${lines}\r\n`).join('')
      }
      // Await the write so the after-snapshot reflects the new buffer state.
      return new Promise(resolve => {
        reg.terminal.write(data, () => {
          resolve({ ok: true, before, after: terminalSnapshot(args.ptyId) })
        })
      })
    }
    case 'clear_events': {
      const cleared = events.length
      events.length = 0
      return { ok: true, cleared }
    }
    default:
      return { ok: false, error: `unknown action: ${name}` }
  }
}

export function installDebugBridge(): void {
  ;(window as any).__ctDebug = {
    getState,
    getTerminal: snapshotTerminal,
    getEvents: (sinceSeq?: number, type?: string, limit = 200) => {
      let result = events as DebugEvent[]
      if (sinceSeq != null) result = result.filter(e => e.seq > sinceSeq)
      if (type) result = result.filter(e => e.type.includes(type))
      return result.slice(-limit)
    },
    clearEvents: () => action('clear_events'),
    // Full visible buffer text (scrollback + viewport) for content-level assertions
    getTerminalText: (ptyId: string): string | null => {
      const reg = terminals.get(ptyId)
      if (!reg) return null
      const buf = reg.terminal.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i)
        if (line) lines.push(line.translateToString(true))
      }
      return lines.join('\n')
    },
    action,
    trace: debugTrace,
    // Full store handle so debug_eval can read/drive any store action,
    // e.g. window.__ctDebug.store.getState().addSession(...)
    store: useWorkspaceStore,
  }
}
