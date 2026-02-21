import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { Theme } from '../../themes.js'
import type { Api } from '../../api/types.js'
import {
  ENABLE_WEBGL,
  TTS_GUILLEMET_REGEX,
  SUMMARY_MARKER_DISPLAY_REGEX,
  AUTOWORK_MARKER_REGEX,
  TERMINAL_CONFIG,
} from './constants.js'
import {
  getTerminalBuffers,
  initBuffer,
  addToBuffer,
  setupXtermErrorHandler,
  stripAnsi,
  handlePaste,
  handleCopy,
  isTerminalAtBottom,
} from './utils.js'

// Setup error handler on module load
setupXtermErrorHandler()

interface UseTerminalSetupOptions {
  ptyId: string
  theme: Theme
  backend?: string
  api?: Api  // API abstraction (uses window.electronAPI if not provided)
  onTTSChunk: (cleanChunk: string) => void
  onUserInput: (data: string) => void
  onSummaryChunk: (cleanChunk: string) => void
  onAutoWorkMarker: (cleanChunk: string) => void
  prePopulateSpokenContent: (chunks: string[]) => void
  resetTTSState: () => void
}

interface UseTerminalSetupReturn {
  containerRef: React.RefObject<HTMLDivElement>
  terminalRef: React.RefObject<XTerm | null>
  fitAddonRef: React.RefObject<FitAddon | null>
  userScrolledUpRef: React.RefObject<boolean>
}

/**
 * Hook for setting up and managing the xterm.js terminal instance.
 * Handles terminal creation, PTY communication, WebGL addon, and event handlers.
 */
export function useTerminalSetup({
  ptyId,
  theme,
  backend,
  api,
  onTTSChunk,
  onUserInput,
  onSummaryChunk,
  onAutoWorkMarker,
  prePopulateSpokenContent,
  resetTTSState,
}: UseTerminalSetupOptions): UseTerminalSetupReturn {
  const containerRef = useRef<HTMLDivElement>(null!)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const userScrolledUpRef = useRef(false)

  // PTY operations - use provided API or fall back to window.electronAPI
  const writePty = (id: string, data: string) => {
    if (api) {
      api.writePty(id, data)
    } else {
      window.electronAPI?.writePty(id, data)
    }
  }
  const resizePty = (id: string, cols: number, rows: number) => {
    if (api) {
      api.resizePty(id, cols, rows)
    } else {
      window.electronAPI?.resizePty(id, cols, rows)
    }
  }
  const onPtyData = (id: string, callback: (data: string) => void) => {
    if (api) {
      return api.onPtyData(id, callback)
    } else {
      return window.electronAPI?.onPtyData(id, callback)
    }
  }
  const onPtyExit = (id: string, callback: (code: number) => void) => {
    if (api) {
      return api.onPtyExit(id, callback)
    } else {
      return window.electronAPI?.onPtyExit(id, callback)
    }
  }

  // Main terminal setup effect
  useEffect(() => {
    if (!containerRef.current) return

    let disposed = false
    let webglAddonRef: { dispose: () => void } | null = null
    let terminal: XTerm | null = null
    let fitAddon: FitAddon | null = null
    let cleanupData: (() => void) | undefined
    let cleanupExit: (() => void) | undefined
    let cleanupScroll: { dispose: () => void } | null = null
    let resizeObserver: ResizeObserver | null = null
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    let inputFlushTimeout: ReturnType<typeof setTimeout> | null = null
    let scrollDebounceTimeout: ReturnType<typeof setTimeout> | null = null
    let readyCheckInterval: ReturnType<typeof setInterval> | null = null
    let initCheckInterval: ReturnType<typeof setInterval> | null = null
    let initPending = false  // Track if init is in progress (async)

    // Buffer for data that arrives before terminal is ready
    const pendingWrites: string[] = []

    // Reset TTS state for this terminal session
    resetTTSState()

    const t = theme.terminal

    // Initialize the terminal once container has valid dimensions
    const initTerminal = (): boolean => {
      console.log('[Terminal] initTerminal called, disposed:', disposed, 'terminal:', !!terminal, 'initPending:', initPending)
      if (disposed || terminal) return true // Already initialized or disposed
      if (initPending) return false // Init in progress, keep polling

      const container = containerRef.current
      if (!container) {
        console.log('[Terminal] No container ref')
        return false
      }

      // Check multiple dimension sources - offsetWidth/Height are 0 if not rendered
      const offsetW = container.offsetWidth
      const offsetH = container.offsetHeight
      console.log('[Terminal] offset dimensions:', offsetW, 'x', offsetH)
      if (offsetW < 50 || offsetH < 50) {
        return false // Not ready yet
      }

      // Check element is in DOM and visible
      if (!document.body.contains(container)) {
        return false
      }

      // Check computed style for visibility
      const style = getComputedStyle(container)
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false
      }

      // Check computed dimensions (more reliable than offset*)
      const computedW = parseFloat(style.width) || 0
      const computedH = parseFloat(style.height) || 0
      if (computedW < 50 || computedH < 50) {
        return false
      }

      console.log('[Terminal] Container ready (v3), initializing xterm:', Math.round(computedW), 'x', Math.round(computedH))

      const newTerminal = new XTerm({
        ...TERMINAL_CONFIG,
        theme: {
          background: t.background,
          foreground: t.foreground,
          cursor: t.cursor,
          cursorAccent: t.cursorAccent,
          selectionBackground: t.selection,
          black: t.black,
          red: t.red,
          green: t.green,
          yellow: t.yellow,
          blue: t.blue,
          magenta: t.magenta,
          cyan: t.cyan,
          white: t.white,
          brightBlack: t.brightBlack,
          brightRed: t.brightRed,
          brightGreen: t.brightGreen,
          brightYellow: t.brightYellow,
          brightBlue: t.brightBlue,
          brightMagenta: t.brightMagenta,
          brightCyan: t.brightCyan,
          brightWhite: t.brightWhite,
        },
      })

      const newFitAddon = new FitAddon()
      newTerminal.loadAddon(newFitAddon)

      // Mark init as pending - will complete after delay
      initPending = true

      // Use setTimeout with longer delay to ensure browser has fully rendered
      setTimeout(() => {
        if (disposed) {
          initPending = false
          try { newTerminal.dispose() } catch { /* ignore */ }
          return
        }

        // Re-check that container still has valid dimensions
        if (!document.body.contains(container)) {
          console.warn('[Terminal] Container detached, aborting')
          initPending = false
          try { newTerminal.dispose() } catch { /* ignore */ }
          return
        }

        const finalStyle = getComputedStyle(container)
        const finalW = parseFloat(finalStyle.width) || 0
        const finalH = parseFloat(finalStyle.height) || 0
        console.log('[Terminal] Opening terminal with dimensions:', Math.round(finalW), 'x', Math.round(finalH))

        if (finalW < 50 || finalH < 50) {
          console.warn('[Terminal] Dimensions too small after delay, will retry')
          initPending = false
          try { newTerminal.dispose() } catch { /* ignore */ }
          return
        }

        try {
          newTerminal.open(container)
          console.log('[Terminal] xterm.open() succeeded')
        } catch (e) {
          console.warn('[Terminal] xterm.open() failed:', e)
          initPending = false
          try { newTerminal.dispose() } catch { /* ignore */ }
          return
        }

        terminal = newTerminal
        fitAddon = newFitAddon
        initPending = false  // Init complete
        terminalRef.current = terminal
        fitAddonRef.current = fitAddon

        // Continue with post-open setup
        postOpenSetup()
      }, 200)  // 200ms delay to let browser fully render

      return false // Not done yet, keep polling until terminal is set
    }

    // Post-open setup (separated to run after requestAnimationFrame)
    const postOpenSetup = () => {
      if (!terminal || !fitAddon || !containerRef.current) return

      terminalRef.current = terminal
      fitAddonRef.current = fitAddon

      // Load WebGL addon after terminal is fully initialized
      if (ENABLE_WEBGL) {
        setTimeout(() => {
          if (disposed || !fitAddon || !terminal) return

          let dims: { cols: number; rows: number } | undefined
          try {
            dims = fitAddon.proposeDimensions()
          } catch {
            return
          }
          if (!dims || dims.cols <= 0 || dims.rows <= 0) {
            console.warn('Terminal GPU acceleration: skipped (no dimensions)')
            return
          }

          fitAddon.fit()
          import('@xterm/addon-webgl').then(({ WebglAddon }) => {
            if (disposed || !terminal) return
            try {
              const webglAddon = new WebglAddon()
              webglAddonRef = webglAddon
              webglAddon.onContextLoss(() => {
                webglAddonRef = null
                webglAddon.dispose()
              })
              terminal.loadAddon(webglAddon)
              console.log('Terminal GPU acceleration: WebGL enabled')
            } catch (e) {
              console.warn('Terminal GPU acceleration: WebGL failed, using canvas:', e)
            }
          }).catch(e => {
            console.warn('Terminal GPU acceleration: WebGL unavailable, using canvas:', e)
          })
        }, 100)
      }

      // Initialize buffer
      initBuffer(ptyId)

      // Replay buffered content on mount (for HMR recovery)
      const buffer = getTerminalBuffers().get(ptyId)!
      if (buffer.length > 0) {
        prePopulateSpokenContent(buffer)

        requestAnimationFrame(() => {
          if (disposed || !terminal) return
          for (const chunk of buffer) {
            terminal.write(chunk)
          }
          terminal.scrollToBottom()
        })
      }

      // Flush any pending writes that arrived before terminal was ready
      if (pendingWrites.length > 0) {
        console.log('[Terminal] Flushing', pendingWrites.length, 'pending writes')
        for (const data of pendingWrites) {
          terminal.write(data)
        }
        pendingWrites.length = 0
        terminal.scrollToBottom()
      }

      // Track user scroll
      const wheelHandler = (e: WheelEvent) => {
        if (e.deltaY < 0) {
          userScrolledUpRef.current = true
        } else if (e.deltaY > 0 && terminal && isTerminalAtBottom(terminal)) {
          userScrolledUpRef.current = false
        }
      }
      containerRef.current!.addEventListener('wheel', wheelHandler, { passive: true })

      cleanupScroll = terminal.onScroll(() => {
        if (terminal && isTerminalAtBottom(terminal)) {
          userScrolledUpRef.current = false
        }
      })

      // Defer fit to next frame
      requestAnimationFrame(() => {
        if (disposed || !fitAddon) return
        fitAddon.fit()
      })

      // Batched input handling
      let inputBuffer = ''

      const flushInput = () => {
        if (inputBuffer) {
          writePty(ptyId, inputBuffer)
          inputBuffer = ''
        }
        inputFlushTimeout = null
      }

      terminal.onData((data) => {
        // Notify TTS hook of user input
        onUserInput(data)

        // Ignore terminal control sequences
        if (data.startsWith('\x1b[') && (data.endsWith('R') || data === '\x1b[I' || data === '\x1b[O')) {
          return
        }

        inputBuffer += data

        if (data.length === 1 && data.charCodeAt(0) < 32) {
          if (inputFlushTimeout) {
            clearTimeout(inputFlushTimeout)
          }
          flushInput()
        } else if (!inputFlushTimeout) {
          inputFlushTimeout = setTimeout(flushInput, 16)
        }
      })

      // Copy/paste keyboard shortcuts
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true

        if (event.ctrlKey && event.shiftKey && event.key === 'C') {
          if (terminal) handleCopy(terminal)
          return false
        }

        if (event.ctrlKey && !event.shiftKey && (event.key === 'c' || event.key === 'C')) {
          const selection = terminal?.getSelection()
          if (selection && selection.length > 0) {
            if (terminal) handleCopy(terminal)
            return false
          }
          return true
        }

        if (event.ctrlKey && (event.key === 'V' || event.key === 'v')) {
          event.preventDefault()
          if (terminal) handlePaste(terminal, ptyId, backend)
          return false
        }

        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const seq = event.key === 'ArrowUp' ? '\x1b[A' : '\x1b[B'
          writePty(ptyId, seq)
          return false
        }

        return true
      })

      // Context menu and mouse handlers
      const contextmenuHandler = (e: MouseEvent) => {
        e.preventDefault()
        const selection = terminal?.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
        } else if (terminal) {
          handlePaste(terminal, ptyId, backend)
        }
      }
      containerRef.current!.addEventListener('contextmenu', contextmenuHandler)

      const auxclickHandler = (e: MouseEvent) => {
        if (e.button === 1) {
          e.preventDefault()
          if (terminal) handlePaste(terminal, ptyId, backend)
        }
      }
      containerRef.current!.addEventListener('auxclick', auxclickHandler)

      const mousedownHandler = () => {
        requestAnimationFrame(() => {
          if (disposed || !terminal) return
          if (!userScrolledUpRef.current) {
            terminal.scrollToBottom()
          }
        })
      }
      containerRef.current!.addEventListener('mousedown', mousedownHandler)

      const container = containerRef.current!

      // Resize handling
      const handleResize = () => {
        if (disposed || !fitAddon || !containerRef.current || !terminal) return

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
              if (disposed || !terminal) return
              terminal.scrollToBottom()
            })
          }
        }
      }

      const debouncedResize = () => {
        if (resizeTimeout) clearTimeout(resizeTimeout)
        resizeTimeout = setTimeout(handleResize, 50)
      }

      resizeObserver = new ResizeObserver(debouncedResize)
      resizeObserver.observe(containerRef.current!)

      // Initial resize attempts
      requestAnimationFrame(handleResize)
      setTimeout(handleResize, 100)
      setTimeout(handleResize, 300)
      setTimeout(handleResize, 500)

      // Store cleanup references for event listeners
      const cleanupFn = () => {
        container.removeEventListener('wheel', wheelHandler)
        container.removeEventListener('contextmenu', contextmenuHandler)
        container.removeEventListener('auxclick', auxclickHandler)
        container.removeEventListener('mousedown', mousedownHandler)
      }
      // Store as side effect for cleanup
      ;(containerRef.current as any).__cleanupFn = cleanupFn

      return true // Successfully initialized
    }

    // PTY output handling - buffer data until terminal is ready
    let firstData = true

    cleanupData = onPtyData(ptyId, (data) => {
      addToBuffer(ptyId, data)

      // Strip markers from display
      let displayData = data.replace(TTS_GUILLEMET_REGEX, '').replace(SUMMARY_MARKER_DISPLAY_REGEX, '')

      // Process TTS, summary, and autowork
      const cleanChunk = stripAnsi(data)
      onTTSChunk(cleanChunk)
      onSummaryChunk(cleanChunk)
      onAutoWorkMarker(cleanChunk)

      // Strip autowork marker from display
      displayData = displayData.replace(AUTOWORK_MARKER_REGEX, '')

      // Queue writes if terminal not ready yet
      if (!terminal) {
        pendingWrites.push(displayData)
        return
      }

      terminal.write(displayData)

      // Debounced scroll to bottom
      if (!userScrolledUpRef.current) {
        if (scrollDebounceTimeout) {
          clearTimeout(scrollDebounceTimeout)
        }
        scrollDebounceTimeout = setTimeout(() => {
          scrollDebounceTimeout = null
          if (!disposed && !userScrolledUpRef.current && terminal) {
            terminal.scrollToBottom()
          }
        }, 32)
      }

      if (firstData) {
        firstData = false
        // Trigger resize on first data
        if (fitAddon && containerRef.current && terminal) {
          const rect = containerRef.current.getBoundingClientRect()
          if (rect.width > 50 && rect.height > 50) {
            fitAddon.fit()
            const dims = fitAddon.proposeDimensions()
            if (dims && dims.cols > 0 && dims.rows > 0) {
              resizePty(ptyId, dims.cols, dims.rows)
            }
          }
        }
      }
    })

    // PTY exit handling
    cleanupExit = onPtyExit(ptyId, (code) => {
      const exitMsg = `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`
      if (terminal) {
        terminal.write(exitMsg)
      } else {
        pendingWrites.push(exitMsg)
      }
      addToBuffer(ptyId, exitMsg)
    })

    // Try to initialize terminal immediately, or poll until ready
    if (!initTerminal()) {
      initCheckInterval = setInterval(() => {
        if (initTerminal()) {
          clearInterval(initCheckInterval!)
          initCheckInterval = null
        }
      }, 50)
    }

    // Cleanup
    return () => {
      disposed = true
      if (initCheckInterval) clearInterval(initCheckInterval)
      if (readyCheckInterval) clearInterval(readyCheckInterval)
      cleanupData?.()
      cleanupExit?.()
      cleanupScroll?.dispose()
      if (resizeTimeout) clearTimeout(resizeTimeout)
      if (inputFlushTimeout) clearTimeout(inputFlushTimeout)
      if (scrollDebounceTimeout) clearTimeout(scrollDebounceTimeout)
      resizeObserver?.disconnect()

      // Call stored cleanup function for event listeners
      const cleanupFn = (containerRef.current as any)?.__cleanupFn
      if (cleanupFn) cleanupFn()

      if (webglAddonRef) {
        try {
          webglAddonRef.dispose()
        } catch {
          // Ignore disposal errors
        }
        webglAddonRef = null
      }

      if (terminal) {
        try {
          terminal.dispose()
        } catch {
          // Ignore disposal errors
        }
      }
    }
  }, [ptyId])

  return {
    containerRef,
    terminalRef,
    fitAddonRef,
    userScrolledUpRef,
  }
}
