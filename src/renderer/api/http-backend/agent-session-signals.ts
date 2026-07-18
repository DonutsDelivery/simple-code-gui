import type {
  AgentSessionSignalCallback,
  AgentSessionSignalEvent,
  Unsubscribe
} from '../types'

const listeners = new Set<AgentSessionSignalCallback>()

export function emitAgentSessionSignal(event: AgentSessionSignalEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}

export function onAgentSessionSignal(
  callback: AgentSessionSignalCallback
): Unsubscribe {
  listeners.add(callback)
  return () => listeners.delete(callback)
}
