import type { WorkspaceSession } from './workspace'
import type { SavedWorkspaceSession, OpenTab } from '../api/types'
import type { Api, Workspace } from '../api/types'
import type { EnvironmentEvent, EnvironmentSnapshot } from '../../common/environment-protocol.js'
import type { EventEnvelope } from '../../common/server-protocol.js'

interface EnvironmentCursor {
  serverId: string
  revision: number
}

let environmentCursor: EnvironmentCursor | null = null
let saveQueue: Promise<void> = Promise.resolve()
const rendererClientId = `renderer-${crypto.randomUUID()}`
let environmentEpoch = 0

export class EnvironmentCacheInvalidatedError extends Error {
  constructor() {
    super('The server changed before this workspace save could be applied')
    this.name = 'EnvironmentCacheInvalidatedError'
  }
}

export function cacheEnvironmentSnapshot(snapshot: EnvironmentSnapshot<Workspace>): void {
  environmentCursor = { serverId: snapshot.serverId, revision: snapshot.revision }
}

export function getEnvironmentCursor(): EnvironmentCursor | null {
  return environmentCursor ? { ...environmentCursor } : null
}

export function resetEnvironmentPersistenceForTests(): void {
  environmentCursor = null
  saveQueue = Promise.resolve()
  environmentEpoch = 0
}

export function observeEnvironmentRevision(serverId: string, revision: number): boolean {
  if (!environmentCursor || environmentCursor.serverId !== serverId) return false
  if (revision <= environmentCursor.revision) return true
  if (revision !== environmentCursor.revision + 1) return false
  environmentCursor = { serverId, revision }
  return true
}

export async function loadAuthoritativeWorkspace(api: Api): Promise<Workspace> {
  if (!api.getEnvironmentSnapshot) return api.getWorkspace()
  const snapshot = await api.getEnvironmentSnapshot()
  cacheEnvironmentSnapshot(snapshot)
  return snapshot.workspace
}

/** Resolve an ordered server event, recovering any cursor gap before applying it. */
export async function resolveAuthoritativeEnvironmentEvent(
  api: Api,
  event: EventEnvelope<EnvironmentEvent<Workspace>>,
): Promise<EnvironmentSnapshot<Workspace> | null> {
  const cursor = environmentCursor
  if (cursor && cursor.serverId === event.serverId && event.revision <= cursor.revision) return null

  if (event.event.clientId !== rendererClientId) environmentEpoch += 1

  const eventSnapshot = event.event.snapshot
  if (
    cursor
    && cursor.serverId === event.serverId
    && event.revision === cursor.revision + 1
    && eventSnapshot?.serverId === event.serverId
    && eventSnapshot.revision === event.revision
  ) {
    cacheEnvironmentSnapshot(eventSnapshot)
    return eventSnapshot
  }

  if (cursor && cursor.serverId === event.serverId && api.getEnvironmentEvents) {
    const catchUp = await api.getEnvironmentEvents(cursor.revision)
    const snapshot = catchUp.mode === 'snapshot'
      ? catchUp.snapshot
      : catchUp.events?.at(-1)?.event.snapshot
    if (snapshot) {
      cacheEnvironmentSnapshot(snapshot)
      return snapshot
    }
  }

  if (!api.getEnvironmentSnapshot) return null
  const snapshot = await api.getEnvironmentSnapshot()
  cacheEnvironmentSnapshot(snapshot)
  return snapshot
}

export function saveAuthoritativeWorkspace(api: Api, workspace: Workspace): Promise<void> {
  const requestedEpoch = environmentEpoch
  const operation = saveQueue.then(async () => {
    if (!api.executeEnvironmentCommand || !api.getEnvironmentSnapshot) {
      await api.saveWorkspace(workspace)
      return
    }

    if (!environmentCursor) {
      cacheEnvironmentSnapshot(await api.getEnvironmentSnapshot())
    }
    if (requestedEpoch !== environmentEpoch) throw new EnvironmentCacheInvalidatedError()
    const cursor = environmentCursor!
    try {
      const response = await api.executeEnvironmentCommand({
        clientId: rendererClientId,
        commandId: crypto.randomUUID(),
        serverId: cursor.serverId,
        expectedRevision: cursor.revision,
        command: { type: 'replace-workspace', workspace },
      })
      environmentCursor = { serverId: response.serverId, revision: response.revision }
    } catch (error) {
      // Never retry the stale full-workspace payload at a newer revision. Refresh
      // only the disposable cursor/cache and let the caller reconcile explicitly.
      cacheEnvironmentSnapshot(await api.getEnvironmentSnapshot())
      throw error
    }
  })
  saveQueue = operation.catch(() => undefined)
  return operation
}

function normalizeTabForSave(tab: any): OpenTab {
  const { backend, ...current } = tab
  return {
    ...current,
    harnessId: current.harnessId ?? backend,
  } as OpenTab
}

// Inactive workspaces are restored lazily — their live openTabs/tileTree are
// empty until the user switches into them. Round-trip their on-disk savedData
// so the save effect doesn't flush every unswitched workspace to empty.
export function serializeSessionsForSave(
  sessions: WorkspaceSession[]
): SavedWorkspaceSession[] {
  return sessions.map(s => {
    if (!s.isRestored && s.savedData) {
      return {
        id: s.id,
        name: s.name,
        openTabs: (s.savedData.openTabs ?? []).map(normalizeTabForSave),
        activeTabId: s.savedData.activeTabId ?? null,
        tileTree: s.savedData.tileTree ?? undefined,
        canvasScene: s.savedData.canvasScene,
        activeView: s.savedData.activeView ?? 'tiles',
      }
    }
    return {
      id: s.id,
      name: s.name,
      openTabs: s.openTabs.map(t => normalizeTabForSave({
        id: t.id,
        projectPath: t.projectPath,
        sessionId: t.sessionId,
        title: t.title,
        customTitle: t.customTitle || undefined,
        ptyId: t.ptyId,
        harnessId: t.harnessId ?? t.backend,
      })) as OpenTab[],
      activeTabId: s.activeTabId,
      tileTree: s.activeTileTree || undefined,
      canvasScene: s.preservedCanvasScene ?? s.canvasScene ?? undefined,
      activeView: s.preservedCanvasScene === undefined ? s.activeView : 'tiles',
    }
  })
}
