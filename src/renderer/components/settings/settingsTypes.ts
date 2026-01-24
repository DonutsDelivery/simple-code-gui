import type { Theme } from '../../themes'
type WhisperModelSize = 'tiny.en' | 'base.en' | 'small.en' | 'medium.en' | 'large-v3'

// Whisper models available
export const WHISPER_MODELS: Array<{ value: WhisperModelSize; label: string; desc: string }> = [
  { value: 'tiny.en', label: 'Tiny (75MB)', desc: 'Fastest, basic accuracy' },
  { value: 'base.en', label: 'Base (147MB)', desc: 'Good balance' },
  { value: 'small.en', label: 'Small (488MB)', desc: 'Better accuracy' },
  { value: 'medium.en', label: 'Medium (1.5GB)', desc: 'High accuracy' },
  { value: 'large-v3', label: 'Large (3GB)', desc: 'Best accuracy, multilingual' },
]

// Piper voices available
export const PIPER_VOICES = [
  { value: 'en_US-libritts_r-medium', label: 'LibriTTS-R (US)', desc: 'Natural US English' },
  { value: 'en_GB-jenny_dioco-medium', label: 'Jenny (UK)', desc: 'British English' },
  { value: 'en_US-ryan-medium', label: 'Ryan (US)', desc: 'US English male' },
]

// Common tool patterns for quick selection
export const COMMON_TOOLS = [
  { label: 'Read files', value: 'Read' },
  { label: 'Write files', value: 'Write' },
  { label: 'Edit files', value: 'Edit' },
  { label: 'MultiEdit', value: 'MultiEdit' },
  { label: 'Grep search', value: 'Grep' },
  { label: 'Glob search', value: 'Glob' },
  { label: 'List dirs', value: 'LS' },
  { label: 'Web fetch', value: 'WebFetch' },
  { label: 'Web search', value: 'WebSearch' },
  { label: 'Questions', value: 'AskUserQuestion' },
  { label: 'Task agents', value: 'Task' },
  { label: 'Todo list', value: 'TodoWrite' },
  { label: 'Git commands', value: 'Bash(git:*)' },
  { label: 'npm commands', value: 'Bash(npm:*)' },
  { label: 'All Bash', value: 'Bash' },
]

// Permission modes available in Claude Code
export const PERMISSION_MODES = [
  { label: 'Default', value: 'default', desc: 'Ask for all permissions' },
  { label: 'Accept Edits', value: 'acceptEdits', desc: 'Auto-accept file edits' },
  { label: "Don't Ask", value: 'dontAsk', desc: 'Skip permission prompts' },
  { label: 'Bypass All', value: 'bypassPermissions', desc: 'Skip all permission checks' },
]

export const BACKEND_MODES = [
  { label: 'Default', value: 'default', desc: 'Use the global backend selection' },
  { label: 'Claude', value: 'claude', desc: 'Use Claude for code generation' },
  { label: 'Gemini', value: 'gemini', desc: 'Use Gemini for code generation' },
  { label: 'Codex', value: 'codex', desc: 'Use Codex for code generation' },
  { label: 'OpenCode', value: 'opencode', desc: 'Use OpenCode for code generation' },
  { label: 'Aider', value: 'aider', desc: 'Use Aider AI pair programmer' },
]

// Grouped state interfaces to reduce useState calls
export interface GeneralSettings {
  defaultProjectDir: string
  selectedTheme: string
  autoAcceptTools: string[]
  permissionMode: string
  customTool: string
  backend: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
}

export interface VoiceSettings {
  whisperStatus: { installed: boolean; models: string[]; currentModel: string | null }
  ttsStatus: { installed: boolean; voices: string[]; currentVoice: string | null }
  selectedVoice: string
  selectedEngine: 'piper' | 'xtts'
  ttsSpeed: number
  installedVoices: Array<{ key: string; displayName: string; source: string }>
}

export interface XttsSettings {
  temperature: number
  topK: number
  topP: number
  repetitionPenalty: number
}

export interface UIState {
  installingModel: string | null
  installingVoice: string | null
  showVoiceBrowser: boolean
  playingPreview: string | null
  previewLoading: string | null
  removingTTS: boolean
  ttsRemovalResult: { success: number; failed: number } | null
}

// Default values for grouped state
export const DEFAULT_GENERAL: GeneralSettings = {
  defaultProjectDir: '',
  selectedTheme: 'default',
  autoAcceptTools: [],
  permissionMode: 'default',
  customTool: '',
  backend: 'default'
}

export const DEFAULT_VOICE: VoiceSettings = {
  whisperStatus: { installed: false, models: [], currentModel: null },
  ttsStatus: { installed: false, voices: [], currentVoice: null },
  selectedVoice: 'en_US-libritts_r-medium',
  selectedEngine: 'piper',
  ttsSpeed: 1.0,
  installedVoices: []
}

export const DEFAULT_XTTS: XttsSettings = {
  temperature: 0.65,
  topK: 50,
  topP: 0.85,
  repetitionPenalty: 2.0
}

export const DEFAULT_UI: UIState = {
  installingModel: null,
  installingVoice: null,
  showVoiceBrowser: false,
  playingPreview: null,
  previewLoading: null,
  removingTTS: false,
  ttsRemovalResult: null
}

export type UpdateStatusType = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateStatus {
  status: UpdateStatusType
  version?: string
  progress?: number
  error?: string
}

export interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onThemeChange: (theme: Theme) => void
  onSaved?: (settings: { defaultProjectDir: string; theme: string; autoAcceptTools?: string[]; permissionMode?: string; backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' }) => void
  appVersion?: string
  updateStatus?: UpdateStatus
  onDownloadUpdate?: () => void
  onInstallUpdate?: () => void
}
