import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { MutableRefObject } from 'react'
import {
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  FONT_SIZE_STORAGE_KEY,
} from '../constants.js'
import { handlePaste, isTerminalAtBottom } from '../utils.js'

type BackendType = 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'

/**
 * Creates a wheel event handler for terminal zoom and scroll tracking.
 */
export function createWheelHandler(
  terminal: XTerm,
  fitAddon: FitAddon,
  userScrolledUpRef: MutableRefObject<boolean>,
  resizePty: (id: string, cols: number, rows: number) => void,
  ptyId: string
): (e: WheelEvent) => void {
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
      return
    }
    // Normal scroll tracking
    if (e.deltaY < 0) {
      userScrolledUpRef.current = true
    } else if (e.deltaY > 0 && isTerminalAtBottom(terminal)) {
      userScrolledUpRef.current = false
    }
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
        terminal.scrollToBottom()
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
          terminal.scrollToBottom()
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
