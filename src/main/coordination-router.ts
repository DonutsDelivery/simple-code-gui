import crypto from 'crypto'
import type {
  AgentAddress,
  CoordinationMessage,
  CoordinationMessageKind,
  CoordinationReceipt,
  CoordinationSnapshot,
} from '../common/coordination-protocol.js'
import { validateCoordinationMessage } from '../common/coordination-protocol.js'
import type { SessionRuntimeRegistry } from './session-runtime-registry.js'
import { CoordinationStore } from './coordination-store.js'

export interface CoordinationSendInput {
  messageId?: string
  assignmentId: string
  correlationId?: string
  sequence: number
  sender: AgentAddress
  recipient: AgentAddress
  kind: CoordinationMessageKind
  repositoryRevision?: string
  artifactIds?: string[]
  payload: unknown
  createdAt?: number
}

/**
 * Server-side coordination authority. Persistence happens before delivery, so
 * an unavailable worker leaves durable pending work rather than losing it.
 */
export class CoordinationRouter {
  constructor(
    private readonly serverId: string,
    private readonly store: CoordinationStore,
    private readonly runtimeRegistry: SessionRuntimeRegistry,
  ) {}

  getSnapshot(): CoordinationSnapshot {
    return this.store.getSnapshot()
  }

  getAssignment(assignmentId: string) {
    return this.store.getAssignment(assignmentId)
  }

  send(input: CoordinationSendInput): CoordinationReceipt {
    const message = validateCoordinationMessage({
      ...input,
      messageId: input.messageId ?? crypto.randomUUID(),
      createdAt: input.createdAt ?? Date.now(),
    })
    if (message.recipient.serverId !== this.serverId && message.sender.serverId !== this.serverId) {
      throw new Error(`Message does not involve server ${this.serverId}`)
    }

    const appended = this.store.append(message)
    let delivered = false
    if (!appended.duplicate && message.recipient.serverId === this.serverId) {
      delivered = this.deliverToRuntime(message)
    }
    return {
      accepted: true,
      duplicate: appended.duplicate,
      delivered,
      revision: appended.revision,
      message,
      assignment: appended.assignment,
    }
  }

  /** Retry a durable message after its exact worker runtime becomes available. */
  deliver(messageId: string): boolean {
    const message = this.store.getMessage(messageId)
    if (!message) throw new Error(`Coordination message not found: ${messageId}`)
    if (message.recipient.serverId !== this.serverId) return false
    return this.deliverToRuntime(message)
  }

  private deliverToRuntime(message: CoordinationMessage): boolean {
    const runtime = this.runtimeRegistry.getRuntime(message.recipient.agentSessionId)
    if (!runtime) return false
    const envelope = JSON.stringify({
      type: 'donutcode-coordination',
      message,
    })
    // Existing harness session receives work through the same supported input
    // channel as a user message. No PTY output scraping or session merging.
    this.runtimeRegistry.writeInput(runtime.ptyId, `${envelope}\n`)
    return true
  }
}
