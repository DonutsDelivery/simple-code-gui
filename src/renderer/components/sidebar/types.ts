import { Project } from '../../stores/workspace.js'
import type { OpenSessionOptions } from '../../hooks/useProjectHandlers.js'
import type { BackendId, Session } from '../../api/types'

export interface ClaudeSession {
  sessionId: string
  slug: string
  lastModified: number
  cwd?: string
  fileSize?: number
}

export interface OpenTab {
  serverId: string
  id: string
  projectPath: string
  sessionId?: string
  ptyId?: string
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok' | 'claude-codex'
}

export interface SidebarProps {
  serverId: string
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
  lastFocusedTabId: string | null
  onAddProject: () => void
  onAddProjectsFromParent: () => void
  onRemoveProject: (path: string) => void
  onOpenSession: (projectPath: string, options?: OpenSessionOptions) => void
  onSwitchToTab: (tabId: string) => void
  onOpenSettings: () => void
  onOpenMakeProject: () => void
  onUpdateProject: (path: string, updates: Partial<Project>) => void
  onCloseProjectTabs: (projectPath: string) => void
  width: number
  collapsed: boolean
  onWidthChange: (width: number) => void
  onCollapsedChange: (collapsed: boolean) => void
  // Mobile drawer props
  isMobileOpen?: boolean        // Controls drawer open state on mobile
  onMobileClose?: () => void    // Called when user closes drawer
  // Mobile connect modal
  onOpenMobileConnect?: () => void  // Opens the QR code modal for mobile connection
  onTranscription: (text: string) => void
  // Mobile disconnect
  onDisconnect?: () => void     // Disconnects from desktop host (mobile only)
  // Multi-server: resolve the API for a project's origin server so session
  // discovery and spawning run on the connected server.
  getApiForServer?: (serverId: string) => { discoverSessions: (projectPath: string, backend?: BackendId) => Promise<Session[]> } | null | undefined
  // Global default harness from settings, used when no per-project override exists.
  defaultHarnessId?: string
}

export interface ProjectSettingsModalState {
  project: Project
  apiPort: string
  apiAutoStart: boolean
  apiSessionMode: 'existing' | 'new-keep' | 'new-close'
  apiModel: 'default' | 'opus' | 'sonnet' | 'haiku'
  tools: string[]
  permissionMode: string
  icon: string
  apiStatus?: 'checking' | 'success' | 'error'
  apiError?: string
  ttsVoice: string
  ttsEngine: 'piper' | 'xtts' | ''
  backend: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok'
}

export interface InstalledVoice {
  key: string
  displayName: string
  source: string
}

export interface DropTarget {
  type: 'category' | 'project' | 'uncategorized'
  id: string | null
  position?: 'before' | 'after'
}
