export type AgentSessionSignalType = 'complete' | 'input-needed'

export interface AgentSessionSignalEvent {
  ptyId: string
  type: AgentSessionSignalType
}

export interface AgentSessionSignalMessage {
  type: 'agent-session-signal'
  signal: AgentSessionSignalEvent
}
