export type HarnessId = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok' | 'claude-codex'
export type HarnessSelection = 'default' | HarnessId

export interface ThemeCustomization {
  accentColor: string | null
  backgroundColor: string | null
  textColor: string | null
  terminalColors: {
    black?: string
    red?: string
    green?: string
    yellow?: string
    blue?: string
    magenta?: string
    cyan?: string
    white?: string
  } | null
}

export interface Settings {
  defaultProjectDir: string
  theme: string
  themeCustomization?: ThemeCustomization | null
  voiceOutputEnabled?: boolean
  voiceVolume?: number
  voiceSpeed?: number
  voiceSkipOnNew?: boolean
  voiceSilenceThreshold?: number
  voicePushToTalk?: boolean
  notificationSoundsEnabled?: boolean
  notificationVolume?: number
  autoAcceptTools?: string[]
  permissionMode?: string
  defaultHarnessId?: HarnessSelection
  /** @deprecated Schema v1 compatibility only. */
  backend?: HarnessSelection
  globalInstructionInjection?: string
  // Headroom context-compression proxy
  headroomEnabled?: boolean
  headroomPort?: number
  headroomProxyPath?: string
}
