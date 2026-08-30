export interface AgentAddress {
  serverId: string
  agentSessionId: string
}

export type CoordinationMessageKind = 'request' | 'ack' | 'progress' | 'result' | 'cancel'

export interface CoordinationMessage {
  messageId: string
  assignmentId: string
  correlationId?: string
  sequence: number
  sender: AgentAddress
  recipient: AgentAddress
  kind: CoordinationMessageKind
  repositoryRevision?: string
  artifactIds?: string[]
  payload: unknown
  createdAt: number
}

export type CoordinationAssignmentStatus = 'requested' | 'acknowledged' | 'active' | 'completed' | 'cancelled'

export interface CoordinationAssignment {
  assignmentId: string
  coordinator: AgentAddress
  worker: AgentAddress
  repositoryRevision?: string
  status: CoordinationAssignmentStatus
  lastSequence: number
  messageIds: string[]
  artifactIds: string[]
  createdAt: number
  updatedAt: number
}

export interface CoordinationSnapshot {
  serverId: string
  revision: number
  assignments: CoordinationAssignment[]
  messages: CoordinationMessage[]
}

export interface CoordinationReceipt {
  accepted: boolean
  duplicate: boolean
  delivered: boolean
  revision: number
  message: CoordinationMessage
  assignment: CoordinationAssignment
}

export function isAgentAddress(value: unknown): value is AgentAddress {
  if (!value || typeof value !== 'object') return false
  const address = value as AgentAddress
  return typeof address.serverId === 'string' && address.serverId.length > 0
    && typeof address.agentSessionId === 'string' && address.agentSessionId.length > 0
}

export function validateCoordinationMessage(value: unknown): CoordinationMessage {
  if (!value || typeof value !== 'object') throw new Error('Coordination message is required')
  const message = value as CoordinationMessage
  if (!message.messageId || !message.assignmentId) throw new Error('messageId and assignmentId are required')
  if (!Number.isSafeInteger(message.sequence) || message.sequence < 1) throw new Error('sequence must be a positive integer')
  if (!isAgentAddress(message.sender) || !isAgentAddress(message.recipient)) throw new Error('Exact sender and recipient addresses are required')
  if (!['request', 'ack', 'progress', 'result', 'cancel'].includes(message.kind)) throw new Error(`Unsupported coordination kind: ${String(message.kind)}`)
  if (message.artifactIds && !message.artifactIds.every(id => typeof id === 'string' && id.length > 0)) throw new Error('artifactIds must contain non-empty strings')
  if (!Number.isFinite(message.createdAt)) throw new Error('createdAt is required')
  return message
}
