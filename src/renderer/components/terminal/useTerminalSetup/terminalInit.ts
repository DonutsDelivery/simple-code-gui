import type { MutableRefObject } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { getLastTerminalTheme } from '../../../themes.js'
import type { Theme } from '../../../themes.js'
import {
  ENABLE_WEBGL,
  TTS_GUILLEMET_REGEX,
  SUMMARY_MARKER_DISPLAY_REGEX,
  AUTOWORK_MARKER_REGEX,
  TERMINAL_CONFIG,
  DEFAULT_FONT_SIZE,
  FONT_SIZE_STORAGE_KEY,
} from '../constants.js'
import {
  getTerminalBuffers,
  initBuffer,
  stripAnsi,
  isTerminalAtBottom,
  scrollDebug,
  scrollSnapshot,
} from '../utils.js'
import {
  createWheelHandler,
  createContextMenuHandler,
  createAuxClickHandler,
  createMouseDownHandler,
  createResizeHandler,
  createThemeUpdateHandler,
} from './eventHandlers.js'
import {
  setupIMEHandlers,
  createDataHandler,
  createKeyEventHandler,
  createInputHandlerState,
  cleanupInputHandlerState,
} from './inputHandlers.js'
import type { PtyOperations, UseTerminalSetupOptions } from './types.js'

interface InitState {
  disposed: boolean
  webglAddonRef: { current: { dispose: () => void } | null }
  terminal: XTerm | null
  fitAddon: FitAddon | null
  cleanupScroll: { dispose: () => void } | null
  resizeObserver: ResizeObserver | null
  resizeTimeout: ReturnType<typeof setTimeout> | null
  scrollDebounceTimeout: ReturnType<typeof setTimeout> | null
  writeCooldownTimeout: ReturnType<typeof setTimeout> | null
  writingData: boolean
  scrollRestorePending: boolean
  scrollRestoreTarget: number
  scrollRestoreBaseY: number
  initPending: boolean
  pendingWrites: string[]
  firstData: boolean
  replayPending: boolean
}

/**
 * Configures mobile keyboard attributes on the terminal's internal textarea.
 */
function configureMobileKeyboard(textarea: HTMLTextAreaElement): void {
  textarea.setAttribute('autocomplete', 'off')
  textarea.setAttribute('autocorrect', 'off')
  textarea.setAttribute('autocapitalize', 'off')
  textarea.setAttribute('spellcheck', 'false')
  textarea.setAttribute('enterkeyhint', 'send')
  textarea.setAttribute('inputmode', 'text')
  textarea.autocomplete = 'off'
  ;(textarea as any).autocorrect = 'off'
  ;(textarea as any).autocapitalize = 'off'
  textarea.spellcheck = false
}

/**
 * Loads the WebGL addon for GPU acceleration.
 */
function loadWebGLAddon(
  terminal: XTerm,
  fitAddon: FitAddon,
  state: InitState
): void {
  if (!ENABLE_WEBGL) return

  setTimeout(() => {
    if (state.disposed || !terminal) return

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

    const forceViewportBackground = () => {
      const vp = terminal.element?.querySelector('.xterm-viewport') as HTMLElement
      if (vp) {
        vp.style.backgroundColor = (terminal.options.theme as any)?.background || '#1e1e2e'
      }
    }

    import('@xterm/addon-webgl').then(({ WebglAddon }) => {
      if (state.disposed || !terminal) return
      try {
        const webglAddon = new WebglAddon()
        state.webglAddonRef.current = webglAddon
        webglAddon.onContextLoss(() => {
          console.warn('Terminal GPU: WebGL context lost, recovering...')
          state.webglAddonRef.current = null
          try { webglAddon.dispose() } catch { /* ignore */ }
          forceViewportBackground()
          terminal.refresh(0, terminal.rows - 1)
          // Try to reload WebGL after a delay
          setTimeout(() => {
            if (state.disposed || !terminal) return
            try {
              const newWebgl = new WebglAddon()
              state.webglAddonRef.current = newWebgl
              newWebgl.onContextLoss(() => {
                console.warn('Terminal GPU: WebGL context lost again, staying on canvas')
                state.webglAddonRef.current = null
                try { newWebgl.dispose() } catch { /* ignore */ }
                forceViewportBackground()
                terminal.refresh(0, terminal.rows - 1)
              })
              terminal.loadAddon(newWebgl)
            } catch {
              console.warn('Terminal GPU: WebGL recovery failed, using canvas')
              forceViewportBackground()
              terminal.refresh(0, terminal.rows - 1)
            }
          }, 1000)
        })
        terminal.loadAddon(webglAddon)
        // Force a full repaint after WebGL loads so all cells render
        // with the correct colors via the GPU pipeline. Without this,
        // previously-written cells may appear grey/inactive.
        forceViewportBackground()
        terminal.refresh(0, terminal.rows - 1)
      } catch (e) {
        console.warn('Terminal GPU acceleration: WebGL failed, using canvas:', e)
        forceViewportBackground()
        terminal.refresh(0, terminal.rows - 1)
      }
    }).catch(e => {
      console.warn('Terminal GPU acceleration: WebGL unavailable, using canvas:', e)
    })
  }, 100)
}

/**
 * Loads the web links addon for clickable URLs.
 */
function loadWebLinksAddon(terminal: XTerm, state: InitState): void {
  import('@xterm/addon-web-links').then(({ WebLinksAddon }) => {
    if (state.disposed) return
    try {
      const webLinksAddon = new WebLinksAddon((_event, uri) => {
        window.electronAPI?.openExternal?.(uri) ?? window.open(uri, '_blank')
      })
      terminal.loadAddon(webLinksAddon)
    } catch (e) {
      console.warn('Terminal links: failed to load addon:', e)
    }
  }).catch(e => {
    console.warn('Terminal links: addon unavailable:', e)
  })
}

/**
 * Sets up event handlers after terminal is opened.
 */
function setupEventHandlers(
  terminal: XTerm,
  fitAddon: FitAddon,
  container: HTMLDivElement,
  containerRef: MutableRefObject<HTMLDivElement>,
  userScrolledUpRef: MutableRefObject<boolean>,
  currentLineInputRef: MutableRefObject<string>,
  inputSuppressedRef: MutableRefObject<boolean>,
  ptyOperations: PtyOperations,
  ptyId: string,
  options: UseTerminalSetupOptions,
  state: InitState
): () => void {
  const disposedRef = { current: false }

  // Wheel handler for zoom and scroll tracking
  const wheelHandler = createWheelHandler(
    terminal,
    fitAddon,
    userScrolledUpRef,
    ptyOperations.resizePty,
    ptyId,
    ptyOperations.writePty,
    options.backend
  )
  terminal.attachCustomWheelEventHandler(wheelHandler)

  // Scroll tracking — DISABLED the onScroll handler for resetting userScrolledUpRef.
  //
  // Why: xterm's onScroll fires during write(), buffer rebuilds (screen clear + redraw),
  // and other programmatic operations. During buffer rebuilds, viewportY == baseY
  // (looks like "at bottom") which falsely resets the flag. The writingData guard
  // can't catch all cases due to async timing between write callbacks and scroll events.
  //
  // Instead, userScrolledUpRef is ONLY reset by:
  // 1. The wheel handler (user scrolls down to bottom)
  // 2. The debounced scroll-to-bottom (when !userScrolledUp, confirms at bottom)
  //
  // The onScroll handler is kept only for debug logging.
  state.cleanupScroll = terminal.onScroll(() => {
    const snap = scrollSnapshot(terminal)
    scrollDebug('onScroll:info', { ...snap, userScrolledUp: userScrolledUpRef.current, writingData: state.writingData })
  })

  // Context menu handler
  const contextmenuHandler = createContextMenuHandler(terminal, ptyId, options.backend, currentLineInputRef)
  container.addEventListener('contextmenu', contextmenuHandler)

  // Middle-click paste
  const auxclickHandler = createAuxClickHandler(terminal, ptyId, options.backend, currentLineInputRef)
  container.addEventListener('auxclick', auxclickHandler)

  // Auto-scroll on mousedown
  const mousedownHandler = createMouseDownHandler(terminal, userScrolledUpRef, disposedRef)
  container.addEventListener('mousedown', mousedownHandler)

  // Resize handling
  const handleResize = createResizeHandler(
    terminal,
    fitAddon,
    containerRef,
    userScrolledUpRef,
    ptyOperations.resizePty,
    ptyId,
    disposedRef
  )

  const debouncedResize = () => {
    if (state.resizeTimeout) clearTimeout(state.resizeTimeout)
    state.resizeTimeout = setTimeout(handleResize, 50)
  }

  state.resizeObserver = new ResizeObserver(debouncedResize)
  state.resizeObserver.observe(container)

  // Initial resize attempts
  requestAnimationFrame(handleResize)
  setTimeout(handleResize, 100)
  setTimeout(handleResize, 300)
  setTimeout(handleResize, 500)

  // Input handlers
  const inputState = createInputHandlerState()
  const textarea = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement
  if (textarea) {
    setupIMEHandlers(textarea, inputState)
  }

  const dataHandler = createDataHandler(
    ptyOperations.writePty,
    ptyId,
    options.onUserInput,
    currentLineInputRef,
    inputState,
    inputSuppressedRef
  )
  terminal.onData(dataHandler)

  terminal.onBinary(data => {
    if (inputSuppressedRef.current) return
    ptyOperations.writePty(ptyId, data)
  })

  // Key event handler for copy/paste shortcuts
  const keyEventHandler = createKeyEventHandler(
    terminal,
    ptyOperations.writePty,
    ptyId,
    options.backend,
    currentLineInputRef
  )
  terminal.attachCustomKeyEventHandler(keyEventHandler)

  // Best-effort auto-copy via onSelectionChange (works for backends that
  // don't enable mouse tracking, unlike opencode which uses OSC 52).
  const _selChangeDisposable = terminal.onSelectionChange(() => {
    const sel = terminal.getSelection()
    if (sel) {
      navigator.clipboard.writeText(sel).catch(() => {})
    }
  })

  // Return cleanup function
  return () => {
    disposedRef.current = true
    terminal.attachCustomWheelEventHandler(() => true)
    container.removeEventListener('contextmenu', contextmenuHandler)
    container.removeEventListener('auxclick', auxclickHandler)
    container.removeEventListener('mousedown', mousedownHandler)
    _selChangeDisposable.dispose()
    cleanupInputHandlerState(inputState)
  }
}

/**
 * Performs post-open terminal setup.
 */
function postOpenSetup(
  terminal: XTerm,
  fitAddon: FitAddon,
  containerRef: MutableRefObject<HTMLDivElement>,
  terminalRef: MutableRefObject<XTerm | null>,
  fitAddonRef: MutableRefObject<FitAddon | null>,
  userScrolledUpRef: MutableRefObject<boolean>,
  currentLineInputRef: MutableRefObject<string>,
  inputSuppressedRef: MutableRefObject<boolean>,
  ptyOperations: PtyOperations,
  ptyId: string,
  options: UseTerminalSetupOptions,
  state: InitState
): void {
  const container = containerRef.current
  if (!container) return

  terminalRef.current = terminal
  fitAddonRef.current = fitAddon

  // Load WebGL addon
  loadWebGLAddon(terminal, fitAddon, state)

  // Initialize buffer
  initBuffer(ptyId)

  // Force viewport background to match theme so gaps between the
  // rendered content and the viewport edge don't show a grey border.
  const syncViewportBackground = () => {
    const vp = container?.querySelector('.xterm-viewport') as HTMLElement
    if (vp) {
      vp.style.backgroundColor = (terminal.options.theme as any)?.background || '#1e1e2e'
    }
  }

  // Replay buffered content on mount (for HMR recovery)
  const buffer = getTerminalBuffers().get(ptyId)!
  if (buffer.length > 0) {
    options.prePopulateSpokenContent(buffer)

    requestAnimationFrame(() => {
      if (state.disposed) return
      for (const chunk of buffer) {
        terminal.write(chunk)
      }
      syncViewportBackground()
      terminal.refresh(0, terminal.rows - 1)
      scrollDebug('bufferReplay:scrollToBottom', scrollSnapshot(terminal))
      terminal.scrollToBottom()
    })
  } else if (window.electronAPI?.getPtyReplay) {
    // No local cache — this is a (re)mount of a live PTY, e.g. after a
    // workspace switch unmounted the terminal and destroyed its scrollback.
    // Restore full history from the main process ReplayBuffer (raw VT bytes,
    // same source the mobile client uses for late attach). Live PTY data is
    // queued in pendingWrites until the replay is written so ordering holds.
    state.replayPending = true
    window.electronAPI.getPtyReplay(ptyId).then((replay: string | null) => {
      if (state.disposed) {
        state.replayPending = false
        return
      }
      if (replay) {
        // Chunks queued before the snapshot are already contained in it.
        state.pendingWrites.length = 0
        options.prePopulateSpokenContent([replay])
        terminal.write(replay)
        syncViewportBackground()
        terminal.refresh(0, terminal.rows - 1)
        scrollDebug('replayBuffer:restored', { bytes: replay.length, ...scrollSnapshot(terminal) })
        terminal.scrollToBottom()
      } else if (state.pendingWrites.length > 0) {
        for (const data of state.pendingWrites) {
          terminal.write(data)
        }
        state.pendingWrites.length = 0
        terminal.scrollToBottom()
      }
      state.replayPending = false
    }).catch(() => {
      state.replayPending = false
    })
  }

  // Flush any pending writes that arrived before terminal was ready
  if (state.pendingWrites.length > 0) {
    for (const data of state.pendingWrites) {
      terminal.write(data)
    }
    state.pendingWrites.length = 0
    syncViewportBackground()
    terminal.refresh(0, terminal.rows - 1)
    scrollDebug('pendingFlush:scrollToBottom', scrollSnapshot(terminal))
    terminal.scrollToBottom()
  }

  // Setup event handlers and store cleanup function
  const cleanupFn = setupEventHandlers(
    terminal,
    fitAddon,
    container,
    containerRef,
    userScrolledUpRef,
    currentLineInputRef,
    inputSuppressedRef,
    ptyOperations,
    ptyId,
    options,
    state
  )
  ;(container as any).__cleanupFn = cleanupFn

  // Defer fit + refresh to next frame (after WebGL has had a chance to load)
  requestAnimationFrame(() => {
    if (state.disposed) return
    fitAddon.fit()
    syncViewportBackground()
    terminal.refresh(0, terminal.rows - 1)
    // Force TUI to redraw by sending a transient SIGWINCH with rows-1 then
    // restoring the correct size. TUIs like Ink (Claude Code) cache terminal
    // dimensions and skip full redraws when SIGWINCH arrives with unchanged
    // dimensions (e.g. after switching back to a workspace whose PTY is idle).
    const dims = fitAddon.proposeDimensions()
    if (dims && dims.cols > 0 && dims.rows > 0) {
      ptyOperations.resizePty(ptyId, dims.cols, Math.max(1, dims.rows - 1))
      requestAnimationFrame(() => {
        if (state.disposed) return
        ptyOperations.resizePty(ptyId, dims.cols, dims.rows)
      })
    }
  })
}

/**
 * Initializes the terminal once container has valid dimensions.
 * Returns true if initialization is complete, false if still pending.
 */
export function initTerminal(
  containerRef: MutableRefObject<HTMLDivElement>,
  terminalRef: MutableRefObject<XTerm | null>,
  fitAddonRef: MutableRefObject<FitAddon | null>,
  userScrolledUpRef: MutableRefObject<boolean>,
  currentLineInputRef: MutableRefObject<string>,
  inputSuppressedRef: MutableRefObject<boolean>,
  theme: Theme,
  ptyOperations: PtyOperations,
  ptyId: string,
  options: UseTerminalSetupOptions,
  state: InitState
): boolean {
  if (state.disposed || state.terminal) return true
  if (state.initPending) return false

  const container = containerRef.current
  if (!container) {
    return false
  }

  const offsetW = container.offsetWidth
  const offsetH = container.offsetHeight
  if (offsetW < 50 || offsetH < 50) {
    return false
  }

  if (!document.body.contains(container)) {
    return false
  }

  const style = getComputedStyle(container)
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false
  }

  const computedW = parseFloat(style.width) || 0
  const computedH = parseFloat(style.height) || 0
  if (computedW < 50 || computedH < 50) {
    return false
  }

  const t = theme.terminal
  const cachedTheme = getLastTerminalTheme()
  const initialTheme = cachedTheme || {
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
  }

  const savedFontSize = localStorage.getItem(FONT_SIZE_STORAGE_KEY)
  const initialFontSize = savedFontSize ? parseInt(savedFontSize, 10) : DEFAULT_FONT_SIZE

  const newTerminal = new XTerm({
    ...TERMINAL_CONFIG,
    fontSize: initialFontSize,
    theme: initialTheme,
  })

  const newFitAddon = new FitAddon()
  newTerminal.loadAddon(newFitAddon)

  state.initPending = true

  setTimeout(() => {
    if (state.disposed) {
      state.initPending = false
      try { newTerminal.dispose() } catch { /* ignore */ }
      return
    }

    if (!document.body.contains(container)) {
      console.warn('[Terminal] Container detached, aborting')
      state.initPending = false
      try { newTerminal.dispose() } catch { /* ignore */ }
      return
    }

    const finalStyle = getComputedStyle(container)
    const finalW = parseFloat(finalStyle.width) || 0
    const finalH = parseFloat(finalStyle.height) || 0

    if (finalW < 50 || finalH < 50) {
      console.warn('[Terminal] Dimensions too small after delay, will retry')
      state.initPending = false
      try { newTerminal.dispose() } catch { /* ignore */ }
      return
    }

    try {
      newTerminal.open(container)

      const textarea = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement
      if (textarea) {
        configureMobileKeyboard(textarea)
      }
    } catch (e) {
      console.warn('[Terminal] xterm.open() failed:', e)
      state.initPending = false
      try { newTerminal.dispose() } catch { /* ignore */ }
      return
    }

    state.terminal = newTerminal
    state.fitAddon = newFitAddon
    state.initPending = false
    terminalRef.current = newTerminal
    fitAddonRef.current = newFitAddon

    // Load web links addon
    loadWebLinksAddon(newTerminal, state)

    // Continue with post-open setup
    postOpenSetup(
      newTerminal,
      newFitAddon,
      containerRef,
      terminalRef,
      fitAddonRef,
      userScrolledUpRef,
      currentLineInputRef,
      inputSuppressedRef,
      ptyOperations,
      ptyId,
      options,
      state
    )
  }, 200)

  return false
}

/**
 * Handles PTY data output.
 */
export function handlePtyData(
  data: string,
  terminal: XTerm | null,
  fitAddon: FitAddon | null,
  containerRef: MutableRefObject<HTMLDivElement>,
  userScrolledUpRef: MutableRefObject<boolean>,
  ptyOperations: PtyOperations,
  ptyId: string,
  onTTSChunk: (chunk: string) => void,
  onSummaryChunk: (chunk: string) => void,
  onAutoWorkMarker: (chunk: string) => void,
  state: InitState
): void {

  // Strip markers from display
  let displayData = data.replace(TTS_GUILLEMET_REGEX, '').replace(SUMMARY_MARKER_DISPLAY_REGEX, '')

  // Handle OSC 52 clipboard escape sequences (used by opencode, tmux, etc.)
  // Format: ESC ] 52 ; <clipboard> ; <base64> BEL|ST
  const osc52Re = /\x1b\]52;([cpqps]);([^\x07\x1b]*)(?:\x07|\x1b\\)/g
  let oscMatch: RegExpExecArray | null
  while ((oscMatch = osc52Re.exec(data)) !== null) {
    const base64Data = oscMatch[2]
    if (base64Data) {
      try {
        const text = atob(base64Data)
        // Use Electron IPC clipboard (reliable without user gesture), fallback to navigator.clipboard
        if (window.electronAPI?.writeClipboardText) {
          window.electronAPI.writeClipboardText(text)
        } else {
          navigator.clipboard.writeText(text).catch(e => console.error('OSC 52 clipboard write failed:', e))
        }
      } catch { /* ignore invalid base64 */ }
    }
  }
  // Strip OSC 52 sequences from display output
  displayData = displayData.replace(osc52Re, '')

  // Process TTS, summary, and autowork
  const cleanChunk = stripAnsi(data)
  onTTSChunk(cleanChunk)
  onSummaryChunk(cleanChunk)
  onAutoWorkMarker(cleanChunk)

  // Strip autowork marker from display
  displayData = displayData.replace(AUTOWORK_MARKER_REGEX, '')

  // Queue writes if terminal not ready yet, or while a history replay is
  // being restored (keeps replay-then-live ordering intact)
  if (!terminal || state.replayPending) {
    state.pendingWrites.push(displayData)
    return
  }

  const preWriteSnap = scrollSnapshot(terminal)

  state.writingData = true
  // Clear any pending cooldown — we're still writing
  if (state.writeCooldownTimeout) {
    clearTimeout(state.writeCooldownTimeout)
    state.writeCooldownTimeout = null
  }
  terminal.write(displayData, () => {
    // Don't immediately clear writingData — keep it true for a cooldown
    // to block onScroll events that fire asynchronously after write completes
    // (e.g., during screen clear + buffer rebuild cycles)
    if (state.writeCooldownTimeout) clearTimeout(state.writeCooldownTimeout)
    state.writeCooldownTimeout = setTimeout(() => {
      state.writeCooldownTimeout = null
      state.writingData = false
    }, 50)
    const postWriteSnap = scrollSnapshot(terminal)

    // Detect screen clear: buffer shrank dramatically (clear + redraw cycle)
    // When user is scrolled up, restore their relative scroll position
    if (userScrolledUpRef.current && preWriteSnap.baseY > 50 && postWriteSnap.baseY < preWriteSnap.baseY * 0.5) {
      // Buffer was cleared and is being rebuilt. Schedule a restore after redraw settles.
      scrollDebug('write:SCREEN_CLEAR_DETECTED', { before: preWriteSnap, after: postWriteSnap })
      if (!state.scrollRestorePending) {
        state.scrollRestorePending = true
        state.scrollRestoreTarget = preWriteSnap.viewportY
        state.scrollRestoreBaseY = preWriteSnap.baseY
        // Wait for the redraw to finish, then restore position
        setTimeout(() => {
          state.scrollRestorePending = false
          if (!state.disposed && terminal && userScrolledUpRef.current) {
            const currentSnap = scrollSnapshot(terminal)
            // Restore to same absolute line, clamped to new buffer size
            const newPos = Math.min(state.scrollRestoreTarget, Math.max(0, currentSnap.baseY - terminal.rows))
            scrollDebug('write:RESTORING_SCROLL', { newPos, currentSnap, originalTarget: state.scrollRestoreTarget, originalBaseY: state.scrollRestoreBaseY })
            terminal.scrollToLine(newPos)
          }
        }, 100)
      }
    }

    if (preWriteSnap.viewportY !== postWriteSnap.viewportY) {
      scrollDebug('write:scrollMoved', { before: preWriteSnap, after: postWriteSnap, userScrolledUp: userScrolledUpRef.current })
    }
  })

  // Debounced scroll to bottom
  if (!userScrolledUpRef.current) {
    if (state.scrollDebounceTimeout) {
      clearTimeout(state.scrollDebounceTimeout)
    }
    state.scrollDebounceTimeout = setTimeout(() => {
      state.scrollDebounceTimeout = null
      if (!state.disposed && !userScrolledUpRef.current && terminal) {
        const beforeSnap = scrollSnapshot(terminal)
        terminal.scrollToBottom()
        const afterSnap = scrollSnapshot(terminal)
        if (beforeSnap.viewportY !== afterSnap.viewportY) {
          scrollDebug('debounce:scrollToBottom', { before: beforeSnap, after: afterSnap })
        }
      }
    }, 32)
  } else {
    scrollDebug('ptyData:skippedScroll', { userScrolledUp: true, ...preWriteSnap, dataLen: displayData.length })
  }

  if (state.firstData) {
    state.firstData = false
    // Trigger resize on first data
    if (fitAddon && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      if (rect.width > 50 && rect.height > 50) {
        fitAddon.fit()
        const dims = fitAddon.proposeDimensions()
        if (dims && dims.cols > 0 && dims.rows > 0) {
          ptyOperations.resizePty(ptyId, dims.cols, dims.rows)
        }
      }
    }
  }
}

/**
 * Handles PTY exit.
 */
export function handlePtyExit(
  code: number,
  terminal: XTerm | null,
  ptyId: string,
  state: InitState
): void {
  const exitMsg = `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`
  if (terminal) {
    terminal.write(exitMsg)
  } else {
    state.pendingWrites.push(exitMsg)
  }
}

/**
 * Creates the initial state for terminal initialization.
 */
export function createInitState(): InitState {
  return {
    disposed: false,
    webglAddonRef: { current: null },
    terminal: null,
    fitAddon: null,
    cleanupScroll: null,
    resizeObserver: null,
    resizeTimeout: null,
    scrollDebounceTimeout: null,
    writeCooldownTimeout: null,
    writingData: false,
    scrollRestorePending: false,
    scrollRestoreTarget: 0,
    scrollRestoreBaseY: 0,
    initPending: false,
    pendingWrites: [],
    firstData: true,
    replayPending: false,
  }
}

/**
 * Cleans up all terminal resources.
 */
export function cleanupTerminal(
  containerRef: MutableRefObject<HTMLDivElement>,
  state: InitState,
  initCheckInterval: ReturnType<typeof setInterval> | null,
  readyCheckInterval: ReturnType<typeof setInterval> | null,
  cleanupData: (() => void) | undefined,
  cleanupExit: (() => void) | undefined
): void {
  state.disposed = true

  if (initCheckInterval) clearInterval(initCheckInterval)
  if (readyCheckInterval) clearInterval(readyCheckInterval)
  cleanupData?.()
  cleanupExit?.()
  state.cleanupScroll?.dispose()
  if (state.resizeTimeout) clearTimeout(state.resizeTimeout)
  if (state.scrollDebounceTimeout) clearTimeout(state.scrollDebounceTimeout)
  if (state.writeCooldownTimeout) clearTimeout(state.writeCooldownTimeout)
  state.resizeObserver?.disconnect()

  // Call stored cleanup function for event listeners
  const cleanupFn = (containerRef.current as any)?.__cleanupFn
  if (cleanupFn) cleanupFn()

  if (state.webglAddonRef.current) {
    try {
      state.webglAddonRef.current.dispose()
    } catch {
      // Ignore disposal errors
    }
    state.webglAddonRef.current = null
  }

  if (state.terminal) {
    try {
      state.terminal.dispose()
    } catch {
      // Ignore disposal errors
    }
  }
}
