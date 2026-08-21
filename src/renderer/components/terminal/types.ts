import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { Theme } from '../../themes.js'
import type { Api } from '../../api/types.js'

export type TerminalBackend = 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok'

export function resolveTerminalBackend(tab: { harnessId?: string; backend?: string }): TerminalBackend | undefined {
  const selected = tab.harnessId ?? tab.backend
  if (selected === 'claude-codex') return 'claude'
  const supported: TerminalBackend[] = ['default', 'claude', 'gemini', 'codex', 'opencode', 'aider', 'droid', 'hermes', 'grok']
  return supported.includes(selected as TerminalBackend) ? selected as TerminalBackend : undefined
}

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
  backend?: TerminalBackend
  api?: Api  // API abstraction for PTY operations (uses electronAPI if not provided)
  isMobile?: boolean  // Whether running on mobile (for mobile-specific UI)
  onOpenFileBrowser?: () => void  // Callback to open file browser (mobile only)
  onPtyExit?: (code: number) => void
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
