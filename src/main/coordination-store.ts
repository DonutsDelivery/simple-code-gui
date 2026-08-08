import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type {
  CoordinationAssignment,
  CoordinationMessage,
  CoordinationSnapshot,
} from '../common/coordination-protocol.js'

interface PersistedCoordinationState {
  version: 1
  revision: number
  messages: CoordinationMessage[]
  assignments: CoordinationAssignment[]
}

/** Durable server-owned coordination ledger. */
export class CoordinationStore {
  private readonly filePath: string
  private revision = 0
  private readonly messages = new Map<string, CoordinationMessage>()
  private readonly assignments = new Map<string, CoordinationAssignment>()

  constructor(dataDir: string, private readonly serverId: string) {
    this.filePath = join(dataDir, 'coordination', 'state.json')
    this.load()
  }

  getMessage(messageId: string): CoordinationMessage | undefined {
    const message = this.messages.get(messageId)
    return message ? structuredClone(message) : undefined
  }

  getAssignment(assignmentId: string): CoordinationAssignment | undefined {
    const assignment = this.assignments.get(assignmentId)
    return assignment ? structuredClone(assignment) : undefined
  }

  getSnapshot(): CoordinationSnapshot {
    return {
      serverId: this.serverId,
      revision: this.revision,
      assignments: [...this.assignments.values()].map(value => structuredClone(value)),
      messages: [...this.messages.values()].map(value => structuredClone(value)),
    }
  }

  append(message: CoordinationMessage): { duplicate: boolean; assignment: CoordinationAssignment; revision: number } {
    const existing = this.messages.get(message.messageId)
    if (existing) {
      const assignment = this.assignments.get(existing.assignmentId)
      if (!assignment) throw new Error(`Assignment missing for duplicate message ${message.messageId}`)
      return { duplicate: true, assignment: structuredClone(assignment), revision: this.revision }
    }

    const current = this.assignments.get(message.assignmentId)
    if (!current && message.kind !== 'request') {
      throw new Error(`Assignment ${message.assignmentId} must begin with a request`)
    }
    if (current) {
      const expected = current.lastSequence + 1
      if (message.sequence !== expected) throw new Error(`Expected sequence ${expected}, received ${message.sequence}`)
      if (!sameAddress(current.coordinator, message.sender) && !sameAddress(current.worker, message.sender)) {
        throw new Error('Sender is not a participant in this assignment')
      }
      if (!sameAddress(current.coordinator, message.recipient) && !sameAddress(current.worker, message.recipient)) {
        throw new Error('Recipient is not a participant in this assignment')
      }
    } else if (message.sequence !== 1) {
      throw new Error('Initial request sequence must be 1')
    }

    const now = message.createdAt
    const artifactIds = [...new Set([...(current?.artifactIds ?? []), ...(message.artifactIds ?? [])])]
    const assignment: CoordinationAssignment = current ? {
      ...current,
      status: statusFor(message.kind, current.status),
      lastSequence: message.sequence,
      messageIds: [...current.messageIds, message.messageId],
      artifactIds,
      updatedAt: now,
    } : {
      assignmentId: message.assignmentId,
      coordinator: structuredClone(message.sender),
      worker: structuredClone(message.recipient),
      repositoryRevision: message.repositoryRevision,
      status: 'requested',
      lastSequence: 1,
      messageIds: [message.messageId],
      artifactIds,
      createdAt: now,
      updatedAt: now,
    }

    this.messages.set(message.messageId, structuredClone(message))
    this.assignments.set(message.assignmentId, assignment)
    this.revision += 1
    this.persist()
    return { duplicate: false, assignment: structuredClone(assignment), revision: this.revision }
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    const state = JSON.parse(readFileSync(this.filePath, 'utf8')) as PersistedCoordinationState
    if (state.version !== 1) throw new Error(`Unsupported coordination store version: ${String(state.version)}`)
    this.revision = state.revision
    for (const message of state.messages) this.messages.set(message.messageId, message)
    for (const assignment of state.assignments) this.assignments.set(assignment.assignmentId, assignment)
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    const state: PersistedCoordinationState = {
      version: 1,
      revision: this.revision,
      messages: [...this.messages.values()],
      assignments: [...this.assignments.values()],
    }
    writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
    renameSync(tmp, this.filePath)
  }
}

function sameAddress(a: { serverId: string; agentSessionId: string }, b: { serverId: string; agentSessionId: string }): boolean {
  return a.serverId === b.serverId && a.agentSessionId === b.agentSessionId
}

function statusFor(kind: CoordinationMessage['kind'], current: CoordinationAssignment['status']): CoordinationAssignment['status'] {
  if (kind === 'ack') return 'acknowledged'
  if (kind === 'progress') return 'active'
  if (kind === 'result') return 'completed'
  if (kind === 'cancel') return 'cancelled'
  return current
}
