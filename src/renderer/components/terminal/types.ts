import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { Theme } from '../../themes.js'
import type { Api } from '../../api/types.js'

// Window extension for HMR globals
export interface TerminalGlobals {
  __TERMINAL_BUFFERS__?: Map<string, string[]>
  __XTERM_ERROR_HANDLER__?: boolean
}

// Props for the Terminal component
export interface TerminalProps {
  ptyId: string
  isActive: boolean
  theme: Theme
  onFocus?: () => void
  projectPath?: string | null
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
  api?: Api  // API abstraction for PTY operations (uses electronAPI if not provided)
  isMobile?: boolean  // Whether running on mobile (for mobile-specific UI)
  onOpenFileBrowser?: () => void  // Callback to open file browser (mobile only)
}

// Auto work options passed from menu
export interface AutoWorkOptions {
  withContext?: boolean
  askQuestions?: boolean
  pauseForReview?: boolean
  finalEvaluation?: boolean
  gitCommitEachTask?: boolean
}

// Auto work state for the hook
export interface AutoWorkState {
  enabled: boolean
  withSummary: boolean
  askQuestions: boolean
  pauseForReview: boolean
  finalEvaluation: boolean
  gitCommit: boolean
}

// TTS state for the hook
export interface TTSState {
  silentMode: boolean
  spokenContent: Set<string>
  buffer: string
  sessionStartTime: number
}

// Summary capture state
export interface SummaryCaptureState {
  buffer: string
  capturing: boolean
}

// Terminal refs bundle
export interface TerminalRefs {
  terminal: XTerm | null
  fitAddon: FitAddon | null
  container: HTMLDivElement | null
  userScrolledUp: boolean
}
