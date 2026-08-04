import type {
  CanonicalPty,
  CanonicalSession,
  EnvironmentSnapshot,
} from '../common/environment-protocol.js'
import type { Workspace } from './session-store.js'

export interface PersistedEnvironmentSnapshot {
  serverId: string
  revision: number
  workspace: Workspace
  sessions: CanonicalSession[]
  ptys: CanonicalPty[]
}

function initialCanonicalSessions(serverId: string, workspace: Workspace): CanonicalSession[] {
  const sessions = new Map<string, CanonicalSession>()
  const workspaceSessions = workspace.sessions ?? []
  const legacyTabs = workspace.openTabs ?? []
  const allTabs = [...legacyTabs, ...workspaceSessions.flatMap(session => session.openTabs ?? [])]

  for (const tab of allTabs) {
    const agentSessionId = tab.agentSessionId || tab.sessionId || tab.id
    if (!agentSessionId || sessions.has(agentSessionId)) continue
    const harnessId = tab.harnessId === 'default' || !tab.harnessId ? 'claude' : tab.harnessId
    sessions.set(agentSessionId, {
      agentSessionId,
      serverId,
      harnessId,
      nativeSessionId: tab.sessionId,
      projectId: tab.projectPath,
      lifecycle: 'stopped',
    })
  }

  return [...sessions.values()]
}

export class EnvironmentState {
  private snapshot: EnvironmentSnapshot<Workspace>

  constructor(
    serverId: string,
    workspace: Workspace,
    persisted?: PersistedEnvironmentSnapshot,
  ) {
    this.snapshot = persisted && persisted.serverId === serverId
      ? {
          ...structuredClone(persisted),
          sessions: persisted.sessions.map(session => ({
            ...structuredClone(session),
            runtimeId: undefined,
            ptyId: undefined,
            lifecycle: 'stopped',
          })),
          // OS PTYs do not survive a DonutCode Server process restart. Never
          // advertise persisted process IDs as attachable live runtimes.
          ptys: [],
        }
      : {
          serverId,
          revision: 0,
          workspace: structuredClone(workspace),
          sessions: initialCanonicalSessions(serverId, workspace),
          ptys: [],
        }
  }

  getSnapshot(): EnvironmentSnapshot<Workspace> {
    return structuredClone(this.snapshot)
  }

  commit(next: Omit<EnvironmentSnapshot<Workspace>, 'serverId' | 'revision'>): EnvironmentSnapshot<Workspace> {
    this.snapshot = {
      serverId: this.snapshot.serverId,
      revision: this.snapshot.revision + 1,
      workspace: structuredClone(next.workspace),
      sessions: structuredClone(next.sessions),
      ptys: structuredClone(next.ptys),
    }
    return this.getSnapshot()
  }

  restore(snapshot: EnvironmentSnapshot<Workspace>): void {
    if (snapshot.serverId !== this.snapshot.serverId) {
      throw new Error(`Cannot restore environment for server ${snapshot.serverId}`)
    }
    this.snapshot = structuredClone(snapshot)
  }
}
