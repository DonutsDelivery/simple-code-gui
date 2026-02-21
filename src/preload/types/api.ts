import type { Settings } from './settings.js'
import type { Workspace, Session } from './workspace.js'
import type { BeadsTask, BeadsCloseResult } from './beads.js'
import type { VoiceSettings } from './voice.js'
import type { Extension } from './extension.js'

export interface ElectronAPI {
  // Workspace
  getWorkspace: () => Promise<Workspace>
  saveWorkspace: (workspace: Workspace) => Promise<void>
  addProject: () => Promise<string | null>
  addProjectsFromParent: () => Promise<Array<{ path: string; name: string }> | null>
  getMetaProjectsPath: () => Promise<string>
  getCategoryMetaPath: (categoryName: string) => Promise<string>

  // Sessions
  discoverSessions: (projectPath: string, backend?: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider') => Promise<Session[]>

  // Settings
  getSettings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<void>
  selectDirectory: () => Promise<string | null>

  // Project creation
  createProject: (name: string, parentDir: string) => Promise<{ success: boolean; path?: string; error?: string }>

  // Executable
  selectExecutable: () => Promise<string | null>
  runExecutable: (executable: string, cwd: string) => Promise<{ success: boolean; error?: string }>

  // Claude Code & Node.js & Python & Git
  claudeCheck: () => Promise<{ installed: boolean; npmInstalled: boolean; gitBashInstalled: boolean }>
  claudeInstall: () => Promise<{ success: boolean; error?: string; needsNode?: boolean }>
  nodeInstall: () => Promise<{ success: boolean; error?: string; method?: string; message?: string }>
  gitInstall: () => Promise<{ success: boolean; error?: string; method?: string; message?: string }>
  pythonInstall: () => Promise<{ success: boolean; error?: string; method?: string }>
  onInstallProgress: (callback: (data: { type: string; status: string; percent?: number }) => void) => () => void

  // Gemini CLI
  geminiCheck: () => Promise<{ installed: boolean; npmInstalled: boolean }>
  geminiInstall: () => Promise<{ success: boolean; error?: string; needsNode?: boolean }>

  // Codex CLI
  codexCheck: () => Promise<{ installed: boolean; npmInstalled: boolean }>
  codexInstall: () => Promise<{ success: boolean; error?: string; needsNode?: boolean }>

  // OpenCode CLI
  opencodeCheck: () => Promise<{ installed: boolean; npmInstalled: boolean }>
  opencodeInstall: () => Promise<{ success: boolean; error?: string; needsNode?: boolean }>

  // Aider CLI
  aiderCheck: () => Promise<{ installed: boolean; pipInstalled: boolean }>
  aiderInstall: () => Promise<{ success: boolean; error?: string; needsPython?: boolean }>

  // Get Shit Done (GSD) - Claude Code workflow addon
  gsdCheck: () => Promise<{ installed: boolean; npmInstalled: boolean }>
  gsdInstall: () => Promise<{ success: boolean; error?: string }>
  gsdProjectCheck: (cwd: string) => Promise<{ initialized: boolean }>
  gsdGetProgress: (cwd: string) => Promise<{
    success: boolean
    data?: {
      initialized: boolean
      currentPhase: string | null
      currentPhaseNumber: number | null
      totalPhases: number
      completedPhases: number
      phases: Array<{ number: number; title: string; completed: boolean }>
    }
    error?: string
  }>

  // Beads
  beadsCheck: (cwd: string) => Promise<{ installed: boolean; initialized: boolean }>
  beadsInit: (cwd: string) => Promise<{ success: boolean; error?: string }>
  beadsInstall: () => Promise<{ success: boolean; error?: string; method?: string; needsPython?: boolean }>
  beadsReady: (cwd: string) => Promise<{ success: boolean; tasks?: BeadsTask[]; error?: string }>
  beadsList: (cwd: string) => Promise<{ success: boolean; tasks?: BeadsTask[]; error?: string }>
  beadsShow: (cwd: string, taskId: string) => Promise<{ success: boolean; task?: BeadsTask; error?: string }>
  beadsCreate: (cwd: string, title: string, description?: string, priority?: number, type?: string, labels?: string) => Promise<{ success: boolean; task?: BeadsTask; error?: string }>
  beadsComplete: (cwd: string, taskId: string) => Promise<{ success: boolean; result?: BeadsCloseResult; error?: string }>
  beadsDelete: (cwd: string, taskId: string) => Promise<{ success: boolean; error?: string }>
  beadsStart: (cwd: string, taskId: string) => Promise<{ success: boolean; error?: string }>
  beadsUpdate: (cwd: string, taskId: string, status?: string, title?: string, description?: string, priority?: number) => Promise<{ success: boolean; error?: string }>
  beadsWatch: (cwd: string) => Promise<{ success: boolean; error?: string }>
  beadsUnwatch: (cwd: string) => Promise<{ success: boolean; error?: string }>
  onBeadsTasksChanged: (callback: (data: { cwd: string }) => void) => () => void

  // TTS instructions (CLAUDE.md)
  ttsInstallInstructions: (projectPath: string) => Promise<{ success: boolean }>
  ttsRemoveInstructions: (projectPath: string) => Promise<{ success: boolean }>

  // Voice (STT/TTS)
  voiceCheckWhisper: () => Promise<{ installed: boolean; models: string[]; currentModel: string | null }>
  voiceInstallWhisper: (model: string) => Promise<{ success: boolean; error?: string }>
  voiceTranscribe: (pcmData: Float32Array) => Promise<{ success: boolean; text?: string; error?: string }>
  voiceSetWhisperModel: (model: string) => Promise<{ success: boolean }>
  voiceCheckTTS: () => Promise<{ installed: boolean; engine: string | null; voices: string[]; currentVoice: string | null }>
  voiceGetFullStatus: () => Promise<{
    whisper: { installed: boolean; models: string[]; currentModel: string | null }
    tts: { installed: boolean; engine: string | null; voices: string[]; currentVoice: string | null }
  }>
  voiceInstallPiper: () => Promise<{ success: boolean; error?: string }>
  voiceInstallVoice: (voice: string) => Promise<{ success: boolean; error?: string }>
  voiceSpeak: (text: string) => Promise<{ success: boolean; audioData?: string; error?: string }>
  voiceStopSpeaking: () => Promise<{ success: boolean }>
  voiceGetVoices: () => Promise<{ installed: string[]; all: Array<{ id: string; description: string; license: string; installed: boolean }> }>
  voiceGetWhisperModels: () => Promise<{ installed: string[]; all: Array<{ id: string; size: number; installed: boolean }> }>
  voiceSetVoice: (voice: string | { voice: string; engine: 'piper' | 'xtts' }) => Promise<{ success: boolean }>
  voiceGetSettings: () => Promise<VoiceSettings>
  voiceApplySettings: (settings: Partial<VoiceSettings>) => Promise<{ success: boolean }>

  // Voice catalog (browse & download from Hugging Face)
  voiceFetchCatalog: (forceRefresh?: boolean) => Promise<Array<{
    key: string
    name: string
    language: { code: string; name_english: string; country_english: string }
    quality: string
    num_speakers: number
    files: Record<string, { size_bytes: number }>
  }>>
  voiceDownloadFromCatalog: (voiceKey: string) => Promise<{ success: boolean; error?: string }>
  voiceGetInstalled: () => Promise<Array<{
    key: string
    displayName: string
    source: 'builtin' | 'downloaded' | 'custom'
    quality?: string
    language?: string
  }>>
  voiceImportCustom: () => Promise<{ success: boolean; voiceKey?: string; error?: string }>
  voiceRemoveCustom: (voiceKey: string) => Promise<{ success: boolean; error?: string }>
  voiceOpenCustomFolder: () => Promise<void>

  // XTTS (voice cloning)
  xttsCheck: () => Promise<{ installed: boolean; pythonPath: string | null; modelDownloaded: boolean; error?: string }>
  xttsInstall: () => Promise<{ success: boolean; error?: string }>
  xttsCreateVoice: (audioPath: string, name: string, language: string) => Promise<{ success: boolean; voiceId?: string; error?: string }>
  xttsGetVoices: () => Promise<Array<{ id: string; name: string; language: string; createdAt: number }>>
  xttsDeleteVoice: (voiceId: string) => Promise<{ success: boolean; error?: string }>
  xttsSpeak: (text: string, voiceId: string, language?: string) => Promise<{ success: boolean; audioData?: string; error?: string }>
  xttsSelectAudio: () => Promise<{ success: boolean; path?: string; error?: string }>
  xttsGetLanguages: () => Promise<Array<{ code: string; name: string }>>
  xttsGetSampleVoices: () => Promise<Array<{ id: string; name: string; language: string; file: string; installed: boolean }>>
  xttsDownloadSampleVoice: (sampleId: string) => Promise<{ success: boolean; voiceId?: string; error?: string }>
  xttsSelectMediaFile: () => Promise<{ success: boolean; path?: string; duration?: number; error?: string }>
  xttsGetMediaDuration: (filePath: string) => Promise<{ success: boolean; duration?: number; error?: string }>
  xttsExtractAudioClip: (inputPath: string, startTime: number, endTime: number) => Promise<{ success: boolean; outputPath?: string; dataUrl?: string; error?: string }>

  // PTY
  spawnPty: (cwd: string, sessionId?: string, model?: string, backend?: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider') => Promise<string>
  writePty: (id: string, data: string) => void
  resizePty: (id: string, cols: number, rows: number) => void
  killPty: (id: string) => void
  setPtyBackend: (id: string, backend: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider') => Promise<void>
  onPtyData: (id: string, callback: (data: string) => void) => () => void
  onPtyExit: (id: string, callback: (code: number) => void) => () => void
  onPtyRecreated: (callback: (data: { oldId: string; newId: string; backend: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' }) => void) => () => void

  // API Server
  apiStart: (projectPath: string, port: number) => Promise<{ success: boolean; error?: string }>
  apiStop: (projectPath: string) => Promise<{ success: boolean }>
  apiStatus: (projectPath: string) => Promise<{ running: boolean; port?: number }>
  onApiOpenSession: (callback: (data: { projectPath: string; autoClose: boolean; model?: string }) => void) => () => void

  // Mobile Server (for phone app connectivity)
  mobileGetConnectionInfo: () => Promise<{
    url: string
    token: string
    port: number
    ips: string[]
    fingerprint: string
    formattedFingerprint: string
    nonce: string
    nonceExpires: number
    qrData: string
  }>
  mobileRegenerateToken: () => Promise<{
    token: string
    url: string
    port: number
    ips: string[]
    fingerprint: string
    formattedFingerprint: string
    nonce: string
    nonceExpires: number
    qrData: string
  }>
  mobileIsRunning: () => Promise<boolean>
  mobileSendFile: (filePath: string, message?: string) => Promise<{ success: boolean; fileId?: string; error?: string }>
  mobileGetConnectedClients: () => Promise<number>
  mobileGetPendingFiles: () => Promise<Array<{
    id: string
    name: string
    path: string
    size: number
    mimeType: string
    createdAt: number
    expiresAt: number
    message?: string
  }>>

  // Updater
  getVersion: () => Promise<string>
  checkForUpdate: () => Promise<{ success: boolean; version?: string; error?: string }>
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => void
  onUpdaterStatus: (callback: (data: { status: string; version?: string; progress?: number; error?: string }) => void) => () => void

  // Clipboard
  readClipboardImage: () => Promise<{ success: boolean; hasImage?: boolean; path?: string; error?: string }>

  // File utilities
  getPathForFile: (file: File) => string

  // Window controls
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
  windowIsMaximized: () => Promise<boolean>

  // Debug logging
  debugLog: (message: string) => void

  // App utilities
  isDebugMode: () => Promise<boolean>
  refresh: () => Promise<void>
  openExternal: (url: string) => Promise<void>

  // Custom commands
  commandsSave: (name: string, content: string, projectPath: string | null) => Promise<{ success: boolean; path?: string; error?: string }>

  // CLAUDE.md editor
  claudeMdRead: (projectPath: string) => Promise<{ success: boolean; content?: string; exists?: boolean; error?: string }>
  claudeMdSave: (projectPath: string, content: string) => Promise<{ success: boolean; error?: string }>

  // Auto Work mode marker (for hooks)
  autoworkSetActive: (projectPath: string) => Promise<{ success: boolean }>
  autoworkClearActive: (projectPath: string) => Promise<{ success: boolean }>

  // Extensions
  extensionsFetchRegistry: (forceRefresh?: boolean) => Promise<{
    version: number
    skills: Array<{
      id: string
      name: string
      description: string
      type: 'skill' | 'mcp' | 'agent'
      repo?: string
      npm?: string
      commands?: string[]
      tags?: string[]
    }>
    mcps: Array<{
      id: string
      name: string
      description: string
      type: 'skill' | 'mcp' | 'agent'
      npm?: string
      configSchema?: Record<string, unknown>
      tags?: string[]
    }>
    agents: Array<{
      id: string
      name: string
      description: string
      type: 'skill' | 'mcp' | 'agent'
      repo?: string
      tags?: string[]
    }>
  }>
  extensionsFetchFromUrl: (url: string) => Promise<{
    id: string
    name: string
    description: string
    type: 'skill' | 'mcp' | 'agent'
    repo?: string
    npm?: string
    commands?: string[]
    tags?: string[]
  } | null>
  extensionsInstallSkill: (extension: Extension, scope?: 'global' | 'project', projectPath?: string) => Promise<{ success: boolean; error?: string }>
  extensionsInstallMcp: (extension: Extension, config?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  extensionsRemove: (extensionId: string) => Promise<{ success: boolean; error?: string }>
  extensionsUpdate: (extensionId: string) => Promise<{ success: boolean; error?: string }>
  extensionsGetInstalled: () => Promise<Array<{
    id: string
    name: string
    description: string
    type: 'skill' | 'mcp' | 'agent'
    repo?: string
    npm?: string
    commands?: string[]
    tags?: string[]
    installedAt: number
    enabled: boolean
    scope: 'global' | 'project'
    projectPath?: string
    config?: Record<string, unknown>
  }>>
  extensionsGetForProject: (projectPath: string) => Promise<Array<{
    id: string
    name: string
    description: string
    type: 'skill' | 'mcp' | 'agent'
    commands?: string[]
    enabled: boolean
  }>>
  extensionsGetCommands: (projectPath: string) => Promise<Array<{
    command: string
    extensionId: string
    extensionName: string
  }>>
  extensionsGetConfig: (extensionId: string) => Promise<Record<string, unknown> | null>
  extensionsSetConfig: (extensionId: string, config: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  extensionsEnableForProject: (extensionId: string, projectPath: string) => Promise<{ success: boolean; error?: string }>
  extensionsDisableForProject: (extensionId: string, projectPath: string) => Promise<{ success: boolean; error?: string }>
  extensionsAddCustomUrl: (url: string) => Promise<{ success: boolean }>
  extensionsRemoveCustomUrl: (url: string) => Promise<{ success: boolean }>
  extensionsGetCustomUrls: () => Promise<string[]>
}
