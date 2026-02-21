import type { Terminal as XTerm } from '@xterm/xterm'
import type { MutableRefObject } from 'react'
import { handlePaste, handleCopy } from '../utils.js'

interface InputHandlerState {
  inputBuffer: string
  isComposing: boolean
  inputFlushTimeout: ReturnType<typeof setTimeout> | null
}

/**
 * Sets up IME composition event handlers to prevent duplicate input on mobile.
 * See: https://github.com/xtermjs/xterm.js/issues/3600
 */
export function setupIMEHandlers(
  textarea: HTMLTextAreaElement,
  state: InputHandlerState
): void {
  textarea.addEventListener('compositionstart', () => {
    console.log('[Terminal] IME composition started')
    state.isComposing = true
  })
  textarea.addEventListener('compositionend', () => {
    console.log('[Terminal] IME composition ended')
    // Small delay to let xterm process the final input
    setTimeout(() => {
      state.isComposing = false
    }, 50)
  })
}

/**
 * Creates the terminal data handler for processing user input.
 */
export function createDataHandler(
  writePty: (id: string, data: string) => void,
  ptyId: string,
  onUserInput: (data: string) => void,
  currentLineInputRef: MutableRefObject<string>,
  state: InputHandlerState,
  inputSuppressedRef: MutableRefObject<boolean>
): (data: string) => void {
  const flushInput = () => {
    // Discard buffered input while suppressed (during /clear or /compact button operations)
    if (inputSuppressedRef.current) {
      state.inputBuffer = ''
      state.inputFlushTimeout = null
      return
    }
    if (state.inputBuffer && !state.isComposing) {
      writePty(ptyId, state.inputBuffer)
      state.inputBuffer = ''
    }
    state.inputFlushTimeout = null
  }

  return (data: string) => {
    // Drop all user input while suppressed (during /clear or /compact button operations)
    if (inputSuppressedRef.current) return

    // Notify TTS hook of user input
    onUserInput(data)

    // Ignore terminal control sequences
    if (data.startsWith('\x1b[') && (data.endsWith('R') || data === '\x1b[I' || data === '\x1b[O')) {
      return
    }

    // During IME composition, be more careful with input
    // Only buffer single characters, don't send multi-char bursts that might be composition artifacts
    if (state.isComposing && data.length > 1 && data.charCodeAt(0) >= 32) {
      console.log('[Terminal] Suppressing composition artifact:', data.length, 'chars')
      return
    }

    // Track current line input for /clear and /compact button feature
    for (const char of data) {
      const code = char.charCodeAt(0)
      if (char === '\r' || char === '\n') {
        // Enter pressed - clear the tracked input
        currentLineInputRef.current = ''
      } else if (char === '\x7f' || char === '\b') {
        // Backspace - remove last character
        currentLineInputRef.current = currentLineInputRef.current.slice(0, -1)
      } else if (char === '\x15') {
        // Ctrl+U - clear line (kill to beginning)
        currentLineInputRef.current = ''
      } else if (code >= 32) {
        // Printable character - append to current line
        currentLineInputRef.current += char
      }
    }

    state.inputBuffer += data

    if (data.length === 1 && data.charCodeAt(0) < 32) {
      if (state.inputFlushTimeout) {
        clearTimeout(state.inputFlushTimeout)
      }
      flushInput()
    } else if (!state.inputFlushTimeout) {
      state.inputFlushTimeout = setTimeout(flushInput, 16)
    }
  }
}

/**
 * Creates the custom key event handler for copy/paste shortcuts.
 */
export function createKeyEventHandler(
  terminal: XTerm,
  writePty: (id: string, data: string) => void,
  ptyId: string,
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider',
  currentLineInputRef?: MutableRefObject<string>
): (event: KeyboardEvent) => boolean {
  return (event: KeyboardEvent) => {
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
      handlePaste(terminal, ptyId, backend, currentLineInputRef)
      return false
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const seq = event.key === 'ArrowUp' ? '\x1b[A' : '\x1b[B'
      writePty(ptyId, seq)
      return false
    }

    return true
  }
}

/**
 * Gets the input handler state object.
 */
export function createInputHandlerState(): InputHandlerState {
  return {
    inputBuffer: '',
    isComposing: false,
    inputFlushTimeout: null,
  }
}

/**
 * Cleans up input handler state.
 */
export function cleanupInputHandlerState(state: InputHandlerState): void {
  if (state.inputFlushTimeout) {
    clearTimeout(state.inputFlushTimeout)
    state.inputFlushTimeout = null
  }
}
