import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { PtyManager } from './pty-manager.js'
import type { SessionStore } from './session-store.js'

// ─── Debug API ───
// /debug/* routes mounted on the orchestrator HTTP server, giving an external
// agent (via the orchestrator MCP) full introspection into the running app:
// renderer state (through window.__ctDebug, installed by
// src/renderer/debug/debugBridge.ts), main-process PTY internals, renderer
// console output, screenshots, and real input simulation via sendInputEvent.
//
// Gated: routes only respond in debug mode (--debug / DEBUG_MODE=1) or
// development builds, because /debug/eval is arbitrary code execution in the
// renderer.

const IS_DEBUG_ENABLED =
  process.argv.includes('--debug') ||
  process.env.DEBUG_MODE === '1' ||
  process.env.NODE_ENV === 'development' ||
  !app.isPackaged

interface ConsoleEntry {
  ts: number
  level: string
  message: string
  source: string
  line: number
}

const CONSOLE_RING_CAP = 1000
const CONSOLE_LEVELS = ['verbose', 'info', 'warning', 'error']

export class DebugApi {
  private ptyManager: PtyManager
  private sessionStore: SessionStore
  private getMainWindow: () => BrowserWindow | null
  private consoleRing: ConsoleEntry[] = []
  private startedAt = Date.now()

  constructor(
    ptyManager: PtyManager,
    sessionStore: SessionStore,
    getMainWindow: () => BrowserWindow | null,
  ) {
    this.ptyManager = ptyManager
    this.sessionStore = sessionStore
    this.getMainWindow = getMainWindow
  }

  attachToWindow(win: BrowserWindow): void {
    if (!IS_DEBUG_ENABLED) return
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      this.consoleRing.push({
        ts: Date.now(),
        level: CONSOLE_LEVELS[level] ?? String(level),
        message,
        source: sourceId,
        line,
      })
      if (this.consoleRing.length > CONSOLE_RING_CAP) {
        this.consoleRing.splice(0, this.consoleRing.length - CONSOLE_RING_CAP)
      }
    })
  }

  /** Routes /debug/* requests. Returns true if the request was handled. */
  handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
    const route = url.pathname

    if (!IS_DEBUG_ENABLED) {
      this.json(res, 403, {
        error: 'Debug API disabled. Start the app with --debug, DEBUG_MODE=1, or in dev mode.',
      })
      return true
    }

    const terminalMatch = route.match(/^\/debug\/terminal\/([^/]+)$/)

    if (req.method === 'GET' && route === '/debug/state') {
      void this.handleState(res)
    } else if (req.method === 'GET' && terminalMatch) {
      void this.handleTerminal(terminalMatch[1], res)
    } else if (req.method === 'GET' && route === '/debug/events') {
      void this.handleEvents(url, res)
    } else if (req.method === 'GET' && route === '/debug/console') {
      this.handleConsole(url, res)
    } else if (req.method === 'POST' && route === '/debug/action') {
      this.withBody(req, res, body => this.handleAction(body, res))
    } else if (req.method === 'POST' && route === '/debug/eval') {
      this.withBody(req, res, body => this.handleEval(body, res))
    } else if (req.method === 'POST' && route === '/debug/screenshot') {
      void this.handleScreenshot(res)
    } else if (req.method === 'POST' && route === '/debug/input-event') {
      this.withBody(req, res, body => this.handleInputEvent(body, res))
    } else if (req.method === 'POST' && route === '/debug/relaunch') {
      this.withBody(req, res, body => this.handleRelaunch(body, res))
    } else {
      this.json(res, 404, { error: 'Unknown debug route' })
    }
    return true
  }

  // ── helpers ──

  private json(res: http.ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status)
    res.end(JSON.stringify(payload))
  }

  private withBody(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    handler: (body: any) => void | Promise<void>,
  ): void {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 65536) {
        this.json(res, 413, { error: 'Request too large' })
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        void handler(body ? JSON.parse(body) : {})
      } catch {
        this.json(res, 400, { error: 'Invalid JSON' })
      }
    })
  }

  /**
   * Evaluate an expression in the renderer's main world. The expression is
   * wrapped so non-JSON-serializable results become readable errors instead
   * of rejected promises, and thrown errors are captured with their message.
   */
  private async evalInRenderer(expression: string): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const win = this.getMainWindow()
    if (!win || win.isDestroyed()) {
      return { ok: false, error: 'No main window' }
    }
    if (win.webContents.isLoading()) {
      return { ok: false, error: 'Renderer still loading' }
    }
    const wrapped = `(async () => {
      try {
        const __r = await (${expression});
        return { ok: true, result: __r === undefined ? null : JSON.parse(JSON.stringify(__r)) };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    })()`
    try {
      return await win.webContents.executeJavaScript(wrapped, true)
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) }
    }
  }

  private bridgeCall(expr: string): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    return this.evalInRenderer(
      `window.__ctDebug ? (${expr}) : Promise.reject(new Error('debug bridge not installed'))`
    )
  }

  // ── routes ──

  private async handleState(res: http.ServerResponse): Promise<void> {
    const renderer = await this.bridgeCall('window.__ctDebug.getState()')
    const ptySessions = this.ptyManager.listSessions().map(s => ({
      ...s,
      debug: this.ptyManager.getDebugStats(s.id),
    }))
    this.json(res, 200, {
      ok: renderer.ok,
      renderer: renderer.ok ? renderer.result : { error: renderer.error },
      main: {
        ptySessions,
        workspaceFile: this.sessionStore.getWorkspace(),
        debugMode: IS_DEBUG_ENABLED,
        packaged: app.isPackaged,
        uptimeMs: Date.now() - this.startedAt,
        zoomFactor: this.getMainWindow()?.webContents.getZoomFactor() ?? null,
      },
    })
  }

  private async handleTerminal(ptyId: string, res: http.ServerResponse): Promise<void> {
    const r = await this.bridgeCall(`window.__ctDebug.getTerminal(${JSON.stringify(ptyId)})`)
    if (!r.ok) {
      this.json(res, 200, { ok: false, error: r.error })
      return
    }
    if (r.result === null) {
      this.json(res, 404, { ok: false, error: `No registered terminal for ptyId ${ptyId}. Registered ids are in debug_state renderer.registeredTerminalIds.` })
      return
    }
    this.json(res, 200, { ok: true, terminal: r.result, main: this.ptyManager.getDebugStats(ptyId) })
  }

  private async handleEvents(url: URL, res: http.ServerResponse): Promise<void> {
    const since = url.searchParams.get('since')
    const type = url.searchParams.get('type')
    const limit = url.searchParams.get('limit')
    const r = await this.bridgeCall(
      `window.__ctDebug.getEvents(${since ? Number(since) : 'undefined'}, ${type ? JSON.stringify(type) : 'undefined'}, ${limit ? Number(limit) : 200})`
    )
    this.json(res, 200, r.ok ? { ok: true, events: r.result } : { ok: false, error: r.error })
  }

  private handleConsole(url: URL, res: http.ServerResponse): void {
    const level = url.searchParams.get('level')
    const pattern = url.searchParams.get('pattern')
    const limit = parseInt(url.searchParams.get('limit') || '100', 10)
    let entries = this.consoleRing
    if (level) entries = entries.filter(e => e.level === level)
    if (pattern) {
      try {
        const re = new RegExp(pattern)
        entries = entries.filter(e => re.test(e.message))
      } catch {
        this.json(res, 400, { error: 'Invalid pattern regex' })
        return
      }
    }
    this.json(res, 200, { ok: true, messages: entries.slice(-limit) })
  }

  private async handleAction(body: any, res: http.ServerResponse): Promise<void> {
    const { action, args } = body
    if (!action || typeof action !== 'string') {
      this.json(res, 400, { error: 'action is required' })
      return
    }
    const r = await this.bridgeCall(
      `window.__ctDebug.action(${JSON.stringify(action)}, ${JSON.stringify(args ?? {})})`
    )
    this.json(res, 200, r.ok ? { ok: true, result: r.result } : { ok: false, error: r.error })
  }

  private async handleEval(body: any, res: http.ServerResponse): Promise<void> {
    const expression = body.expression
    if (!expression || typeof expression !== 'string') {
      this.json(res, 400, { error: 'expression is required' })
      return
    }
    const r = await this.evalInRenderer(expression)
    this.json(res, 200, r)
  }

  private async handleScreenshot(res: http.ServerResponse): Promise<void> {
    const win = this.getMainWindow()
    if (!win || win.isDestroyed()) {
      this.json(res, 200, { ok: false, error: 'No main window' })
      return
    }
    try {
      const image = await win.webContents.capturePage()
      const dir = path.join(app.getPath('temp'), 'ct-debug')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `shot-${Date.now()}.png`)
      fs.writeFileSync(file, image.toPNG())
      const size = image.getSize()
      this.json(res, 200, { ok: true, path: file, width: size.width, height: size.height })
    } catch (e: any) {
      this.json(res, 200, { ok: false, error: String(e?.message || e) })
    }
  }

  private async handleInputEvent(body: any, res: http.ServerResponse): Promise<void> {
    const win = this.getMainWindow()
    if (!win || win.isDestroyed()) {
      this.json(res, 200, { ok: false, error: 'No main window' })
      return
    }
    const type = body.type

    if (type === 'wheel') {
      const ptyId = body.ptyId
      if (!ptyId) {
        this.json(res, 400, { error: 'ptyId is required for wheel events' })
        return
      }
      const before = await this.bridgeCall(`window.__ctDebug.getTerminal(${JSON.stringify(ptyId)})`)
      if (!before.ok || before.result === null) {
        this.json(res, 200, { ok: false, error: before.error ?? `No registered terminal for ptyId ${ptyId}` })
        return
      }
      const rect = (before.result as any).rect
      if (!rect || rect.width === 0) {
        this.json(res, 200, { ok: false, error: 'Terminal container has no visible rect (tab not active?)' })
        return
      }
      const zoom = win.webContents.getZoomFactor()
      const x = Math.round((rect.x + rect.width / 2) * zoom)
      const y = Math.round((rect.y + rect.height / 2) * zoom)
      const deltaY = Number(body.deltaY ?? 0)
      const deltaX = Number(body.deltaX ?? 0)
      const steps = Math.min(Math.max(Number(body.steps ?? 1), 1), 50)
      for (let i = 0; i < steps; i++) {
        win.webContents.sendInputEvent({
          type: 'mouseWheel',
          x,
          y,
          deltaX,
          deltaY,
          canScroll: true,
        })
        await new Promise(r => setTimeout(r, 30))
      }
      // Give the renderer a frame to settle before snapshotting.
      await new Promise(r => setTimeout(r, 60))
      const after = await this.bridgeCall(`window.__ctDebug.getTerminal(${JSON.stringify(ptyId)})`)
      this.json(res, 200, {
        ok: true,
        sent: { x, y, deltaX, deltaY, steps },
        before: before.result,
        after: after.ok ? after.result : { error: after.error },
      })
      return
    }

    if (type === 'click') {
      // Real mouse click through Chromium's input pipeline. Target either
      // explicit {x, y} or a CSS {selector} (clicks the element's center).
      let x = body.x
      let y = body.y
      if (body.selector) {
        const r = await this.evalInRenderer(
          `(() => { const el = document.querySelector(${JSON.stringify(body.selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; })()`
        )
        if (!r.ok || !r.result) {
          this.json(res, 200, { ok: false, error: `selector not found: ${body.selector}` })
          return
        }
        x = (r.result as any).x
        y = (r.result as any).y
      }
      if (typeof x !== 'number' || typeof y !== 'number') {
        this.json(res, 400, { error: 'click needs x/y or selector' })
        return
      }
      const zoom = win.webContents.getZoomFactor()
      const px = Math.round(x * zoom)
      const py = Math.round(y * zoom)
      win.webContents.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'left', clickCount: 1 })
      await new Promise(r => setTimeout(r, 40))
      win.webContents.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 })
      this.json(res, 200, { ok: true, clicked: { x: px, y: py } })
      return
    }

    if (type === 'key') {
      const key = body.key
      if (!key || typeof key !== 'string') {
        this.json(res, 400, { error: 'key is required for key events' })
        return
      }
      const modifiers = Array.isArray(body.modifiers) ? body.modifiers : []
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
      if (key.length === 1) {
        win.webContents.sendInputEvent({ type: 'char', keyCode: key, modifiers })
      }
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
      this.json(res, 200, { ok: true, sent: { key, modifiers } })
      return
    }

    this.json(res, 400, { error: `Unknown input event type: ${type}. Use 'wheel' or 'key'.` })
  }

  private handleRelaunch(body: any, res: http.ServerResponse): void {
    if (body.confirm !== true) {
      this.json(res, 400, { error: 'Pass {"confirm": true} to relaunch. This terminates and restarts the app.' })
      return
    }
    this.json(res, 200, { ok: true, message: 'Relaunching' })
    // Let the response flush before exiting. Note: under electron-vite dev the
    // relaunched instance detaches from the dev server — prefer restarting the
    // dev task instead.
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 100)
  }
}
