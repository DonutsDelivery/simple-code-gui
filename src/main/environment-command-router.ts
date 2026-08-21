import { createHash } from 'crypto'
import type {
  CanonicalSession,
  EnvironmentCommandReceipt,
  EnvironmentCommandResult,
  EnvironmentEvent,
  EnvironmentEventsResult,
  EnvironmentSnapshot,
} from '../common/environment-protocol.js'
import type { CommandEnvelope, EventEnvelope } from '../common/server-protocol.js'
import type { OpenTab, Project, SavedWorkspaceSession, Workspace } from './session-store.js'
import { EnvironmentEventLog } from './environment-event-log.js'
import { EnvironmentState } from './environment-state.js'

export type EnvironmentCommand =
  | { type: 'replace-workspace'; workspace: Workspace }
  | { type: 'create-workspace'; workspace: SavedWorkspaceSession }
  | { type: 'rename-workspace'; workspaceId: string; name: string }
  | { type: 'delete-workspace'; workspaceId: string }
  | { type: 'create-tile'; workspaceId: string; tile: any; direction?: 'horizontal' | 'vertical' }
  | { type: 'close-tile'; workspaceId: string; tileId: string }
  | { type: 'move-tile'; workspaceId: string; tileTree: any }
  | { type: 'focus-tile'; workspaceId: string; tileId: string; tabId?: string }
  | { type: 'create-session'; session: CanonicalSession; workspaceId?: string; tab?: OpenTab }
  | { type: 'attach-session'; agentSessionId: string; runtimeId: string; ptyId: string }
  | { type: 'stop-session'; agentSessionId: string }
  | { type: 'start-new-session'; session: CanonicalSession; workspaceId: string; tab: OpenTab }
  | { type: 'update-project'; projectPath: string; updates: Partial<Project> }
  | { type: 'set-active-workspace'; workspaceId: string }
  | { type: 'set-active-session'; workspaceId: string; agentSessionId: string }

export interface EnvironmentPersistenceData {
  snapshot: EnvironmentSnapshot<Workspace>
  events: Array<EventEnvelope<EnvironmentEvent<Workspace>>>
  receipts: EnvironmentCommandReceipt[]
}

export interface EnvironmentCommandRouterOptions {
  receipts?: EnvironmentCommandReceipt[]
  receiptLimit?: number
  persist?: (data: EnvironmentPersistenceData) => void
}

export class EnvironmentRevisionConflictError extends Error {
  readonly code = 'REVISION_CONFLICT'

  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
    readonly snapshot: EnvironmentSnapshot<Workspace>,
  ) {
    super(`Expected environment revision ${expectedRevision}, current revision is ${currentRevision}`)
    this.name = 'EnvironmentRevisionConflictError'
  }
}

export class EnvironmentCommandConflictError extends Error {
  readonly code = 'COMMAND_ID_CONFLICT'

  constructor(readonly clientId: string, readonly commandId: string) {
    super(`Command ${clientId}/${commandId} was already used with a different request`)
    this.name = 'EnvironmentCommandConflictError'
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  )
}

function requestHash(envelope: CommandEnvelope<EnvironmentCommand>): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize({
      serverId: envelope.serverId,
      expectedRevision: envelope.expectedRevision,
      command: envelope.command,
    })))
    .digest('hex')
}

function cloneWorkspaceSession(workspace: Workspace, workspaceId: string): SavedWorkspaceSession {
  const session = workspace.sessions?.find(candidate => candidate.id === workspaceId)
  if (!session) throw new Error(`Workspace ${workspaceId} not found`)
  return session
}

function removeTile(node: any, tileId: string): any {
  if (!node) return null
  if (node.type === 'leaf') return node.id === tileId ? null : node
  const children = (node.children ?? []).map((child: any) => removeTile(child, tileId)).filter(Boolean)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...node, children }
}

function focusTile(node: any, tileId: string, tabId?: string): { node: any; focusedTabId?: string } {
  if (!node) return { node }
  if (node.type === 'leaf') {
    if (node.id !== tileId) return { node }
    const activeTabId = tabId && node.tabIds?.includes(tabId) ? tabId : node.activeTabId
    return { node: { ...node, activeTabId }, focusedTabId: activeTabId }
  }
  let focusedTabId: string | undefined
  const children = (node.children ?? []).map((child: any) => {
    const result = focusTile(child, tileId, tabId)
    if (result.focusedTabId) focusedTabId = result.focusedTabId
    return result.node
  })
  return { node: { ...node, children }, focusedTabId }
}

function validateCommand(command: EnvironmentCommand): void {
  if (!command || typeof command !== 'object' || typeof command.type !== 'string') {
    throw new Error('Invalid environment command')
  }
  const commandTypes: ReadonlySet<EnvironmentCommand['type']> = new Set([
    'replace-workspace',
    'create-workspace',
    'rename-workspace',
    'delete-workspace',
    'create-tile',
    'close-tile',
    'move-tile',
    'focus-tile',
    'create-session',
    'attach-session',
    'stop-session',
    'start-new-session',
    'update-project',
    'set-active-workspace',
    'set-active-session',
  ])
  if (!commandTypes.has(command.type)) throw new Error(`Unknown environment command: ${command.type}`)
}

export class EnvironmentCommandRouter {
  private receipts = new Map<string, EnvironmentCommandReceipt>()
  private listeners = new Set<(event: EventEnvelope<EnvironmentEvent<Workspace>>) => void>()
  private readonly receiptLimit: number
  private readonly persist?: (data: EnvironmentPersistenceData) => void

  constructor(
    private readonly state: EnvironmentState,
    private readonly eventLog: EnvironmentEventLog<Workspace>,
    options: EnvironmentCommandRouterOptions = {},
  ) {
    this.receiptLimit = options.receiptLimit ?? 1000
    this.persist = options.persist
    for (const receipt of options.receipts ?? []) {
      this.receipts.set(`${receipt.clientId}\0${receipt.commandId}`, structuredClone(receipt))
    }
  }

  getSnapshot(): EnvironmentSnapshot<Workspace> {
    return this.state.getSnapshot()
  }

  getEventsAfter(revision: number): EnvironmentEventsResult<Workspace> {
    return this.eventLog.after(revision, this.state.getSnapshot())
  }

  getReceipts(): EnvironmentCommandReceipt[] {
    return structuredClone([...this.receipts.values()])
  }

  onEvent(listener: (event: EventEnvelope<EnvironmentEvent<Workspace>>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  execute(
    envelope: CommandEnvelope<EnvironmentCommand>,
    options: { allowRuntimeLifecycle?: boolean } = {},
  ): EnvironmentCommandResult {
    const current = this.state.getSnapshot()
    if (envelope.serverId !== current.serverId) {
      throw new Error(`Command targets server ${envelope.serverId}; this server is ${current.serverId}`)
    }
    if (!envelope.clientId || !envelope.commandId) throw new Error('clientId and commandId are required')
    if (
      !options.allowRuntimeLifecycle
      && (envelope.command.type === 'attach-session' || envelope.command.type === 'stop-session')
    ) {
      throw new Error(`${envelope.command.type} is reserved for the server runtime registry`)
    }
    validateCommand(envelope.command)

    const key = `${envelope.clientId}\0${envelope.commandId}`
    const hash = requestHash(envelope)
    const existing = this.receipts.get(key)
    if (existing) {
      if (existing.requestHash !== hash) {
        throw new EnvironmentCommandConflictError(envelope.clientId, envelope.commandId)
      }
      return { ...structuredClone(existing.response), replayed: true }
    }

    if (envelope.expectedRevision === undefined) {
      throw new Error('expectedRevision is required')
    }
    if (envelope.expectedRevision !== current.revision) {
      throw new EnvironmentRevisionConflictError(envelope.expectedRevision, current.revision, current)
    }

    const previousEvents = this.eventLog.getEvents()
    const previousReceipts = this.getReceipts()
    const mutation = this.apply(current, envelope.command)
    const snapshot = this.state.commit(mutation.next)
    const response: EnvironmentCommandResult = {
      serverId: snapshot.serverId,
      revision: snapshot.revision,
      result: mutation.result,
      replayed: false,
    }
    const event = this.eventLog.append(snapshot.revision, {
      type: envelope.command.type,
      clientId: envelope.clientId,
      commandId: envelope.commandId,
      result: mutation.result,
      snapshot,
    })
    this.receipts.set(key, { clientId: envelope.clientId, commandId: envelope.commandId, requestHash: hash, response })
    while (this.receipts.size > this.receiptLimit) {
      const oldest = this.receipts.keys().next().value
      if (oldest === undefined) break
      this.receipts.delete(oldest)
    }

    try {
      this.persist?.({
        snapshot,
        events: this.eventLog.getEvents(),
        receipts: this.getReceipts(),
      })
    } catch (error) {
      this.state.restore(current)
      this.eventLog.restore(previousEvents)
      this.receipts.clear()
      for (const receipt of previousReceipts) {
        this.receipts.set(`${receipt.clientId}\0${receipt.commandId}`, receipt)
      }
      throw error
    }

    for (const listener of this.listeners) listener(event)
    return structuredClone(response)
  }

  private apply(
    current: EnvironmentSnapshot<Workspace>,
    command: EnvironmentCommand,
  ): { next: Omit<EnvironmentSnapshot<Workspace>, 'serverId' | 'revision'>; result: unknown } {
    const workspace = structuredClone(current.workspace)
    const sessions = structuredClone(current.sessions)
    const ptys = structuredClone(current.ptys)
    let result: unknown = { success: true }

    switch (command.type) {
      case 'replace-workspace':
        return { next: { workspace: preserveCanonicalTabIdentity(current.workspace, command.workspace), sessions, ptys }, result }
      case 'create-workspace':
        if ((workspace.sessions ?? []).some(candidate => candidate.id === command.workspace.id)) {
          throw new Error(`Workspace ${command.workspace.id} already exists`)
        }
        workspace.sessions = [...(workspace.sessions ?? []), structuredClone(command.workspace)]
        workspace.activeSessionId = command.workspace.id
        result = { workspaceId: command.workspace.id }
        break
      case 'rename-workspace': {
        const target = cloneWorkspaceSession(workspace, command.workspaceId)
        target.name = command.name
        break
      }
      case 'delete-workspace':
        workspace.sessions = (workspace.sessions ?? []).filter(candidate => candidate.id !== command.workspaceId)
        if (workspace.activeSessionId === command.workspaceId) {
          workspace.activeSessionId = workspace.sessions[0]?.id ?? null
        }
        break
      case 'create-tile': {
        const target = cloneWorkspaceSession(workspace, command.workspaceId)
        target.tileTree = target.tileTree
          ? {
              type: 'branch',
              id: `branch-${command.tile.id}`,
              direction: command.direction ?? 'horizontal',
              children: [target.tileTree, structuredClone(command.tile)],
            }
          : structuredClone(command.tile)
        target.activeTabId = command.tile.activeTabId ?? target.activeTabId
        result = { tileId: command.tile.id }
        break
      }
      case 'close-tile': {
        const target = cloneWorkspaceSession(workspace, command.workspaceId)
        target.tileTree = removeTile(target.tileTree, command.tileId)
        break
      }
      case 'move-tile': {
        const target = cloneWorkspaceSession(workspace, command.workspaceId)
        target.tileTree = structuredClone(command.tileTree)
        break
      }
      case 'focus-tile': {
        const target = cloneWorkspaceSession(workspace, command.workspaceId)
        const focused = focusTile(target.tileTree, command.tileId, command.tabId)
        target.tileTree = focused.node
        if (focused.focusedTabId) target.activeTabId = focused.focusedTabId
        workspace.activeSessionId = command.workspaceId
        break
      }
      case 'create-session':
      case 'start-new-session': {
        if (sessions.some(session => session.agentSessionId === command.session.agentSessionId)) {
          throw new Error(`Session ${command.session.agentSessionId} already exists`)
        }
        if (command.session.serverId !== current.serverId) throw new Error('Session serverId does not match environment')
        sessions.push(structuredClone(command.session))
        if (command.type === 'start-new-session' || (command.workspaceId && command.tab)) {
          const target = cloneWorkspaceSession(workspace, command.workspaceId!)
          target.openTabs = [...(target.openTabs ?? []), structuredClone(command.tab!)]
          target.activeTabId = command.tab!.id
          workspace.activeSessionId = command.workspaceId!
        }
        result = { agentSessionId: command.session.agentSessionId }
        break
      }
      case 'attach-session': {
        const session = sessions.find(candidate => candidate.agentSessionId === command.agentSessionId)
        if (!session) throw new Error(`Session ${command.agentSessionId} not found`)
        session.runtimeId = command.runtimeId
        session.ptyId = command.ptyId
        session.lifecycle = 'running'
        // Workspace tabs keep stable canonical identity while PTY identity is
        // replaced after a backend restart. Publish that runtime rebind in the
        // same authoritative mutation so every frontend attaches to the new
        // PTY instead of repeatedly saving the stale one back.
        for (const workspaceSession of workspace.sessions ?? []) {
          for (const tab of workspaceSession.openTabs ?? []) {
            if (tab.agentSessionId === command.agentSessionId || tab.id === command.agentSessionId) {
              tab.agentSessionId = command.agentSessionId
              tab.ptyId = command.ptyId
            }
          }
        }
        const existingPty = ptys.find(candidate => candidate.ptyId === command.ptyId)
        if (!existingPty) {
          ptys.push({
            ptyId: command.ptyId,
            runtimeId: command.runtimeId,
            agentSessionId: command.agentSessionId,
            serverId: current.serverId,
            lifecycle: 'running',
          })
        }
        result = { agentSessionId: command.agentSessionId, ptyId: command.ptyId }
        break
      }
      case 'stop-session': {
        const session = sessions.find(candidate => candidate.agentSessionId === command.agentSessionId)
        if (!session) throw new Error(`Session ${command.agentSessionId} not found`)
        session.lifecycle = 'stopped'
        session.runtimeId = undefined
        if (session.ptyId) {
          const pty = ptys.find(candidate => candidate.ptyId === session.ptyId)
          if (pty) pty.lifecycle = 'stopped'
        }
        session.ptyId = undefined
        break
      }
      case 'update-project': {
        const project = workspace.projects.find(candidate => candidate.path === command.projectPath)
        if (!project) throw new Error(`Project ${command.projectPath} not found`)
        Object.assign(project, structuredClone(command.updates), { path: project.path })
        break
      }
      case 'set-active-workspace':
        cloneWorkspaceSession(workspace, command.workspaceId)
        workspace.activeSessionId = command.workspaceId
        break
      case 'set-active-session': {
        const target = cloneWorkspaceSession(workspace, command.workspaceId)
        const session = sessions.find(candidate => candidate.agentSessionId === command.agentSessionId)
        if (!session) throw new Error(`Session ${command.agentSessionId} not found`)
        const tab = target.openTabs.find(candidate => candidate.sessionId === command.agentSessionId || candidate.id === session.ptyId)
        if (tab) target.activeTabId = tab.id
        workspace.activeSessionId = command.workspaceId
        break
      }
    }

    return { next: { workspace, sessions, ptys }, result }
  }
}

function preserveCanonicalTabIdentity(current: Workspace, replacement: Workspace): Workspace {
  const next = structuredClone(replacement)
  const currentSessions = new Map((current.sessions ?? []).map(session => [session.id, session]))
  for (const session of next.sessions ?? []) {
    const previous = currentSessions.get(session.id)
    if (!previous) continue
    const previousTabs = new Map((previous.openTabs ?? []).map(tab => [tab.agentSessionId ?? tab.id, tab]))
    session.openTabs = (session.openTabs ?? []).map(tab => {
      const old = previousTabs.get(tab.agentSessionId ?? tab.id)
      if (!old) return tab
      return {
        ...tab,
        agentSessionId: old.agentSessionId ?? tab.agentSessionId,
        sessionId: old.sessionId ?? tab.sessionId,
        harnessId: old.harnessId ?? tab.harnessId,
      }
    })
  }
  return next
}