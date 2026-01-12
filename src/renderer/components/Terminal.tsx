import React, { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Theme } from '../themes'
import { useVoice } from '../contexts/VoiceContext'
import { TerminalMenu, AutoWorkOptions } from './TerminalMenu'
import { CustomCommandModal } from './CustomCommandModal'
import { resolveBackendCommand } from '../utils/backendCommands'

// Global buffer to persist terminal data across HMR remounts
// Use window to persist across module re-execution during HMR
const BUFFER_KEY = '__TERMINAL_BUFFERS__'
const MAX_BUFFER_CHUNKS = 1000 // Limit buffer size to prevent memory issues and GC pauses

// Get or create the global buffer map (survives HMR)
function getTerminalBuffers(): Map<string, string[]> {
  if (!(window as any)[BUFFER_KEY]) {
    (window as any)[BUFFER_KEY] = new Map<string, string[]>()
  }
  return (window as any)[BUFFER_KEY]
}

// Clear buffer for a specific terminal (call when tab is closed)
export function clearTerminalBuffer(ptyId: string) {
  getTerminalBuffers().delete(ptyId)
}

// Debug flag - set to true to log scroll events
const DEBUG_SCROLL = false

// Set to false to disable WebGL and use canvas renderer (for debugging)
const ENABLE_WEBGL = true

// Pre-compiled regex patterns for hot path (PTY data processing)
const TTS_GUILLEMET_REGEX = /«\/?tts»/g
const SUMMARY_MARKER_DISPLAY_REGEX = /===SUMMARY_(START|END)===/g
const TTS_TAG_REGEX = /(?:«tts»|<tts>)([\s\S]*?)(?:«\/tts»|<\/tts>)/g
const CODE_PATTERN_REGEX = /[{}()\[\];=`$]|^\s*\/\/|^\s*#|function\s|const\s|let\s|var\s/
const SUMMARY_EXTRACT_REGEX = /===SUMMARY_START===([\s\S]*)===SUMMARY_END===/
const AUTOWORK_MARKER_REGEX = /===AUTOWORK_CONTINUE===/g

// Suppress known xterm WebGL race condition errors
// These errors occur during WebGL addon initialization/disposal but are harmless
if (typeof window !== 'undefined' && !(window as any).__XTERM_ERROR_HANDLER__) {
  (window as any).__XTERM_ERROR_HANDLER__ = true
  window.addEventListener('error', (event) => {
    // Suppress dimensions error during WebGL init (viewport sync before render service ready)
    if (event.message?.includes("Cannot read properties of undefined (reading 'dimensions')") &&
        event.filename?.includes('xterm')) {
      event.preventDefault()
      return true
    }
    // Suppress _isDisposed error during WebGL disposal (race condition during terminal cleanup)
    if (event.message?.includes("Cannot read properties of undefined (reading '_isDisposed')") &&
        event.filename?.includes('xterm')) {
      event.preventDefault()
      return true
    }
  })
}

const formatPathForBackend = (path: string, backend?: string): string => {
  const normalized = backend && backend !== 'default' ? backend : 'claude'
  const escaped = path.includes('"') ? path.replace(/"/g, '\\"') : path
  const safePath = /\s/.test(escaped) ? `"${escaped}"` : escaped

  if (normalized === 'gemini') {
    return `@path ${safePath}`
  }
  if (normalized === 'codex') {
    return `@${safePath}`
  }
  return safePath
}

const formatPathsForBackend = (paths: string[], backend?: string): string =>
  paths.map((path) => formatPathForBackend(path, backend)).join(' ')

// Custom paste handler for xterm - supports text, file paths, and images
async function handlePaste(term: XTerm, ptyId: string, backend?: string) {
  try {
    // First check if clipboard has an image or file (using Electron's native clipboard)
    const imageResult = await window.electronAPI.readClipboardImage()
    if (imageResult.success && imageResult.hasImage && imageResult.path) {
      window.electronAPI.writePty(ptyId, formatPathForBackend(imageResult.path, backend))
      return
    }

    // No image, try to read text
    const text = await navigator.clipboard.readText()
    if (text) {
      // Clean up file:// URIs to plain paths (common on Linux when copying files)
      let cleanText = text
      if (text.startsWith('file://')) {
        cleanText = text.split('\n')
          .map(line => line.trim())
          .filter(line => line.startsWith('file://'))
          .map(line => decodeURIComponent(line.replace('file://', '')))
          .join(' ')
      }
      window.electronAPI.writePty(ptyId, cleanText || text)
    }
  } catch (e) {
    console.error('Paste failed:', e)
  }
}

// Custom copy handler for xterm
function handleCopy(term: XTerm) {
  const selection = term.getSelection()
  if (selection) {
    navigator.clipboard.writeText(selection).catch(e => {
      console.error('Failed to copy:', e)
    })
  }
}

interface TerminalProps {
  ptyId: string
  isActive: boolean
  theme: Theme
  onFocus?: () => void
  projectPath?: string | null
  backend?: string
}

// Strip ANSI escape codes and terminal control sequences from text
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // CSI sequences
    .replace(/\x1b\][^\x07]*\x07/g, '')      // OSC sequences (title, etc)
    .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '') // Private sequences
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '') // String sequences
    .replace(/[\x00-\x1f\x7f]/g, '')          // Control chars
}

// Detect if text is Claude's prose response (not tool output, code, or status)
function isClaudeProseResponse(text: string): boolean {
  const trimmed = text.trim()

  // Skip empty or very short text
  if (trimmed.length < 10) return false

  // Positive signal: ● or • bullet indicates Claude's prose response
  // But skip if it's a tool call like "● Bash(...)" or "● Read(...)"
  const hasBullet = /^[●•]/.test(trimmed)
  if (hasBullet) {
    // Skip tool calls: ● ToolName(...)
    if (/^[●•]\s*(Bash|Read|Write|Edit|Glob|Grep|Task|LSP|WebFetch|WebSearch|Update|NotebookEdit)\s*\(/.test(trimmed)) {
      return false
    }
    // It's prose
    return true
  }

  // WITHOUT a bullet, be very strict - most things are NOT prose

  // Skip anything with box-drawing or UI characters
  if (/[└├│┌┐┘┬┴┼╭╮╯╰⎿]/.test(text)) return false

  // Skip diff/edit output patterns
  if (/Added|removed|lines|line \d|\.tsx?\)|\.jsx?\)/.test(text)) return false

  // Skip Claude Code status bar patterns
  if (/Ideating|Thinking|Working|esc to interrupt|tokens|Reticulating/.test(text)) return false
  if (/Tip:|Model:|Session:|Cost:|Context|Cached:|Total:|Ctx:|In:|Out:/.test(text)) return false
  if (/v\d+\.\d+/.test(text)) return false

  // Skip spinner characters
  if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷·✶]/.test(text)) return false

  // Skip tool indicators
  if (/Read|Write|Edit|Bash|Glob|Grep|Task|LSP|WebFetch|WebSearch|Update|NotebookEdit/.test(text)) return false

  // Skip anything that looks like code
  if (/[{}()\[\];=`]/.test(text)) return false
  if (/^\s*(import|export|const|let|var|function|class|def |if |for |while |return |async |await |\$|>>>|#!|\/\/)/.test(text)) return false

  // Skip file paths and extensions
  if (/\.(ts|tsx|js|jsx|py|rs|go|css|html|json|md|yml|yaml)/.test(text)) return false

  // Skip line numbers
  if (/^\s*\d+\s*[+\-]?\s/.test(text)) return false

  // Must be mostly alphabetic words (natural language)
  const words = trimmed.split(/\s+/)
  const alphaWords = words.filter(w => /^[a-zA-Z]+$/.test(w))
  if (alphaWords.length < words.length * 0.5) return false

  return true
}

export function Terminal({ ptyId, isActive, theme, onFocus, projectPath, backend }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const userScrolledUpRef = useRef(false)

  // Custom command modal state
  const [showCustomCommandModal, setShowCustomCommandModal] = useState(false)

  const handleBackendChange = (newBackend: string) => {
    window.electronAPI.setPtyBackend(ptyId, newBackend)
  }

  // Voice TTS integration
  const { voiceOutputEnabled, speakText } = useVoice()
  const voiceOutputEnabledRef = useRef(voiceOutputEnabled)
  const isActiveRef = useRef(isActive)
  const spokenContentRef = useRef<Set<string>>(new Set())  // Track what we've already spoken
  const silentModeRef = useRef(true)  // Start silent - only speak new content after startup
  const silentModeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ttsBufferRef = useRef('')  // Buffer for accumulating TTS tags across chunks

  // Summary capture for "Summarize & Clear" feature
  const summaryBufferRef = useRef('')
  const capturingSummaryRef = useRef(false)
  const [pendingSummary, setPendingSummary] = useState<string | null>(null)

  // Auto Work Loop feature
  const autoWorkModeRef = useRef(false)
  const autoWorkWithSummaryRef = useRef(false)  // Preserves context via summaries
  const autoWorkAskQuestionsRef = useRef(false)  // Encourages asking questions
  const autoWorkPauseForReviewRef = useRef(false)  // Waits for user input before next task
  const autoWorkFinalEvaluationRef = useRef(false)  // Provides testing instructions when done
  const autoWorkGitCommitRef = useRef(false)  // Git commit after each task
  const [pendingAutoWorkContinue, setPendingAutoWorkContinue] = useState(false)
  const [awaitingUserReview, setAwaitingUserReview] = useState(false)  // Waiting for user to approve

  // Keep refs in sync
  useEffect(() => {
    voiceOutputEnabledRef.current = voiceOutputEnabled
  }, [voiceOutputEnabled])

  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  const sendBackendCommand = (commandId: string) => {
    const backendCommand = resolveBackendCommand(backend, commandId)
    if (!backendCommand) {
      return false
    }
    window.electronAPI.writePty(ptyId, backendCommand)
    setTimeout(() => {
      window.electronAPI.writePty(ptyId, '\r')
    }, 100)
    return true
  }

  // Build autowork prompt based on current options
  const buildAutoWorkPrompt = () => {
    // Build the "no tasks" completion message based on finalEvaluation option
    let noTasksAction = 'commit all changes to git with a summary message and push to remote, then say "All beads tasks complete!" and stop'
    if (autoWorkFinalEvaluationRef.current) {
      noTasksAction = 'commit all changes to git with a summary message and push to remote. Then run "bd list --status=closed" to see all completed tasks from this session. For each completed task, provide: 1) A brief summary of what was implemented, 2) How to test it (specific steps), 3) What to look for to verify it works. Include any potential bugs, edge cases, or issues discovered during implementation. End with a checklist the user can follow to evaluate all the work.'
    }

    let prompt = `Run bd ready to check for tasks. If no tasks are available, ${noTasksAction} Otherwise, analyze ALL available tasks and determine which one should be worked on first - consider: 1) Is this task a prerequisite for other tasks? 2) Does it provide foundation/infrastructure needed by others? 3) Is it simpler and unblocks more complex work? Pick the ONE task that makes the most sense to do first. IMPORTANT: If while working you discover missing prerequisites, dependencies, or required functionality that doesn't exist yet, use "bd create" to add new tasks for them. Complete the task fully, close it with bd close <id>`
    if (autoWorkAskQuestionsRef.current) {
      prompt = `Run bd ready to check for tasks. If no tasks are available, ${noTasksAction} Otherwise, analyze ALL available tasks and determine which one should be worked on first - consider dependencies and logical order. Before starting the chosen task, ask any clarifying questions you have about the requirements. Work on the task, asking questions as needed. IMPORTANT: If you discover missing prerequisites or required functionality, use "bd create" to add new tasks for them. When complete, close it with bd close <id>`
    }
    // Git commit after each task (in addition to final commit)
    if (autoWorkGitCommitRef.current) {
      prompt += '. After closing the task, commit the changes to git with a descriptive message mentioning the task ID (e.g., "Implement feature X [beads-abc]") and push to remote'
    }
    if (autoWorkPauseForReviewRef.current) {
      prompt += ', then say "Task complete. Review the changes and provide feedback, or use Continue to Next Task to proceed."'
    }
    prompt += ' Then output the marker: three equals signs, AUTOWORK_CONTINUE, three equals signs.'
    return prompt
  }

  // Handle pending summary - trigger /clear and paste
  useEffect(() => {
    if (pendingSummary) {
      const summaryToSend = pendingSummary  // Capture value before clearing state
      const shouldContinueAutoWork = autoWorkWithSummaryRef.current  // Check if in autowork-with-summary mode
      console.log('[Summary] useEffect triggered, running /clear, summary length:', summaryToSend.length, 'autowork:', shouldContinueAutoWork)
      const didClear = sendBackendCommand('clear')
      const clearDelay = didClear ? 2000 : 100  // Increased delay, minimum 100ms even without clear
      setTimeout(() => {
        console.log('[Summary] Pasting summary:', summaryToSend.substring(0, 50) + '...')
        // Combine prompt + Enter in single write to avoid race conditions
        window.electronAPI.writePty(ptyId, summaryToSend + '\r')
        // If in autowork-with-summary mode, send the work prompt after summary
        if (shouldContinueAutoWork) {
          setTimeout(() => {
            console.log('[AutoWork+Summary] Sending work prompt after summary')
            const autoworkPrompt = buildAutoWorkPrompt()
            // Combine prompt + Enter in single write
            window.electronAPI.writePty(ptyId, autoworkPrompt + '\r')
          }, 2000)  // Wait longer for summary to be processed
        }
      }, clearDelay)
      setPendingSummary(null)
    }
  }, [pendingSummary, ptyId])

  // Handle auto work continuation - after /clear, send the continuation prompt
  useEffect(() => {
    if (pendingAutoWorkContinue) {
      console.log('[AutoWork] Continuation triggered, running /clear')
      const didClear = sendBackendCommand('clear')
      const clearDelay = didClear ? 2000 : 100  // Increased delay, minimum 100ms
      setTimeout(() => {
        console.log('[AutoWork] Sending continuation prompt')
        const continuePrompt = buildAutoWorkPrompt()
        // Combine prompt + Enter in single write to avoid race conditions
        window.electronAPI.writePty(ptyId, continuePrompt + '\r')
      }, clearDelay)
      setPendingAutoWorkContinue(false)
    }
  }, [pendingAutoWorkContinue, ptyId])

  useEffect(() => {
    if (!containerRef.current) return

    // Track whether terminal is disposed to prevent accessing disposed terminal in async callbacks
    let disposed = false
    // Store reference to WebGL addon for explicit disposal before terminal
    let webglAddonRef: { dispose: () => void } | null = null

    // Reset TTS state for this terminal session
    silentModeRef.current = true
    spokenContentRef.current.clear()
    ttsBufferRef.current = ''

    const t = theme.terminal
    const terminal = new XTerm({
      cursorBlink: false, // Disabled to reduce constant repaints - re-enable if not the cause
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      scrollback: 5000,
      allowProposedApi: true,
      cols: 120,
      rows: 30,
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
        brightWhite: t.brightWhite
      }
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    terminal.open(containerRef.current)

    // Load WebGL addon after terminal is fully initialized
    // Use setTimeout to allow xterm's internal render service to initialize
    if (ENABLE_WEBGL) setTimeout(() => {
      if (disposed) return

      // Ensure terminal has valid dimensions before loading WebGL
      let dims: { cols: number; rows: number } | undefined
      try {
        dims = fitAddon.proposeDimensions()
      } catch {
        // Terminal may be in invalid state
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
          webglAddonRef = webglAddon  // Store reference for cleanup
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

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Initialize buffer for this ptyId if not exists
    const terminalBuffers = getTerminalBuffers()
    if (!terminalBuffers.has(ptyId)) {
      terminalBuffers.set(ptyId, [])
    }

    // Replay buffered content on mount (for HMR recovery)
    // Defer to next frame to ensure terminal viewport is fully initialized
    const buffer = terminalBuffers.get(ptyId)!
    if (buffer.length > 0) {
      // Pre-populate spoken content set from buffered data to prevent re-speaking old content
      for (const chunk of buffer) {
        const cleanChunk = stripAnsi(chunk)
        // Support both «tts»...«/tts» and <tts>...</tts> formats
        const tagRegex = /(?:«tts»|<tts>)([\s\S]*?)(?:«\/tts»|<\/tts>)/g
        let match
        while ((match = tagRegex.exec(cleanChunk)) !== null) {
          const content = match[1].trim()
          if (content.length > 3) {
            spokenContentRef.current.add(content)
          }
        }
      }

      // Write all buffered data to restore terminal state - defer to ensure viewport ready
      requestAnimationFrame(() => {
        if (disposed) return
        for (const chunk of buffer) {
          terminal.write(chunk)
        }
        terminal.scrollToBottom()
      })
    }

    // Silent mode stays on until user types - no timer needed
    // TTS only activates after user sends input to the terminal

    // Helper to check if terminal is at bottom
    const isAtBottom = () => {
      const buffer = terminal.buffer.active
      return buffer.viewportY >= buffer.baseY
    }

    // Track user scroll via wheel - set flag when scrolling up, clear when at bottom
    containerRef.current.addEventListener('wheel', (e) => {
      if (e.deltaY < 0) {
        // Scrolling up
        userScrolledUpRef.current = true
      } else if (e.deltaY > 0 && isAtBottom()) {
        // Scrolling down and reached bottom
        userScrolledUpRef.current = false
      }
    }, { passive: true })

    // Also track scroll events to detect when user scrolls back to bottom
    terminal.onScroll(() => {
      if (isAtBottom()) {
        userScrolledUpRef.current = false
      }
    })

    // Defer fit to next frame when container has dimensions
    requestAnimationFrame(() => {
      if (disposed) return
      fitAddon.fit()
    })

    // Handle terminal input - batch keystrokes to reduce IPC overhead
    // Use a 16ms (one frame) buffer to batch rapid keystrokes
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
      // Ignore terminal control sequences (not real user input):
      // - Cursor position responses: ESC [ row ; col R
      // - Focus in: ESC [ I
      // - Focus out: ESC [ O
      if (data.startsWith('\x1b[') && (data.endsWith('R') || data === '\x1b[I' || data === '\x1b[O')) {
        return // Don't count as user input, don't send to PTY
      }

      // User has typed something - now safe to enable TTS for responses
      // BUT: Ignore Enter and arrow keys - these are used to navigate TOS dialogs
      // that may appear before the chat loads, and shouldn't trigger TTS
      const isEnterKey = data === '\r' || data === '\n'
      const isArrowKey = data === '\x1b[A' || data === '\x1b[B' || data === '\x1b[C' || data === '\x1b[D'
      if (silentModeRef.current && !isEnterKey && !isArrowKey) {
        silentModeRef.current = false
        // Clear TTS buffer to discard any partial tags from session restoration
        // This prevents old messages from being spoken if they complete after user types
        ttsBufferRef.current = ''
      }

      // Buffer the input
      inputBuffer += data

      // Flush immediately for control characters (Enter, Ctrl+C, etc.)
      // These need low latency for responsiveness
      if (data.length === 1 && data.charCodeAt(0) < 32) {
        if (inputFlushTimeout) {
          clearTimeout(inputFlushTimeout)
        }
        flushInput()
      } else if (!inputFlushTimeout) {
        // Schedule flush for regular characters
        inputFlushTimeout = setTimeout(flushInput, 16)
      }
    })

    // Handle copy/paste keyboard shortcuts and prevent arrow key scrolling
    terminal.attachCustomKeyEventHandler((event) => {
      // Only handle keydown events to prevent double-firing
      if (event.type !== 'keydown') return true

      // Ctrl+Shift+C for copy (always)
      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        handleCopy(terminal)
        return false
      }

      // Ctrl+C (without shift): copy if there's a selection, otherwise send SIGINT
      if (event.ctrlKey && !event.shiftKey && (event.key === 'c' || event.key === 'C')) {
        const selection = terminal.getSelection()
        if (selection && selection.length > 0) {
          handleCopy(terminal)
          return false
        }
        // No selection - let it pass through as SIGINT
        return true
      }

      // Ctrl+Shift+V or Ctrl+V for paste
      if (event.ctrlKey && (event.key === 'V' || event.key === 'v')) {
        event.preventDefault()  // Prevent browser's native paste (which would cause duplicate)
        handlePaste(terminal, ptyId, backend)
        return false
      }

      // Prevent arrow keys from scrolling the viewport
      // They still get sent to the PTY via onData for Claude's interactive prompts
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        // Send the escape sequence manually to ensure it reaches PTY
        const seq = event.key === 'ArrowUp' ? '\x1b[A' : '\x1b[B'
        window.electronAPI.writePty(ptyId, seq)
        return false  // Prevent xterm from also handling it (which causes scrolling)
      }

      return true
    })

    // Right-click: copy if selection, else paste (scroll is preserved in handlePaste)
    containerRef.current.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const selection = terminal.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection)
      } else {
        // No selection - paste (handlePaste preserves scroll)
        handlePaste(terminal, ptyId, backend)
      }
    })

    // Middle-click paste (Linux style) - handlePaste preserves scroll
    containerRef.current.addEventListener('auxclick', (e) => {
      if (e.button === 1) {  // Middle button
        e.preventDefault()
        handlePaste(terminal, ptyId, backend)
      }
    })

    // Prevent scroll jump on click - stay at bottom unless user scrolled up
    containerRef.current.addEventListener('mousedown', () => {
      // Restore scroll position after a brief delay (after xterm processes the click)
      requestAnimationFrame(() => {
        if (disposed) return
        if (!userScrolledUpRef.current) {
          terminal.scrollToBottom()
        }
      })
    })


    // Handle PTY output - always scroll to bottom unless user explicitly scrolled up
    let firstData = true
    let scrollPending = false  // Throttle scrollToBottom to once per frame

    const cleanupData = window.electronAPI.onPtyData(ptyId, (data) => {
      // Performance debugging - uncomment to log timing
      // const t0 = performance.now()

      // Store data in buffer for HMR recovery
      const buf = getTerminalBuffers().get(ptyId)
      if (buf) {
        buf.push(data)
        // Limit buffer size to prevent memory bloat
        while (buf.length > MAX_BUFFER_CHUNKS) {
          buf.shift()
        }
      }

      // Only strip «tts» guillemet markers from display (keep <tts> angle brackets visible to show when Claude uses wrong format)
      let displayData = data.replace(TTS_GUILLEMET_REGEX, '').replace(SUMMARY_MARKER_DISPLAY_REGEX, '')

      // TTS: Buffer chunks and extract complete tags (tags may span multiple chunks)
      const cleanChunk = stripAnsi(data)

      ttsBufferRef.current += cleanChunk

      // Extract all complete TTS markers from buffer (support both «tts»...«/tts» and <tts>...</tts>)
      TTS_TAG_REGEX.lastIndex = 0  // Reset stateful regex
      let match
      let lastIndex = 0

      while ((match = TTS_TAG_REGEX.exec(ttsBufferRef.current)) !== null) {
        lastIndex = match.index + match[0].length
        const content = match[1].trim()

        // Skip if content looks like code (has brackets, semicolons, etc.)
        const looksLikeCode = CODE_PATTERN_REGEX.test(content)
        // Skip if content is too short or has weird characters
        const looksLikeProse = content.length > 5 && /^[a-zA-Z]/.test(content) && !looksLikeCode

        if (looksLikeProse && !spokenContentRef.current.has(content)) {
          spokenContentRef.current.add(content)
          // Only speak if: voice enabled, tab active, and not in silent mode (user has typed)
          if (voiceOutputEnabledRef.current && isActiveRef.current && !silentModeRef.current) {
            speakText(content)
          }
          // Before conditions are met, content is tracked but not spoken - prevents reading old/startup messages
        }
      }

      // Keep only the part after the last complete tag (may contain partial tag)
      if (lastIndex > 0) {
        ttsBufferRef.current = ttsBufferRef.current.substring(lastIndex)
      }

      // If buffer has no opening marker (either format), clear it to prevent unbounded growth
      if (!ttsBufferRef.current.includes('«tts') && !ttsBufferRef.current.includes('<tts')) {
        ttsBufferRef.current = ''
      }

      // Limit buffer size to prevent memory issues (keep last 2000 chars if partial tag)
      if (ttsBufferRef.current.length > 2000) {
        ttsBufferRef.current = ttsBufferRef.current.substring(ttsBufferRef.current.length - 2000)
      }

      // Limit spoken set size to prevent memory bloat (keep last 1000 entries)
      if (spokenContentRef.current.size > 1000) {
        const entries = Array.from(spokenContentRef.current)
        spokenContentRef.current = new Set(entries.slice(-500))
      }

      // Summary capture for "Summarize & Clear" feature
      if (capturingSummaryRef.current) {
        summaryBufferRef.current += cleanChunk

        // Check for complete summary markers - use GREEDY match to get from first START to LAST END
        // This avoids issues if the summary content itself mentions the markers
        const summaryMatch = summaryBufferRef.current.match(SUMMARY_EXTRACT_REGEX)
        if (summaryMatch) {
          // Remove any nested markers from the content
          let summary = summaryMatch[1].trim()
          summary = summary.replace(SUMMARY_MARKER_DISPLAY_REGEX, '')

          // Minimum length check - a real summary should be substantial (>100 chars)
          // If too short, Claude might be explaining the format rather than giving the actual summary
          if (summary.length >= 100) {
            // Stop capturing once we have a substantial match
            capturingSummaryRef.current = false
            summaryBufferRef.current = ''
            setPendingSummary(summary)
          }
          // If too short, continue capturing
        }

        // Limit buffer size to prevent unbounded growth (200KB should be plenty)
        if (summaryBufferRef.current.length > 200000) {
          capturingSummaryRef.current = false
          summaryBufferRef.current = ''
        }
      }

      // Auto Work Loop - detect continuation marker
      if (autoWorkModeRef.current && cleanChunk.includes('===AUTOWORK_CONTINUE===')) {
        if (autoWorkPauseForReviewRef.current) {
          // Pause for review: wait for user input before continuing
          setAwaitingUserReview(true)
          // Don't auto-continue - user will trigger continuation manually
        } else if (autoWorkWithSummaryRef.current) {
          // With summaries: trigger summarize flow which will then continue autowork
          summaryBufferRef.current = ''
          capturingSummaryRef.current = true
          // Combine prompt + Enter in single write to avoid race conditions
          window.electronAPI.writePty(ptyId, 'Summarize this session for context recovery. Wrap output in markers: three equals, SUMMARY_START, three equals at start. Three equals, SUMMARY_END, three equals at end.\r')
        } else {
          // Without summaries: just clear and continue
          setPendingAutoWorkContinue(true)
        }
      }

      // Strip autowork marker from display
      displayData = displayData.replace(AUTOWORK_MARKER_REGEX, '')

      terminal.write(displayData)

      // Throttle scrollToBottom to once per animation frame (prevents lag during fast output)
      if (!userScrolledUpRef.current && !scrollPending) {
        scrollPending = true
        requestAnimationFrame(() => {
          scrollPending = false
          if (!disposed && !userScrolledUpRef.current) {
            terminal.scrollToBottom()
          }
        })
      }

      // Resize on first data to ensure PTY has correct dimensions
      if (firstData) {
        firstData = false
        handleResize()
      }
    })

    // Handle PTY exit
    const cleanupExit = window.electronAPI.onPtyExit(ptyId, (code) => {
      terminal.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`)
      // Store exit message in buffer too (in case of HMR during exit)
      const buf = getTerminalBuffers().get(ptyId)
      if (buf) {
        buf.push(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`)
      }
    })

    // Handle resize - stay at bottom unless user scrolled up
    const handleResize = () => {
      if (disposed || !fitAddonRef.current || !containerRef.current || !terminalRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      // Only fit if container is visible and has reasonable dimensions
      if (rect.width > 50 && rect.height > 50) {
        // Check if at bottom BEFORE fit (fit can change scroll position)
        const wasAtBottom = !userScrolledUpRef.current

        fitAddonRef.current.fit()
        const dims = fitAddonRef.current.proposeDimensions()
        if (dims && dims.cols > 0 && dims.rows > 0) {
          window.electronAPI.resizePty(ptyId, dims.cols, dims.rows)
        }

        // Restore scroll position - use requestAnimationFrame to ensure it happens after xterm's internal updates
        if (wasAtBottom) {
          requestAnimationFrame(() => {
            if (disposed) return
            terminalRef.current?.scrollToBottom()
          })
        }
      }
    }

    // Debounce resize to prevent rapid consecutive fits that cause jumping
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    const debouncedResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(handleResize, 50)
    }

    const resizeObserver = new ResizeObserver(debouncedResize)
    resizeObserver.observe(containerRef.current)

    // Initial resize - multiple attempts to ensure correct sizing
    requestAnimationFrame(handleResize)
    setTimeout(handleResize, 100)
    setTimeout(handleResize, 300)
    setTimeout(handleResize, 500)

    return () => {
      disposed = true
      cleanupData()
      cleanupExit()
      if (resizeTimeout) clearTimeout(resizeTimeout)
      if (inputFlushTimeout) clearTimeout(inputFlushTimeout)
      if (silentModeTimeoutRef.current) clearTimeout(silentModeTimeoutRef.current)
      resizeObserver.disconnect()
      // Dispose WebGL addon first to avoid race condition during terminal disposal
      if (webglAddonRef) {
        try {
          webglAddonRef.dispose()
        } catch {
          // Ignore disposal errors - addon may already be partially disposed
        }
        webglAddonRef = null
      }
      // Wrap terminal disposal in try-catch as safety net for any remaining race conditions
      try {
        terminal.dispose()
      } catch {
        // Ignore disposal errors
      }
    }
  }, [ptyId])

  // Refit when tab becomes active - stay at bottom unless user scrolled up
  useEffect(() => {
    if (isActive && fitAddonRef.current && containerRef.current && terminalRef.current) {
      const doFit = () => {
        if (!fitAddonRef.current || !containerRef.current || !terminalRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        if (rect.width > 50 && rect.height > 50) {
          const wasAtBottom = !userScrolledUpRef.current

          fitAddonRef.current.fit()
          const dims = fitAddonRef.current.proposeDimensions()
          if (dims && dims.cols > 0 && dims.rows > 0) {
            window.electronAPI.resizePty(ptyId, dims.cols, dims.rows)
          }
          // Restore scroll position after xterm updates
          if (wasAtBottom) {
            requestAnimationFrame(() => {
              terminalRef.current?.scrollToBottom()
            })
          }
        }
        terminalRef.current?.focus()
      }

      requestAnimationFrame(doFit)
      setTimeout(doFit, 50)
      setTimeout(doFit, 150)
    }
  }, [isActive, ptyId])

  // Update terminal theme when theme changes
  useEffect(() => {
    if (terminalRef.current) {
      const t = theme.terminal
      terminalRef.current.options.theme = {
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
        brightWhite: t.brightWhite
      }
    }
  }, [theme])

  // Handle file drop from file manager only (ignore browser URLs - they crash xterm on KDE)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const paths: string[] = []

    // Try Files array first (KDE Dolphin uses this)
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        try {
          const filePath = window.electronAPI.getPathForFile(files[i])
          if (filePath) {
            paths.push(filePath)
          }
        } catch {
          // getPathForFile not available
        }
      }
    }

    // Fallback: text/uri-list (some file managers use this)
    if (paths.length === 0) {
      const uriList = e.dataTransfer?.getData('text/uri-list')
      if (uriList) {
        uriList.split('\n')
          .map(uri => uri.trim())
          .filter(uri => uri.startsWith('file://'))
          .forEach(uri => {
            paths.push(decodeURIComponent(uri.replace('file://', '')))
          })
      }
    }

    if (paths.length > 0) {
      window.electronAPI.writePty(ptyId, formatPathsForBackend(paths, backend))
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleMenuCommand = (command: string, options?: AutoWorkOptions) => {
    if (sendBackendCommand(command)) {
      return
    }

    switch (command) {
      case 'summarize':
        // Start capture immediately - prompt doesn't have literal markers so won't match
        summaryBufferRef.current = ''
        capturingSummaryRef.current = true
        console.log('[Summary] Capture enabled for ptyId:', ptyId)
        // Prompt describes markers without using them literally
        // Combine prompt + Enter in single write to avoid race conditions
        window.electronAPI.writePty(ptyId, 'Summarize this session for context recovery. Wrap output in markers: three equals, SUMMARY_START, three equals at start. Three equals, SUMMARY_END, three equals at end.\r')
        break
      case 'autowork':
        // Enable auto work mode with options
        autoWorkModeRef.current = true
        autoWorkWithSummaryRef.current = options?.withContext ?? false
        autoWorkAskQuestionsRef.current = options?.askQuestions ?? false
        autoWorkPauseForReviewRef.current = options?.pauseForReview ?? false
        autoWorkFinalEvaluationRef.current = options?.finalEvaluation ?? false
        autoWorkGitCommitRef.current = options?.gitCommitEachTask ?? false
        setAwaitingUserReview(false)
        console.log('[AutoWork] Mode enabled with options:', options)

        {
          const didClear = sendBackendCommand('clear')
          const clearDelay = didClear ? 2000 : 100  // Increased delay, minimum 100ms
          setTimeout(() => {
            console.log('[AutoWork] Sending initial prompt')
            // Combine prompt + Enter in single write to avoid race conditions
            window.electronAPI.writePty(ptyId, buildAutoWorkPrompt() + '\r')
          }, clearDelay)
        }
        break
      case 'continuework':
        // Continue to next task - works whether awaiting review or not
        console.log('[AutoWork] Continue to next task requested, awaitingReview:', awaitingUserReview, 'autoWorkMode:', autoWorkModeRef.current)
        setAwaitingUserReview(false)
        // If autowork mode is active, continue to next task
        if (autoWorkModeRef.current) {
          if (autoWorkWithSummaryRef.current) {
            // With summaries: trigger summarize flow
            summaryBufferRef.current = ''
            capturingSummaryRef.current = true
            // Combine prompt + Enter in single write
            window.electronAPI.writePty(ptyId, 'Summarize this session for context recovery. Wrap output in markers: three equals, SUMMARY_START, three equals at start. Three equals, SUMMARY_END, three equals at end.\r')
          } else {
            // Without summaries: just clear and continue
            setPendingAutoWorkContinue(true)
          }
        } else {
          // Not in autowork mode - start fresh autowork with current options
          console.log('[AutoWork] Not in autowork mode, starting fresh')
          autoWorkModeRef.current = true
          const didClear = sendBackendCommand('clear')
          const clearDelay = didClear ? 2000 : 100
          setTimeout(() => {
            window.electronAPI.writePty(ptyId, buildAutoWorkPrompt() + '\r')
          }, clearDelay)
        }
        break
      case 'stopwork':
        // Gracefully stop auto work loop after current task
        autoWorkModeRef.current = false
        autoWorkWithSummaryRef.current = false
        autoWorkAskQuestionsRef.current = false
        autoWorkPauseForReviewRef.current = false
        autoWorkFinalEvaluationRef.current = false
        autoWorkGitCommitRef.current = false
        setAwaitingUserReview(false)
        console.log('[AutoWork] Mode disabled - will stop after current task')
        // Tell Claude to finish current task but not continue
        // Combine prompt + Enter in single write
        window.electronAPI.writePty(ptyId, 'When you finish the current task, do NOT output the AUTOWORK_CONTINUE marker. Just complete this task and wait for further input.\r')
        break
      case 'cancel':
        // Send Escape to cancel current operation and disable auto work mode
        autoWorkModeRef.current = false
        autoWorkWithSummaryRef.current = false
        autoWorkAskQuestionsRef.current = false
        autoWorkPauseForReviewRef.current = false
        autoWorkFinalEvaluationRef.current = false
        autoWorkGitCommitRef.current = false
        setAwaitingUserReview(false)
        console.log('[AutoWork] Mode disabled by cancel')
        window.electronAPI.writePty(ptyId, '\x1b')
        break
      case 'addcommand':
        // Open custom command modal
        setShowCustomCommandModal(true)
        break
    }
  }

  return (
    <div className="terminal-content-wrapper">
      <div
        ref={containerRef}
        style={{ height: '100%', width: '100%' }}
        onMouseDown={onFocus}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      />
      <TerminalMenu
        ptyId={ptyId}
        onCommand={handleMenuCommand}
        currentBackend={backend || 'claude'}
        onBackendChange={handleBackendChange}
      />
      <CustomCommandModal
        isOpen={showCustomCommandModal}
        onClose={() => setShowCustomCommandModal(false)}
        projectPath={projectPath || null}
      />
    </div>
  )
}
