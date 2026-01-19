import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { Theme } from '../../themes.js'
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

  // Main terminal setup effect
  useEffect(() => {
    if (!containerRef.current) return

    let disposed = false
    let webglAddonRef: { dispose: () => void } | null = null

    // Reset TTS state for this terminal session
    resetTTSState()

    const t = theme.terminal
    const terminal = new XTerm({
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

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)

    // Load WebGL addon after terminal is fully initialized
    if (ENABLE_WEBGL) {
      setTimeout(() => {
        if (disposed) return

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
          if (disposed) return
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

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Initialize buffer
    initBuffer(ptyId)

    // Replay buffered content on mount (for HMR recovery)
    const buffer = getTerminalBuffers().get(ptyId)!
    if (buffer.length > 0) {
      prePopulateSpokenContent(buffer)

      requestAnimationFrame(() => {
        if (disposed) return
        for (const chunk of buffer) {
          terminal.write(chunk)
        }
        terminal.scrollToBottom()
      })
    }

    // Track user scroll
    const wheelHandler = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        userScrolledUpRef.current = true
      } else if (e.deltaY > 0 && isTerminalAtBottom(terminal)) {
        userScrolledUpRef.current = false
      }
    }
    containerRef.current.addEventListener('wheel', wheelHandler, { passive: true })

    const cleanupScroll = terminal.onScroll(() => {
      if (isTerminalAtBottom(terminal)) {
        userScrolledUpRef.current = false
      }
    })

    // Defer fit to next frame
    requestAnimationFrame(() => {
      if (disposed) return
      fitAddon.fit()
    })

    // Batched input handling
    let inputBuffer = ''
    let inputFlushTimeout: ReturnType<typeof setTimeout> | null = null

    const flushInput = () => {
      if (inputBuffer) {
        window.electronAPI.writePty(ptyId, inputBuffer)
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
        handleCopy(terminal)
        return false
      }

      if (event.ctrlKey && !event.shiftKey && (event.key === 'c' || event.key === 'C')) {
        const selection = terminal.getSelection()
        if (selection && selection.length > 0) {
          handleCopy(terminal)
          return false
        }
        return true
      }

      if (event.ctrlKey && (event.key === 'V' || event.key === 'v')) {
        event.preventDefault()
        handlePaste(terminal, ptyId, backend)
        return false
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const seq = event.key === 'ArrowUp' ? '\x1b[A' : '\x1b[B'
        window.electronAPI.writePty(ptyId, seq)
        return false
      }

      return true
    })

    // Context menu and mouse handlers
    const contextmenuHandler = (e: MouseEvent) => {
      e.preventDefault()
      const selection = terminal.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection)
      } else {
        handlePaste(terminal, ptyId, backend)
      }
    }
    containerRef.current.addEventListener('contextmenu', contextmenuHandler)

    const auxclickHandler = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault()
        handlePaste(terminal, ptyId, backend)
      }
    }
    containerRef.current.addEventListener('auxclick', auxclickHandler)

    const mousedownHandler = () => {
      requestAnimationFrame(() => {
        if (disposed) return
        if (!userScrolledUpRef.current) {
          terminal.scrollToBottom()
        }
      })
    }
    containerRef.current.addEventListener('mousedown', mousedownHandler)

    const container = containerRef.current

    // PTY output handling
    let firstData = true
    let scrollDebounceTimeout: ReturnType<typeof setTimeout> | null = null

    const cleanupData = window.electronAPI.onPtyData(ptyId, (data) => {
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

      terminal.write(displayData)

      // Debounced scroll to bottom
      if (!userScrolledUpRef.current) {
        if (scrollDebounceTimeout) {
          clearTimeout(scrollDebounceTimeout)
        }
        scrollDebounceTimeout = setTimeout(() => {
          scrollDebounceTimeout = null
          if (!disposed && !userScrolledUpRef.current) {
            terminal.scrollToBottom()
          }
        }, 32)
      }

      if (firstData) {
        firstData = false
        handleResize()
      }
    })

    // PTY exit handling
    const cleanupExit = window.electronAPI.onPtyExit(ptyId, (code) => {
      terminal.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`)
      addToBuffer(ptyId, `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`)
    })

    // Resize handling
    const handleResize = () => {
      if (disposed || !fitAddonRef.current || !containerRef.current || !terminalRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      if (rect.width > 50 && rect.height > 50) {
        const wasAtBottom = !userScrolledUpRef.current

        fitAddonRef.current.fit()
        const dims = fitAddonRef.current.proposeDimensions()
        if (dims && dims.cols > 0 && dims.rows > 0) {
          window.electronAPI.resizePty(ptyId, dims.cols, dims.rows)
        }

        if (wasAtBottom) {
          requestAnimationFrame(() => {
            if (disposed) return
            terminalRef.current?.scrollToBottom()
          })
        }
      }
    }

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    const debouncedResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(handleResize, 50)
    }

    const resizeObserver = new ResizeObserver(debouncedResize)
    resizeObserver.observe(containerRef.current)

    // Initial resize attempts
    requestAnimationFrame(handleResize)
    setTimeout(handleResize, 100)
    setTimeout(handleResize, 300)
    setTimeout(handleResize, 500)

    // Cleanup
    return () => {
      disposed = true
      cleanupData()
      cleanupExit()
      cleanupScroll.dispose()
      if (resizeTimeout) clearTimeout(resizeTimeout)
      if (inputFlushTimeout) clearTimeout(inputFlushTimeout)
      if (scrollDebounceTimeout) clearTimeout(scrollDebounceTimeout)
      resizeObserver.disconnect()
      container.removeEventListener('wheel', wheelHandler)
      container.removeEventListener('contextmenu', contextmenuHandler)
      container.removeEventListener('auxclick', auxclickHandler)
      container.removeEventListener('mousedown', mousedownHandler)

      if (webglAddonRef) {
        try {
          webglAddonRef.dispose()
        } catch {
          // Ignore disposal errors
        }
        webglAddonRef = null
      }

      try {
        terminal.dispose()
      } catch {
        // Ignore disposal errors
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
