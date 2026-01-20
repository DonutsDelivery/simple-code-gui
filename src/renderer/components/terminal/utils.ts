import type { Terminal as XTerm } from '@xterm/xterm'
import type { TerminalGlobals } from './types.js'
import { BUFFER_KEY, ERROR_HANDLER_KEY, MAX_BUFFER_CHUNKS } from './constants.js'

// Get or create the global buffer map (survives HMR)
export function getTerminalBuffers(): Map<string, string[]> {
  const win = window as typeof window & TerminalGlobals
  if (!win[BUFFER_KEY]) {
    win[BUFFER_KEY] = new Map<string, string[]>()
  }
  return win[BUFFER_KEY]
}

// Clear buffer for a specific terminal (call when tab is closed)
export function clearTerminalBuffer(ptyId: string): void {
  getTerminalBuffers().delete(ptyId)
}

// Clean up orphaned buffers (for PTY IDs that no longer have active tabs)
export function cleanupOrphanedBuffers(activeIds: string[]): void {
  const buffers = getTerminalBuffers()
  const activeSet = new Set(activeIds)
  for (const id of buffers.keys()) {
    if (!activeSet.has(id)) {
      buffers.delete(id)
    }
  }
}

// Add data to buffer with size limit
export function addToBuffer(ptyId: string, data: string): void {
  const buf = getTerminalBuffers().get(ptyId)
  if (buf) {
    buf.push(data)
    while (buf.length > MAX_BUFFER_CHUNKS) {
      buf.shift()
    }
  }
}

// Initialize buffer for a ptyId
export function initBuffer(ptyId: string): void {
  const buffers = getTerminalBuffers()
  if (!buffers.has(ptyId)) {
    buffers.set(ptyId, [])
  }
}

// Setup xterm error handler (once per window)
export function setupXtermErrorHandler(): void {
  if (typeof window === 'undefined') return

  const win = window as typeof window & TerminalGlobals
  if (win[ERROR_HANDLER_KEY]) return

  win[ERROR_HANDLER_KEY] = true
  window.addEventListener('error', (event) => {
    // Suppress dimensions error during WebGL init
    if (
      event.message?.includes("Cannot read properties of undefined (reading 'dimensions')") &&
      event.filename?.includes('xterm')
    ) {
      event.preventDefault()
      return true
    }
    // Suppress _isDisposed error during WebGL disposal
    if (
      event.message?.includes("Cannot read properties of undefined (reading '_isDisposed')") &&
      event.filename?.includes('xterm')
    ) {
      event.preventDefault()
      return true
    }
  })
}

// Strip ANSI escape codes and terminal control sequences from text
// Preserves spaces by replacing sequences with space (collapsed later)
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ' ')   // CSI sequences -> space
    .replace(/\x1b\][^\x07]*\x07/g, ' ')       // OSC sequences (title, etc) -> space
    .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, ' ')  // Private sequences -> space
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, ' ') // String sequences -> space
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') // Control chars (except tab, newline, CR)
    .replace(/\s+/g, ' ')                      // Collapse multiple whitespace
}

// Detect if text is Claude's prose response (not tool output, code, or status)
export function isClaudeProseResponse(text: string): boolean {
  const trimmed = text.trim()

  // Skip empty or very short text
  if (trimmed.length < 10) return false

  // Positive signal: bullet indicates Claude's prose response
  // But skip if it's a tool call
  const hasBullet = /^[●•]/.test(trimmed)
  if (hasBullet) {
    // Skip tool calls: ToolName(...)
    if (/^[●•]\s*(Bash|Read|Write|Edit|Glob|Grep|Task|LSP|WebFetch|WebSearch|Update|NotebookEdit)\s*\(/.test(trimmed)) {
      return false
    }
    return true
  }

  // WITHOUT a bullet, be very strict

  // Skip box-drawing or UI characters
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

// Format a single path for backend-specific syntax
export function formatPathForBackend(path: string, backend?: string): string {
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

// Format multiple paths for backend
export function formatPathsForBackend(paths: string[], backend?: string): string {
  return paths.map((path) => formatPathForBackend(path, backend)).join(' ')
}

// Custom paste handler for xterm
export async function handlePaste(term: XTerm, ptyId: string, backend?: string): Promise<void> {
  try {
    // Check if clipboard has an image or file
    const imageResult = await window.electronAPI?.readClipboardImage()
    if (imageResult.success && imageResult.hasImage && imageResult.path) {
      window.electronAPI?.writePty(ptyId, formatPathForBackend(imageResult.path, backend))
      return
    }

    // No image, try to read text
    const text = await navigator.clipboard.readText()
    if (text) {
      let cleanText = text
      if (text.startsWith('file://')) {
        cleanText = text.split('\n')
          .map(line => line.trim())
          .filter(line => line.startsWith('file://'))
          .map(line => decodeURIComponent(line.replace('file://', '')))
          .join(' ')
      }
      window.electronAPI?.writePty(ptyId, cleanText || text)
    }
  } catch (e) {
    console.error('Paste failed:', e)
  }
}

// Custom copy handler for xterm
export function handleCopy(term: XTerm): void {
  const selection = term.getSelection()
  if (selection) {
    navigator.clipboard.writeText(selection).catch(e => {
      console.error('Failed to copy:', e)
    })
  }
}

// Check if terminal is at bottom of scroll
export function isTerminalAtBottom(term: XTerm): boolean {
  const buffer = term.buffer.active
  return buffer.viewportY >= buffer.baseY
}
