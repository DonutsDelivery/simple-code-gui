export type AgentSessionSignalType = 'complete' | 'input-needed'

export interface AgentSessionSignalEvent {
  /** Authority-assigned identity for one detected signal occurrence. */
  id?: string
  ptyId: string
  type: AgentSessionSignalType
}

export interface AgentSessionSignalMessage {
  type: 'agent-session-signal'
  signal: AgentSessionSignalEvent
}
