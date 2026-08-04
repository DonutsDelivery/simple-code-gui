import type { EventEnvelope } from './server-protocol.js'

export type CanonicalLifecycle = 'starting' | 'running' | 'stopped' | 'exited' | 'failed'

export interface CanonicalSession {
  agentSessionId: string
  serverId: string
  harnessId: string
  nativeSessionId?: string
  projectId: string
  runtimeId?: string
  ptyId?: string
  lifecycle: CanonicalLifecycle
}

export interface CanonicalPty {
  ptyId: string
  runtimeId: string
  agentSessionId: string
  serverId: string
  lifecycle: CanonicalLifecycle
}

export interface EnvironmentSnapshot<TWorkspace = unknown> {
  serverId: string
  revision: number
  workspace: TWorkspace
  sessions: CanonicalSession[]
  ptys: CanonicalPty[]
}

export interface EnvironmentEvent<TWorkspace = unknown> {
  type: string
  clientId: string
  commandId: string
  result: unknown
  snapshot: EnvironmentSnapshot<TWorkspace>
}

export interface EnvironmentCommandResult<T = unknown> {
  serverId: string
  revision: number
  result: T
  replayed: boolean
}

export interface EnvironmentEventsResult<TWorkspace = unknown> {
  mode: 'events' | 'snapshot'
  afterRevision: number
  currentRevision: number
  events?: Array<EventEnvelope<EnvironmentEvent<TWorkspace>>>
  snapshot?: EnvironmentSnapshot<TWorkspace>
}

export interface EnvironmentCommandReceipt {
  clientId: string
  commandId: string
  requestHash: string
  response: EnvironmentCommandResult
}
