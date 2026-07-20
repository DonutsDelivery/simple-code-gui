import { createHash } from 'crypto'
import { resolve } from 'path'
import type { AgentSessionSignalType } from '../common/agent-session-signal'

const AGENT_SESSION_SIGNAL_PROTOCOL = 'claude-terminal-agent-session-signal-v2'
const SIGNAL_KEY_LENGTH = 10
const SIGNAL_TYPE_CODES: Record<AgentSessionSignalType, string> = {
  complete: 'c',
  'input-needed': 'i',
}

export function getAgentSessionSignalKey(projectPath: string): string {
  return createHash('sha256')
    .update(`${AGENT_SESSION_SIGNAL_PROTOCOL}\0${resolve(projectPath)}`)
    .digest('base64url')
    .slice(0, SIGNAL_KEY_LENGTH)
}

export function formatAgentSessionSignal(
  projectPath: string,
  type: AgentSessionSignalType,
): string {
  const key = getAgentSessionSignalKey(projectPath)
  return `<ct-signal k="${key}" t="${SIGNAL_TYPE_CODES[type]}" />`
}
