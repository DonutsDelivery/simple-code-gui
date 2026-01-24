import { contextBridge, ipcRenderer, webUtils, IpcRendererEvent } from 'electron'

export interface Settings {
  defaultProjectDir: string
  theme: string
  voiceOutputEnabled?: boolean
  voiceVolume?: number
  voiceSpeed?: number
  voiceSkipOnNew?: boolean
  autoAcceptTools?: string[]
  permissionMode?: string
  backend?: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
}

// Workspace types
export interface ProjectCategory {
  id: string
  name: string
  collapsed: boolean
  order: number
}

export interface Project {
  path: string
  name: string
  executable?: string
  apiPort?: number
  apiAutoStart?: boolean
  apiSessionMode?: 'existing' | 'new-keep' | 'new-close'
  apiModel?: 'default' | 'opus' | 'sonnet' | 'haiku'
  autoAcceptTools?: string[]
  permissionMode?: string
  color?: string
  ttsVoice?: string
  ttsEngine?: 'piper' | 'xtts'
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode'
  categoryId?: string
  order?: number
}

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  ptyId: string
  backend?: string
}

export interface Workspace {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
  viewMode?: 'tabs' | 'tiled'
  tileLayout?: TileLayout[]
  categories: ProjectCategory[]
}

export interface TileLayout {
  id: string
  x: number
  y: number
  width: number
  height: number
}

// Session types
export interface Session {
  sessionId: string
  slug: string
}

// Beads task types
export interface BeadsTask {
  id: string
  title: string
  status: string
  priority?: number
  created?: string
  blockers?: string[]
  description?: string
  issue_type?: string
  created_at?: string
  updated_at?: string
  dependency_count?: number
  dependent_count?: number
}

export interface BeadsCloseResult {
  taskId: string
  status: string
}

// Voice settings types
export interface VoiceSettings {
  whisperModel?: string
  ttsEngine?: 'piper' | 'xtts' | 'openvoice'
  ttsVoice?: string
  ttsSpeed?: number
  microphoneId?: string | null
  readBehavior?: 'immediate' | 'pause' | 'manual'
  skipOnNew?: boolean
  xttsTemperature?: number
  xttsTopK?: number
  xttsTopP?: number
  xttsRepetitionPenalty?: number
}

// Extension types
export interface Extension {
  id: string
  name: string
  description: string
  type: 'skill' | 'mcp' | 'agent'
  repo?: string
  npm?: string
  commands?: string[]
  tags?: string[]
  configSchema?: Record<string, unknown>
}

export interface ElectronAPI {
  // Workspace
  getWorkspace: () => Promise<Workspace>
  saveWorkspace: (workspace: Workspace) => Promise<void>
  addProject: () => Promise<string | null>
  addProjectsFromParent: () => Promise<Array<{ path: string; name: string }> | null>
  getMetaProjectsPath: () => Promise<string>
  getCategoryMetaPath: (categoryName: string) => Promise<string>

  // Sessions
  discoverSessions: (projectPath: string, backend?: 'claude' | 'opencode') => Promise<Session[]>

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
  spawnPty: (cwd: string, sessionId?: string, model?: string, backend?: string) => Promise<string>
  writePty: (id: string, data: string) => void
  resizePty: (id: string, cols: number, rows: number) => void
  killPty: (id: string) => void
  setPtyBackend: (id: string, backend: string) => Promise<void>
  onPtyData: (id: string, callback: (data: string) => void) => () => void
  onPtyExit: (id: string, callback: (code: number) => void) => () => void
  onPtyRecreated: (callback: (data: { oldId: string; newId: string; backend: string }) => void) => () => void

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

const api: ElectronAPI = {
  // Workspace management
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  saveWorkspace: (workspace) => ipcRenderer.invoke('workspace:save', workspace),
  addProject: () => ipcRenderer.invoke('workspace:addProject'),
  addProjectsFromParent: () => ipcRenderer.invoke('workspace:addProjectsFromParent'),
  getMetaProjectsPath: () => ipcRenderer.invoke('workspace:getMetaProjectsPath'),
  getCategoryMetaPath: (categoryName) => ipcRenderer.invoke('workspace:getCategoryMetaPath', categoryName),

  // Session discovery
  discoverSessions: (projectPath, backend) => ipcRenderer.invoke('sessions:discover', projectPath, backend),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  selectDirectory: () => ipcRenderer.invoke('settings:selectDirectory'),

  // Project creation
  createProject: (name, parentDir) => ipcRenderer.invoke('project:create', { name, parentDir }),

  // Executable
  selectExecutable: () => ipcRenderer.invoke('executable:select'),
  runExecutable: (executable, cwd) => ipcRenderer.invoke('executable:run', { executable, cwd }),

  // Claude Code & Node.js & Python & Git
  claudeCheck: () => ipcRenderer.invoke('claude:check'),
  claudeInstall: () => ipcRenderer.invoke('claude:install'),
  nodeInstall: () => ipcRenderer.invoke('node:install'),
  gitInstall: () => ipcRenderer.invoke('git:install'),
  pythonInstall: () => ipcRenderer.invoke('python:install'),
  onInstallProgress: (callback) => {
    const handler = (_: IpcRendererEvent, data: { type: string; status: string; percent?: number }) => callback(data)
    ipcRenderer.on('install:progress', handler)
    return () => ipcRenderer.removeListener('install:progress', handler)
  },

  // Gemini CLI
  geminiCheck: () => ipcRenderer.invoke('gemini:check'),
  geminiInstall: () => ipcRenderer.invoke('gemini:install'),

  // Codex CLI
  codexCheck: () => ipcRenderer.invoke('codex:check'),
  codexInstall: () => ipcRenderer.invoke('codex:install'),

  // OpenCode CLI
  opencodeCheck: () => ipcRenderer.invoke('opencode:check'),
  opencodeInstall: () => ipcRenderer.invoke('opencode:install'),

  // Aider CLI
  aiderCheck: () => ipcRenderer.invoke('aider:check'),
  aiderInstall: () => ipcRenderer.invoke('aider:install'),

  // Get Shit Done (GSD) - Claude Code workflow addon
  gsdCheck: () => ipcRenderer.invoke('gsd:check'),
  gsdInstall: () => ipcRenderer.invoke('gsd:install'),
  gsdProjectCheck: (cwd) => ipcRenderer.invoke('gsd:projectCheck', cwd),
  gsdGetProgress: (cwd) => ipcRenderer.invoke('gsd:getProgress', cwd),

  // Beads
  beadsCheck: (cwd) => ipcRenderer.invoke('beads:check', cwd),
  beadsInit: (cwd) => ipcRenderer.invoke('beads:init', cwd),
  beadsInstall: () => ipcRenderer.invoke('beads:install'),
  beadsReady: (cwd) => ipcRenderer.invoke('beads:ready', cwd),
  beadsList: (cwd) => ipcRenderer.invoke('beads:list', cwd),
  beadsShow: (cwd, taskId) => ipcRenderer.invoke('beads:show', { cwd, taskId }),
  beadsCreate: (cwd, title, description, priority, type, labels) => ipcRenderer.invoke('beads:create', { cwd, title, description, priority, type, labels }),
  beadsComplete: (cwd, taskId) => ipcRenderer.invoke('beads:complete', { cwd, taskId }),
  beadsDelete: (cwd, taskId) => ipcRenderer.invoke('beads:delete', { cwd, taskId }),
  beadsStart: (cwd, taskId) => ipcRenderer.invoke('beads:start', { cwd, taskId }),
  beadsUpdate: (cwd, taskId, status, title, description, priority) => ipcRenderer.invoke('beads:update', { cwd, taskId, status, title, description, priority }),
  beadsWatch: (cwd) => ipcRenderer.invoke('beads:watch', cwd),
  beadsUnwatch: (cwd) => ipcRenderer.invoke('beads:unwatch', cwd),
  onBeadsTasksChanged: (callback) => {
    const handler = (_: IpcRendererEvent, data: { cwd: string }) => callback(data)
    ipcRenderer.on('beads:tasks-changed', handler)
    return () => ipcRenderer.removeListener('beads:tasks-changed', handler)
  },

  // TTS instructions (CLAUDE.md)
  ttsInstallInstructions: (projectPath) => ipcRenderer.invoke('tts:installInstructions', projectPath),
  ttsRemoveInstructions: (projectPath) => ipcRenderer.invoke('tts:removeInstructions', projectPath),

  // Voice (STT/TTS)
  voiceCheckWhisper: () => ipcRenderer.invoke('voice:checkWhisper'),
  voiceInstallWhisper: (model) => ipcRenderer.invoke('voice:installWhisper', model),
  voiceTranscribe: (pcmData) => ipcRenderer.invoke('voice:transcribe', pcmData),
  voiceSetWhisperModel: (model) => ipcRenderer.invoke('voice:setWhisperModel', model),
  voiceCheckTTS: () => ipcRenderer.invoke('voice:checkTTS'),
  voiceGetFullStatus: () => ipcRenderer.invoke('voice:getFullStatus'),
  voiceInstallPiper: () => ipcRenderer.invoke('voice:installPiper'),
  voiceInstallVoice: (voice) => ipcRenderer.invoke('voice:installVoice', voice),
  voiceSpeak: (text) => ipcRenderer.invoke('voice:speak', text),
  voiceStopSpeaking: () => ipcRenderer.invoke('voice:stopSpeaking'),
  voiceGetVoices: () => ipcRenderer.invoke('voice:getVoices'),
  voiceGetWhisperModels: () => ipcRenderer.invoke('voice:getWhisperModels'),
  voiceSetVoice: (voice) => ipcRenderer.invoke('voice:setVoice', voice),
  voiceGetSettings: () => ipcRenderer.invoke('voice:getSettings'),
  voiceApplySettings: (settings) => ipcRenderer.invoke('voice:applySettings', settings),

  // Voice catalog
  voiceFetchCatalog: (forceRefresh) => ipcRenderer.invoke('voice:fetchCatalog', forceRefresh),
  voiceDownloadFromCatalog: (voiceKey) => ipcRenderer.invoke('voice:downloadFromCatalog', voiceKey),
  voiceGetInstalled: () => ipcRenderer.invoke('voice:getInstalled'),
  voiceImportCustom: () => ipcRenderer.invoke('voice:importCustom'),
  voiceRemoveCustom: (voiceKey) => ipcRenderer.invoke('voice:removeCustom', voiceKey),
  voiceOpenCustomFolder: () => ipcRenderer.invoke('voice:openCustomFolder'),

  // XTTS (voice cloning)
  xttsCheck: () => ipcRenderer.invoke('xtts:check'),
  xttsInstall: () => ipcRenderer.invoke('xtts:install'),
  xttsCreateVoice: (audioPath, name, language) => ipcRenderer.invoke('xtts:createVoice', { audioPath, name, language }),
  xttsGetVoices: () => ipcRenderer.invoke('xtts:getVoices'),
  xttsDeleteVoice: (voiceId) => ipcRenderer.invoke('xtts:deleteVoice', voiceId),
  xttsSpeak: (text, voiceId, language) => ipcRenderer.invoke('xtts:speak', { text, voiceId, language }),
  xttsSelectAudio: () => ipcRenderer.invoke('xtts:selectAudio'),
  xttsGetLanguages: () => ipcRenderer.invoke('xtts:getLanguages'),
  xttsGetSampleVoices: () => ipcRenderer.invoke('xtts:getSampleVoices'),
  xttsDownloadSampleVoice: (sampleId) => ipcRenderer.invoke('xtts:downloadSampleVoice', sampleId),
  xttsSelectMediaFile: () => ipcRenderer.invoke('xtts:selectMediaFile'),
  xttsGetMediaDuration: (filePath) => ipcRenderer.invoke('xtts:getMediaDuration', filePath),
  xttsExtractAudioClip: (inputPath, startTime, endTime) => ipcRenderer.invoke('xtts:extractAudioClip', { inputPath, startTime, endTime }),

  // PTY management
  spawnPty: (cwd, sessionId, model, backend) => ipcRenderer.invoke('pty:spawn', { cwd, sessionId, model, backend }),
  writePty: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  resizePty: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  killPty: (id) => ipcRenderer.send('pty:kill', id),
  setPtyBackend: (id, backend) => ipcRenderer.invoke('pty:set-backend', { id, backend }),

  onPtyData: (id, callback) => {
    const handler = (_: IpcRendererEvent, data: string) => callback(data)
    ipcRenderer.on(`pty:data:${id}`, handler)
    return () => ipcRenderer.removeListener(`pty:data:${id}`, handler)
  },

  onPtyExit: (id, callback) => {
    const handler = (_: IpcRendererEvent, code: number) => callback(code)
    ipcRenderer.on(`pty:exit:${id}`, handler)
    return () => ipcRenderer.removeListener(`pty:exit:${id}`, handler)
  },

  onPtyRecreated: (callback) => {
    const handler = (_: IpcRendererEvent, data: { oldId: string; newId: string; backend: string }) => callback(data)
    ipcRenderer.on('pty:recreated', handler)
    return () => ipcRenderer.removeListener('pty:recreated', handler)
  },

  // API Server
  apiStart: (projectPath, port) => ipcRenderer.invoke('api:start', { projectPath, port }),
  apiStop: (projectPath) => ipcRenderer.invoke('api:stop', projectPath),
  apiStatus: (projectPath) => ipcRenderer.invoke('api:status', projectPath),
  onApiOpenSession: (callback) => {
    const handler = (_: IpcRendererEvent, data: { projectPath: string; autoClose: boolean; model?: string }) => callback(data)
    ipcRenderer.on('api:open-session', handler)
    return () => ipcRenderer.removeListener('api:open-session', handler)
  },

  // Mobile Server (for phone app connectivity)
  mobileGetConnectionInfo: () => ipcRenderer.invoke('mobile:getConnectionInfo'),
  mobileRegenerateToken: () => ipcRenderer.invoke('mobile:regenerateToken'),
  mobileIsRunning: () => ipcRenderer.invoke('mobile:isRunning'),
  mobileSendFile: (filePath: string, message?: string) => ipcRenderer.invoke('mobile:sendFile', filePath, message),
  mobileGetConnectedClients: () => ipcRenderer.invoke('mobile:getConnectedClients'),
  mobileGetPendingFiles: () => ipcRenderer.invoke('mobile:getPendingFiles'),

  // Updater
  getVersion: () => ipcRenderer.invoke('updater:getVersion'),
  checkForUpdate: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (callback) => {
    const handler = (_: IpcRendererEvent, data: { status: string; version?: string; progress?: number; error?: string }) => callback(data)
    ipcRenderer.on('updater:status', handler)
    return () => ipcRenderer.removeListener('updater:status', handler)
  },

  // Clipboard
  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),

  // File utilities
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Debug logging
  debugLog: (message) => ipcRenderer.send('debug:log', message),

  // App utilities
  isDebugMode: () => ipcRenderer.invoke('app:isDebugMode'),
  refresh: () => ipcRenderer.invoke('app:refresh'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  // Custom commands
  commandsSave: (name, content, projectPath) => ipcRenderer.invoke('commands:save', { name, content, projectPath }),

  // CLAUDE.md editor
  claudeMdRead: (projectPath) => ipcRenderer.invoke('claudemd:read', projectPath),
  claudeMdSave: (projectPath, content) => ipcRenderer.invoke('claudemd:save', { projectPath, content }),

  // Auto Work mode marker (for hooks) - placeholder implementations
  autoworkSetActive: (projectPath) => ipcRenderer.invoke('autowork:setActive', projectPath),
  autoworkClearActive: (projectPath) => ipcRenderer.invoke('autowork:clearActive', projectPath),

  // Extensions
  extensionsFetchRegistry: (forceRefresh) => ipcRenderer.invoke('extensions:fetchRegistry', forceRefresh),
  extensionsFetchFromUrl: (url) => ipcRenderer.invoke('extensions:fetchFromUrl', url),
  extensionsInstallSkill: (extension, scope, projectPath) => ipcRenderer.invoke('extensions:installSkill', { extension, scope, projectPath }),
  extensionsInstallMcp: (extension, config) => ipcRenderer.invoke('extensions:installMcp', { extension, config }),
  extensionsRemove: (extensionId) => ipcRenderer.invoke('extensions:remove', extensionId),
  extensionsUpdate: (extensionId) => ipcRenderer.invoke('extensions:update', extensionId),
  extensionsGetInstalled: () => ipcRenderer.invoke('extensions:getInstalled'),
  extensionsGetForProject: (projectPath) => ipcRenderer.invoke('extensions:getForProject', projectPath),
  extensionsGetCommands: (projectPath) => ipcRenderer.invoke('extensions:getCommands', projectPath),
  extensionsGetConfig: (extensionId) => ipcRenderer.invoke('extensions:getConfig', extensionId),
  extensionsSetConfig: (extensionId, config) => ipcRenderer.invoke('extensions:setConfig', { extensionId, config }),
  extensionsEnableForProject: (extensionId, projectPath) => ipcRenderer.invoke('extensions:enableForProject', { extensionId, projectPath }),
  extensionsDisableForProject: (extensionId, projectPath) => ipcRenderer.invoke('extensions:disableForProject', { extensionId, projectPath }),
  extensionsAddCustomUrl: (url) => ipcRenderer.invoke('extensions:addCustomUrl', url),
  extensionsRemoveCustomUrl: (url) => ipcRenderer.invoke('extensions:removeCustomUrl', url),
  extensionsGetCustomUrls: () => ipcRenderer.invoke('extensions:getCustomUrls')
}

contextBridge.exposeInMainWorld('electronAPI', api)
