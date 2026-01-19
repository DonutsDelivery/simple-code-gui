import { Project } from '../../stores/workspace.js'

export interface ClaudeSession {
  sessionId: string
  slug: string
  lastModified: number
  cwd?: string
  fileSize?: number
}

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  ptyId?: string
  backend?: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
}

export interface SidebarProps {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
  lastFocusedTabId: string | null
  onAddProject: () => void
  onRemoveProject: (path: string) => void
  onOpenSession: (projectPath: string, sessionId?: string, slug?: string, initialPrompt?: string, forceNewSession?: boolean) => void
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
}

export interface ProjectSettingsModalState {
  project: Project
  apiPort: string
  apiAutoStart: boolean
  apiSessionMode: 'existing' | 'new-keep' | 'new-close'
  apiModel: 'default' | 'opus' | 'sonnet' | 'haiku'
  tools: string[]
  permissionMode: string
  apiStatus?: 'checking' | 'success' | 'error'
  apiError?: string
  ttsVoice: string
  ttsEngine: 'piper' | 'xtts' | ''
  backend: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
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
