export type BackendId = 'claude' | 'gemini' | 'codex' | 'opencode'

export interface CommandMenuItem {
  id: string
  label: string
  command?: string
  disabled?: boolean
}

const DIVIDER: CommandMenuItem = { id: 'divider', label: '─────────────' }
const ADD_CUSTOM: CommandMenuItem = { id: 'addcommand', label: '+ Add Custom Command' }

function cmd(id: string, command?: string): CommandMenuItem {
  const label = command || `/${id}`
  return { id, label, command: command || label }
}

const backendCommandItems: Record<BackendId, CommandMenuItem[]> = {
  claude: [
    cmd('help'), cmd('clear'), cmd('compact'), cmd('cost'),
    cmd('status'), cmd('model'), cmd('config'), cmd('doctor'),
    { ...DIVIDER, id: 'divider-plugins' },
    cmd('plugin-list', '/plugin list'),
    { ...DIVIDER, id: 'divider-cmd' },
    ADD_CUSTOM,
  ],
  gemini: [
    cmd('help'), cmd('clear'), cmd('compact', '/compress'), cmd('stats'),
    cmd('model'), cmd('settings'), cmd('about'), cmd('tools'),
    { ...DIVIDER, id: 'divider-gemini' },
    cmd('auth'), cmd('theme'), cmd('memory'), cmd('mcp'),
    cmd('extensions'), cmd('directory'), cmd('chat'), cmd('resume'),
    cmd('restore'), cmd('copy'), cmd('privacy'), cmd('vim'),
    cmd('init'), cmd('bug'), cmd('editor'), cmd('quit'), cmd('exit'),
    { ...DIVIDER, id: 'divider-cmd' },
    ADD_CUSTOM,
  ],
  codex: [
    cmd('status'), cmd('model'), cmd('compact'), cmd('diff'),
    cmd('review'), cmd('approvals'), cmd('prompts'), cmd('mcp'),
    cmd('mention'), cmd('new'), cmd('feedback'), cmd('init'),
    cmd('logout'), cmd('exit'), cmd('quit'),
    { ...DIVIDER, id: 'divider-cmd' },
    ADD_CUSTOM,
  ],
  opencode: [
    cmd('help'), cmd('clear'), cmd('stats'), cmd('model'),
    cmd('session'), cmd('mcp'), cmd('agent'),
    { ...DIVIDER, id: 'divider-opencode' },
    cmd('auth'), cmd('export'), cmd('import'), cmd('github'), cmd('quit'),
    { ...DIVIDER, id: 'divider-cmd' },
    ADD_CUSTOM,
  ],
}

function normalizeBackend(backend?: string): BackendId | null {
  if (!backend || backend === 'default') return 'claude'
  if (backend === 'claude' || backend === 'gemini' || backend === 'codex' || backend === 'opencode') {
    return backend
  }
  return null
}

export function getCommandMenuItems(backend?: string): CommandMenuItem[] {
  const normalized = normalizeBackend(backend)
  if (!normalized) {
    return [{ id: 'unsupported-unknown', label: 'No command shortcuts for this backend', disabled: true }]
  }
  return backendCommandItems[normalized]
}

export function resolveBackendCommand(backend: string | undefined, commandId: string): string | null {
  const normalized = normalizeBackend(backend)
  if (!normalized) return null
  const items = backendCommandItems[normalized]
  const match = items.find(item => item.id === commandId)
  return match?.command ?? null
}
