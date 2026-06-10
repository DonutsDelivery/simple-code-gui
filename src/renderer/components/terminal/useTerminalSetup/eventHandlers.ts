import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { MutableRefObject } from 'react'
import {
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  FONT_SIZE_STORAGE_KEY,
} from '../constants.js'
import { handlePaste, isTerminalAtBottom, scrollDebug, scrollSnapshot } from '../utils.js'

type BackendType = 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok'

function clampCell(value: number, max: number): number {
  return Math.max(1, Math.min(max, value))
}

function getWheelCell(terminal: XTerm, event: WheelEvent): { col: number; row: number } {
  const screen = terminal.element?.querySelector('.xterm-screen') as HTMLElement | null
  const rect = screen?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0 || terminal.cols <= 0 || terminal.rows <= 0) {
    return { col: 1, row: 1 }
  }

  const cellWidth = rect.width / terminal.cols
  const cellHeight = rect.height / terminal.rows
  return {
    col: clampCell(Math.floor((event.clientX - rect.left) / cellWidth) + 1, terminal.cols),
    row: clampCell(Math.floor((event.clientY - rect.top) / cellHeight) + 1, terminal.rows),
  }
}

function getWheelReportCount(event: WheelEvent): number {
  const delta = Math.abs(event.deltaY)
  if (delta === 0) return 0
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return Math.min(5, Math.max(1, Math.round(delta)))
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return Math.min(5, Math.max(1, Math.round(delta * 3)))
  return Math.min(5, Math.max(1, Math.ceil(delta / 40)))
}

function shouldFallbackToSgrWheel(terminal: XTerm, backend?: BackendType): boolean {
  return (
    backend === 'opencode' &&
    terminal.buffer.active.type === 'alternate' &&
    terminal.modes.mouseTrackingMode === 'none'
  )
}

/**
 * Creates a wheel event handler for terminal zoom and scroll tracking.
 */
export function createWheelHandler(
  terminal: XTerm,
  fitAddon: FitAddon,
  userScrolledUpRef: MutableRefObject<boolean>,
  resizePty: (id: string, cols: number, rows: number) => void,
  ptyId: string,
  writePty: (id: string, data: string) => void,
  backend?: BackendType
): (e: WheelEvent) => boolean {
  return (e: WheelEvent) => {
    // Ctrl+scroll = zoom font size
    if (e.ctrlKey) {
      e.preventDefault()
      const currentSize = terminal.options.fontSize || DEFAULT_FONT_SIZE
      const delta = e.deltaY > 0 ? -1 : 1
      const newSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, currentSize + delta))
      if (newSize !== currentSize) {
        terminal.options.fontSize = newSize
        localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(newSize))
        // Refit terminal after font size change
        fitAddon.fit()
        const dims = fitAddon.proposeDimensions()
        if (dims && dims.cols > 0 && dims.rows > 0) {
          resizePty(ptyId, dims.cols, dims.rows)
        }
      }
      return false
    }

    // Normal scroll tracking
    if (e.deltaY < 0) {
      userScrolledUpRef.current = true
    } else if (e.deltaY > 0 && isTerminalAtBottom(terminal)) {
      userScrolledUpRef.current = false
    }

    // xterm handles mouse wheel reporting when the foreground app enables
    // mouse tracking. If OpenCode is already in an alternate-screen TUI but
    // tracking is not active, synthesize SGR wheel reports as a narrow fallback.
    if (shouldFallbackToSgrWheel(terminal, backend)) {
      const reportCount = getWheelReportCount(e)
      if (reportCount === 0) return true

      e.preventDefault()
      const { col, row } = getWheelCell(terminal, e)
      const button = e.deltaY < 0 ? 64 : 65
      writePty(ptyId, Array.from({ length: reportCount }, () => `\x1b[<${button};${col};${row}M`).join(''))
      return false
    }

    return true
  }
}

/**
 * Creates a context menu handler for copy/paste operations.
 */
export function createContextMenuHandler(
  terminal: XTerm,
  ptyId: string,
  backend?: BackendType,
  currentLineInputRef?: MutableRefObject<string>
): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    e.preventDefault()
    const selection = terminal.getSelection()
    if (selection) {
      navigator.clipboard.writeText(selection)
    } else {
      handlePaste(terminal, ptyId, backend, currentLineInputRef)
    }
  }
}

/**
 * Creates an auxclick (middle-click) handler for paste operations.
 */
export function createAuxClickHandler(
  terminal: XTerm,
  ptyId: string,
  backend?: BackendType,
  currentLineInputRef?: MutableRefObject<string>
): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault()
      handlePaste(terminal, ptyId, backend, currentLineInputRef)
    }
  }
}

/**
 * Creates a mousedown handler for auto-scrolling behavior.
 */
export function createMouseDownHandler(
  terminal: XTerm,
  userScrolledUpRef: MutableRefObject<boolean>,
  disposedRef: { current: boolean }
): () => void {
  return () => {
    requestAnimationFrame(() => {
      if (disposedRef.current) return
      if (!userScrolledUpRef.current) {
        const before = scrollSnapshot(terminal)
        terminal.scrollToBottom()
        const after = scrollSnapshot(terminal)
        if (before.viewportY !== after.viewportY) {
          scrollDebug('mousedown:scrollToBottom', { before, after })
        }
      }
    })
  }
}

/**
 * Creates a resize handler for the terminal.
 */
export function createResizeHandler(
  terminal: XTerm,
  fitAddon: FitAddon,
  containerRef: MutableRefObject<HTMLDivElement>,
  userScrolledUpRef: MutableRefObject<boolean>,
  resizePty: (id: string, cols: number, rows: number) => void,
  ptyId: string,
  disposedRef: { current: boolean }
): () => void {
  return () => {
    if (disposedRef.current || !containerRef.current) return

    // Inactive-workspace terminals stay mounted in a full-window `inset:0` box
    // (MainApp background terminals), which is far larger than the tile they
    // actually live in. Resizing the PTY to that oversized geometry while hidden
    // reflows the TUI's content taller than the tile, so on return it's pinned to
    // the input line with scrollback wedged. Skip resizes while hidden; the
    // refit-on-active effect re-fits to the real tile size on reactivation.
    if (containerRef.current.checkVisibility && !containerRef.current.checkVisibility()) return

    const resizeRect = containerRef.current.getBoundingClientRect()
    if (resizeRect.width > 50 && resizeRect.height > 50) {
      const wasAtBottom = !userScrolledUpRef.current

      fitAddon.fit()
      const dims = fitAddon.proposeDimensions()
      if (dims && dims.cols > 0 && dims.rows > 0) {
        resizePty(ptyId, dims.cols, dims.rows)
      }

      if (wasAtBottom) {
        requestAnimationFrame(() => {
          if (disposedRef.current) return
          const before = scrollSnapshot(terminal)
          terminal.scrollToBottom()
          const after = scrollSnapshot(terminal)
          if (before.viewportY !== after.viewportY) {
            scrollDebug('resize:scrollToBottom', { before, after })
          }
        })
      }
    }
  }
}

/**
 * Creates a theme update handler for the terminal.
 */
export function createThemeUpdateHandler(
  terminal: XTerm,
  containerRef: MutableRefObject<HTMLDivElement>,
  webglAddonRef: { current: { dispose: () => void } | null }
): (event: Event) => void {
  return (event: Event) => {
    const customEvent = event as CustomEvent
    console.log('[Terminal] theme-update event received, terminal:', true, 'detail:', !!customEvent.detail)
    if (customEvent.detail) {
      terminal.options.theme = customEvent.detail
      // Force viewport background + repaint (WebGL addon workaround)
      const viewport = containerRef.current?.querySelector('.xterm-viewport') as HTMLElement
      if (viewport && customEvent.detail.background) {
        viewport.style.backgroundColor = customEvent.detail.background
      }
      terminal.refresh(0, terminal.rows - 1)
      // Clear WebGL texture atlas if addon is loaded
      if (webglAddonRef.current) {
        try { (webglAddonRef.current as any).clearTextureAtlas?.() } catch { /* ignore */ }
      }
    }
  }
}
