export type BackendId = 'claude' | 'gemini' | 'codex' | 'opencode'

export interface CommandMenuItem {
  id: string
  label: string
  command?: string
  disabled?: boolean
}

const claudeCommandItems: CommandMenuItem[] = [
  { id: 'help', label: '/help', command: '/help' },
  { id: 'clear', label: '/clear', command: '/clear' },
  { id: 'compact', label: '/compact', command: '/compact' },
  { id: 'cost', label: '/cost', command: '/cost' },
  { id: 'status', label: '/status', command: '/status' },
  { id: 'model', label: '/model', command: '/model' },
  { id: 'config', label: '/config', command: '/config' },
  { id: 'doctor', label: '/doctor', command: '/doctor' },
  { id: 'divider-cmd', label: '─────────────' },
  { id: 'addcommand', label: '+ Add Custom Command' },
]

const geminiCommandItems: CommandMenuItem[] = [
  { id: 'help', label: '/help', command: '/help' },
  { id: 'clear', label: '/clear', command: '/clear' },
  { id: 'compact', label: '/compress', command: '/compress' },
  { id: 'stats', label: '/stats', command: '/stats' },
  { id: 'model', label: '/model', command: '/model' },
  { id: 'settings', label: '/settings', command: '/settings' },
  { id: 'about', label: '/about', command: '/about' },
  { id: 'tools', label: '/tools', command: '/tools' },
  { id: 'divider-gemini', label: '─────────────' },
  { id: 'auth', label: '/auth', command: '/auth' },
  { id: 'theme', label: '/theme', command: '/theme' },
  { id: 'memory', label: '/memory', command: '/memory' },
  { id: 'mcp', label: '/mcp', command: '/mcp' },
  { id: 'extensions', label: '/extensions', command: '/extensions' },
  { id: 'directory', label: '/directory', command: '/directory' },
  { id: 'chat', label: '/chat', command: '/chat' },
  { id: 'resume', label: '/resume', command: '/resume' },
  { id: 'restore', label: '/restore', command: '/restore' },
  { id: 'copy', label: '/copy', command: '/copy' },
  { id: 'privacy', label: '/privacy', command: '/privacy' },
  { id: 'vim', label: '/vim', command: '/vim' },
  { id: 'init', label: '/init', command: '/init' },
  { id: 'bug', label: '/bug', command: '/bug' },
  { id: 'editor', label: '/editor', command: '/editor' },
  { id: 'quit', label: '/quit', command: '/quit' },
  { id: 'exit', label: '/exit', command: '/exit' },
  { id: 'divider-cmd', label: '─────────────' },
  { id: 'addcommand', label: '+ Add Custom Command' },
]

const codexCommandItems: CommandMenuItem[] = [
  { id: 'status', label: '/status', command: '/status' },
  { id: 'model', label: '/model', command: '/model' },
  { id: 'compact', label: '/compact', command: '/compact' },
  { id: 'diff', label: '/diff', command: '/diff' },
  { id: 'review', label: '/review', command: '/review' },
  { id: 'approvals', label: '/approvals', command: '/approvals' },
  { id: 'prompts', label: '/prompts', command: '/prompts' },
  { id: 'mcp', label: '/mcp', command: '/mcp' },
  { id: 'mention', label: '/mention', command: '/mention' },
  { id: 'new', label: '/new', command: '/new' },
  { id: 'feedback', label: '/feedback', command: '/feedback' },
  { id: 'init', label: '/init', command: '/init' },
  { id: 'logout', label: '/logout', command: '/logout' },
  { id: 'exit', label: '/exit', command: '/exit' },
  { id: 'quit', label: '/quit', command: '/quit' },
  { id: 'divider-cmd', label: '─────────────' },
  { id: 'addcommand', label: '+ Add Custom Command' },
]

const opencodeCommandItems: CommandMenuItem[] = [
  { id: 'help', label: '/help', command: '/help' },
  { id: 'clear', label: '/clear', command: '/clear' },
  { id: 'stats', label: '/stats', command: '/stats' },
  { id: 'model', label: '/model', command: '/model' },
  { id: 'session', label: '/session', command: '/session' },
  { id: 'mcp', label: '/mcp', command: '/mcp' },
  { id: 'agent', label: '/agent', command: '/agent' },
  { id: 'divider-opencode', label: '─────────────' },
  { id: 'auth', label: '/auth', command: '/auth' },
  { id: 'export', label: '/export', command: '/export' },
  { id: 'import', label: '/import', command: '/import' },
  { id: 'github', label: '/github', command: '/github' },
  { id: 'quit', label: '/quit', command: '/quit' },
  { id: 'divider-cmd', label: '─────────────' },
  { id: 'addcommand', label: '+ Add Custom Command' },
]

const backendCommandItems: Record<BackendId, CommandMenuItem[]> = {
  claude: claudeCommandItems,
  gemini: geminiCommandItems,
  codex: codexCommandItems,
  opencode: opencodeCommandItems,
}

const normalizeBackend = (backend?: string): BackendId | null => {
  if (!backend || backend === 'default') return 'claude'
  if (backend === 'claude' || backend === 'gemini' || backend === 'codex' || backend === 'opencode') {
    return backend
  }
  return null
}

export const getCommandMenuItems = (backend?: string): CommandMenuItem[] => {
  const normalized = normalizeBackend(backend)
  if (!normalized) {
    return [{ id: 'unsupported-unknown', label: 'No command shortcuts for this backend', disabled: true }]
  }
  return backendCommandItems[normalized]
}

export const resolveBackendCommand = (backend: string | undefined, commandId: string): string | null => {
  const normalized = normalizeBackend(backend)
  if (!normalized) return null
  const items = backendCommandItems[normalized]
  const match = items.find(item => item.id === commandId)
  return match?.command ?? null
}
