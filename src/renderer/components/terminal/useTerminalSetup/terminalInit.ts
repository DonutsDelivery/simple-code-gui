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
  addToBuffer,
  stripAnsi,
  isTerminalAtBottom,
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
  initPending: boolean
  pendingWrites: string[]
  firstData: boolean
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
  console.log('[Terminal] Disabled mobile keyboard features on textarea')
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
    import('@xterm/addon-webgl').then(({ WebglAddon }) => {
      if (state.disposed || !terminal) return
      try {
        const webglAddon = new WebglAddon()
        state.webglAddonRef.current = webglAddon
        webglAddon.onContextLoss(() => {
          state.webglAddonRef.current = null
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
      console.log('Terminal links: enabled (clickable URLs)')
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
    ptyId
  )
  container.addEventListener('wheel', wheelHandler, { passive: false })

  // Scroll tracking
  state.cleanupScroll = terminal.onScroll(() => {
    if (isTerminalAtBottom(terminal)) {
      userScrolledUpRef.current = false
    }
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

  // Key event handler for copy/paste shortcuts
  const keyEventHandler = createKeyEventHandler(
    terminal,
    ptyOperations.writePty,
    ptyId,
    options.backend,
    currentLineInputRef
  )
  terminal.attachCustomKeyEventHandler(keyEventHandler)

  // Return cleanup function
  return () => {
    disposedRef.current = true
    container.removeEventListener('wheel', wheelHandler)
    container.removeEventListener('contextmenu', contextmenuHandler)
    container.removeEventListener('auxclick', auxclickHandler)
    container.removeEventListener('mousedown', mousedownHandler)
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

  // Replay buffered content on mount (for HMR recovery)
  const buffer = getTerminalBuffers().get(ptyId)!
  if (buffer.length > 0) {
    options.prePopulateSpokenContent(buffer)

    requestAnimationFrame(() => {
      if (state.disposed) return
      for (const chunk of buffer) {
        terminal.write(chunk)
      }
      terminal.scrollToBottom()
    })
  }

  // Flush any pending writes that arrived before terminal was ready
  if (state.pendingWrites.length > 0) {
    console.log('[Terminal] Flushing', state.pendingWrites.length, 'pending writes')
    for (const data of state.pendingWrites) {
      terminal.write(data)
    }
    state.pendingWrites.length = 0
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

  // Defer fit to next frame
  requestAnimationFrame(() => {
    if (state.disposed) return
    fitAddon.fit()
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
  console.log('[Terminal] initTerminal called, disposed:', state.disposed, 'terminal:', !!state.terminal, 'initPending:', state.initPending)
  if (state.disposed || state.terminal) return true
  if (state.initPending) return false

  const container = containerRef.current
  if (!container) {
    console.log('[Terminal] No container ref')
    return false
  }

  const offsetW = container.offsetWidth
  const offsetH = container.offsetHeight
  console.log('[Terminal] offset dimensions:', offsetW, 'x', offsetH)
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

  console.log('[Terminal] Container ready (v3), initializing xterm:', Math.round(computedW), 'x', Math.round(computedH))

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
    console.log('[Terminal] Opening terminal with dimensions:', Math.round(finalW), 'x', Math.round(finalH))

    if (finalW < 50 || finalH < 50) {
      console.warn('[Terminal] Dimensions too small after delay, will retry')
      state.initPending = false
      try { newTerminal.dispose() } catch { /* ignore */ }
      return
    }

    try {
      newTerminal.open(container)
      console.log('[Terminal] xterm.open() succeeded')

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
    state.pendingWrites.push(displayData)
    return
  }

  terminal.write(displayData)

  // Debounced scroll to bottom
  if (!userScrolledUpRef.current) {
    if (state.scrollDebounceTimeout) {
      clearTimeout(state.scrollDebounceTimeout)
    }
    state.scrollDebounceTimeout = setTimeout(() => {
      state.scrollDebounceTimeout = null
      if (!state.disposed && !userScrolledUpRef.current && terminal) {
        terminal.scrollToBottom()
      }
    }, 32)
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
  addToBuffer(ptyId, exitMsg)
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
    initPending: false,
    pendingWrites: [],
    firstData: true,
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
