// Terminal constants and pre-compiled regex patterns for hot path processing

// Global buffer keys for HMR persistence
export const BUFFER_KEY = '__TERMINAL_BUFFERS__'
export const ERROR_HANDLER_KEY = '__XTERM_ERROR_HANDLER__'

// Buffer limits
export const MAX_BUFFER_CHUNKS = 1000
export const MAX_TTS_BUFFER_SIZE = 2000
export const MAX_SPOKEN_SET_SIZE = 1000
export const MAX_SUMMARY_BUFFER_SIZE = 200000
export const MIN_SUMMARY_LENGTH = 100
export const MIN_SILENT_PERIOD_MS = 3000

// Debug flags
export const DEBUG_SCROLL = false
export const ENABLE_WEBGL = true

// Pre-compiled regex patterns for hot path (PTY data processing)
export const TTS_GUILLEMET_REGEX = /«\/?tts»/g
export const SUMMARY_MARKER_DISPLAY_REGEX = /===SUMMARY_(START|END)===/g
export const TTS_TAG_REGEX = /(?:«tts»|<tts>)([\s\S]*?)(?:«\/tts»|<\/tts>)/g
export const CODE_PATTERN_REGEX = /[{}()\[\];=`$]|^\s*\/\/|^\s*#|function\s|const\s|let\s|var\s/
export const SUMMARY_EXTRACT_REGEX = /===SUMMARY_START===([\s\S]*)===SUMMARY_END===/
export const AUTOWORK_MARKER_REGEX = /===AUTOWORK_CONTINUE===/g

// Terminal configuration
export const TERMINAL_CONFIG = {
  cursorBlink: false,
  fontSize: 14,
  fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
  scrollback: 5000,
  allowProposedApi: true,
  cols: 120,
  rows: 30,
} as const
