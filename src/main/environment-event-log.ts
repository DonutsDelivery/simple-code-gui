import type { EnvironmentEvent, EnvironmentEventsResult, EnvironmentSnapshot } from '../common/environment-protocol.js'
import type { EventEnvelope } from '../common/server-protocol.js'

export const DEFAULT_ENVIRONMENT_EVENT_LIMIT = 500

export class EnvironmentEventLog<TWorkspace = unknown> {
  private events: Array<EventEnvelope<EnvironmentEvent<TWorkspace>>>

  constructor(
    private readonly serverId: string,
    events: Array<EventEnvelope<EnvironmentEvent<TWorkspace>>> = [],
    private readonly limit = DEFAULT_ENVIRONMENT_EVENT_LIMIT,
  ) {
    this.events = events
      .filter(event => event.serverId === serverId)
      .sort((left, right) => left.revision - right.revision)
      .slice(-limit)
  }

  append(revision: number, event: EnvironmentEvent<TWorkspace>): EventEnvelope<EnvironmentEvent<TWorkspace>> {
    const previousRevision = this.events.at(-1)?.revision
    if (previousRevision !== undefined && revision <= previousRevision) {
      throw new Error(`Environment event revision ${revision} is not after ${previousRevision}`)
    }
    const envelope: EventEnvelope<EnvironmentEvent<TWorkspace>> = {
      serverId: this.serverId,
      revision,
      eventId: `${this.serverId}:${revision}`,
      occurredAt: Date.now(),
      event,
    }
    this.events.push(envelope)
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit)
    return structuredClone(envelope)
  }

  getEvents(): Array<EventEnvelope<EnvironmentEvent<TWorkspace>>> {
    return structuredClone(this.events)
  }

  restore(events: Array<EventEnvelope<EnvironmentEvent<TWorkspace>>>): void {
    this.events = events
      .filter(event => event.serverId === this.serverId)
      .sort((left, right) => left.revision - right.revision)
      .slice(-this.limit)
  }

  after(
    revision: number,
    snapshot: EnvironmentSnapshot<TWorkspace>,
  ): EnvironmentEventsResult<TWorkspace> {
    const currentRevision = snapshot.revision
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > currentRevision) {
      return {
        mode: 'snapshot',
        afterRevision: revision,
        currentRevision,
        snapshot: structuredClone(snapshot),
      }
    }

    const firstAvailable = this.events[0]?.revision ?? currentRevision + 1
    if (revision < firstAvailable - 1) {
      return {
        mode: 'snapshot',
        afterRevision: revision,
        currentRevision,
        snapshot: structuredClone(snapshot),
      }
    }

    return {
      mode: 'events',
      afterRevision: revision,
      currentRevision,
      events: structuredClone(this.events.filter(event => event.revision > revision)),
    }
  }
}
