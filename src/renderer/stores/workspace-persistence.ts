import type { WorkspaceSession } from './workspace'
import type { SavedWorkspaceSession, OpenTab } from '../api/types'
import type { Api, Workspace } from '../api/types'
import type { EnvironmentEvent, EnvironmentSnapshot } from '../../common/environment-protocol.js'
import type { EventEnvelope } from '../../common/server-protocol.js'
import { remapTabIds } from '../components/tile-tree.js'
import { remapSceneTabIds } from '../components/canvas/index.js'

interface EnvironmentCursor {
  serverId: string
  revision: number
}

interface EnvironmentPersistenceState {
  cursor: EnvironmentCursor | null
  saveQueue: Promise<void>
  epoch: number
}

/**
 * Set when an authoritative server snapshot was just applied to the store.
 * The workspace-save effect consumes this so that applying the server's own
 * echo (including from a second subscriber such as runtime-connections) does
 * not bounce a redundant replace-workspace back — which would emit another
 * event and loop forever (observed ~50 commands/sec).
 *
 * A counter per server (not a single global boolean): both subscribers may
 * apply the same snapshot in separate microtask ticks, each effect run must
 * be suppressed once, and the save effect iterates every connected server —
 * an authoritative apply for server A must not suppress a genuine local state
 * change for server B.
 */
const suppressAuthoritativeSaveByServer = new Map<string, number>()

/**
 * Serialized fingerprint of each server's workspace slice as last applied from
 * an authoritative snapshot (or last saved). The save effect skips a server
 * whose slice is unchanged — this stops the cross-server save ping-pong where
 * server A's save echo re-triggers a redundant save of server B, whose echo
 * re-triggers A, forever. With tabs routed to their origin server's session
 * the slices are disjoint, so the fingerprint stabilizes after one save.
 */
const baselineFingerprintByServer = new Map<string, string>()
const authoritativeActiveSessionByServer = new Map<string, string | null>()

export function recordAuthoritativeBaseline(serverId: string, workspace: Workspace): void {
  baselineFingerprintByServer.set(serverId, fingerprintWorkspace(workspace))
  authoritativeActiveSessionByServer.set(serverId, workspace.activeSessionId ?? null)
}

export function getBaselineFingerprint(serverId: string): string | undefined {
  return baselineFingerprintByServer.get(serverId)
}

export function getAuthoritativeActiveSessionId(serverId: string): string | null {
  return authoritativeActiveSessionByServer.get(serverId) ?? null
}

function isRevisionConflict(error: unknown): boolean {
  return error instanceof Error && /^Expected environment revision \d+, current revision is \d+$/.test(error.message)
}

function fingerprintWorkspace(workspace: Workspace): string {
  // Normalize to the exact shape the save effect compares — explicit key order
  // and fields, so a server-side representation difference can never make the
  // guard mismatch (which would loop the save forever).
  return JSON.stringify({
    projects: workspace.projects ?? [],
    categories: workspace.categories ?? [],
    sessions: workspace.sessions ?? [],
    activeSessionId: workspace.activeSessionId ?? null,
  })
}

export function markAuthoritativeSaveSuppressed(serverId: string): void {
  suppressAuthoritativeSaveByServer.set(serverId, (suppressAuthoritativeSaveByServer.get(serverId) ?? 0) + 1)
}

export function consumeAuthoritativeSaveSuppression(serverId: string): boolean {
  const count = suppressAuthoritativeSaveByServer.get(serverId) ?? 0
  if (count > 0) {
    if (count === 1) suppressAuthoritativeSaveByServer.delete(serverId)
    else suppressAuthoritativeSaveByServer.set(serverId, count - 1)
    return true
  }
  return false
}

const environmentPersistenceByServer = new Map<string, EnvironmentPersistenceState>()
const rendererClientId = `renderer-${crypto.randomUUID()}`

function getPersistenceState(serverId: string): EnvironmentPersistenceState {
  let state = environmentPersistenceByServer.get(serverId)
  if (!state) {
    state = { cursor: null, saveQueue: Promise.resolve(), epoch: 0 }
    environmentPersistenceByServer.set(serverId, state)
  }
  return state
}

function assertServerIdentity(expectedServerId: string, actualServerId: string, source: string): void {
  if (actualServerId !== expectedServerId) {
    throw new Error(`${source} returned server ${actualServerId}; expected ${expectedServerId}`)
  }
}

function assertApiServer(api: Api, serverId: string): void {
  const actualServerId = api.getServerProtocol?.()?.serverId
  if (!actualServerId) throw new Error(`Server ${serverId} has no established protocol identity`)
  assertServerIdentity(serverId, actualServerId, 'API')
}

export class EnvironmentCacheInvalidatedError extends Error {
  constructor() {
    super('The server changed before this workspace save could be applied')
    this.name = 'EnvironmentCacheInvalidatedError'
  }
}

export function cacheEnvironmentSnapshot(snapshot: EnvironmentSnapshot<Workspace>): void {
  const state = getPersistenceState(snapshot.serverId)
  state.cursor = { serverId: snapshot.serverId, revision: snapshot.revision }
}

export function getEnvironmentCursor(serverId: string): EnvironmentCursor | null {
  const cursor = environmentPersistenceByServer.get(serverId)?.cursor
  return cursor ? { ...cursor } : null
}

export function resetEnvironmentPersistenceForTests(): void {
  environmentPersistenceByServer.clear()
  suppressAuthoritativeSaveByServer.clear()
  baselineFingerprintByServer.clear()
  authoritativeActiveSessionByServer.clear()
}

export function observeEnvironmentRevision(serverId: string, revision: number): boolean {
  const state = getPersistenceState(serverId)
  if (!state.cursor) return false
  if (revision <= state.cursor.revision) return true
  if (revision !== state.cursor.revision + 1) return false
  state.cursor = { serverId, revision }
  return true
}

export async function loadAuthoritativeWorkspace(api: Api, serverId: string): Promise<Workspace> {
  assertApiServer(api, serverId)
  if (!api.getEnvironmentSnapshot) return api.getWorkspace()
  const snapshot = await api.getEnvironmentSnapshot()
  assertServerIdentity(serverId, snapshot.serverId, 'Environment snapshot')
  cacheEnvironmentSnapshot(snapshot)
  recordAuthoritativeBaseline(serverId, snapshot.workspace)
  markAuthoritativeSaveSuppressed(serverId)
  return snapshot.workspace
}

/** Resolve an ordered server event, recovering any cursor gap before applying it. */
export async function resolveAuthoritativeEnvironmentEvent(
  api: Api,
  serverId: string,
  event: EventEnvelope<EnvironmentEvent<Workspace>>,
): Promise<EnvironmentSnapshot<Workspace> | null> {
  assertApiServer(api, serverId)
  assertServerIdentity(serverId, event.serverId, 'Environment event')
  const state = getPersistenceState(serverId)
  const cursor = state.cursor
  if (cursor && event.revision <= cursor.revision) return null

  if (event.event.clientId !== rendererClientId) state.epoch += 1

  const eventSnapshot = event.event.snapshot
  if (
    cursor
    && event.revision === cursor.revision + 1
    && eventSnapshot?.serverId === event.serverId
    && eventSnapshot.revision === event.revision
  ) {
    cacheEnvironmentSnapshot(eventSnapshot)
    recordAuthoritativeBaseline(serverId, eventSnapshot.workspace)
    markAuthoritativeSaveSuppressed(serverId)
    return eventSnapshot
  }

  if (cursor && cursor.serverId === event.serverId && api.getEnvironmentEvents) {
    const catchUp = await api.getEnvironmentEvents(cursor.revision)
    const snapshot = catchUp.mode === 'snapshot'
      ? catchUp.snapshot
      : catchUp.events?.at(-1)?.event.snapshot
    if (snapshot) {
      assertServerIdentity(serverId, snapshot.serverId, 'Environment catch-up')
      cacheEnvironmentSnapshot(snapshot)
      recordAuthoritativeBaseline(serverId, snapshot.workspace)
      markAuthoritativeSaveSuppressed(serverId)
      return snapshot
    }
  }

  if (!api.getEnvironmentSnapshot) return null
  const snapshot = await api.getEnvironmentSnapshot()
  assertServerIdentity(serverId, snapshot.serverId, 'Environment snapshot')
  cacheEnvironmentSnapshot(snapshot)
  recordAuthoritativeBaseline(serverId, snapshot.workspace)
  markAuthoritativeSaveSuppressed(serverId)
  return snapshot
}

export function saveAuthoritativeWorkspace(api: Api, serverId: string, workspace: Workspace): Promise<void> {
  assertApiServer(api, serverId)
  const state = getPersistenceState(serverId)
  const requestedEpoch = state.epoch
  const operation = state.saveQueue.then(async () => {
    if (!api.executeEnvironmentCommand || !api.getEnvironmentSnapshot) {
      await api.saveWorkspace(workspace)
      return
    }

    if (!state.cursor) {
      const snapshot = await api.getEnvironmentSnapshot()
      assertServerIdentity(serverId, snapshot.serverId, 'Environment snapshot')
      cacheEnvironmentSnapshot(snapshot)
    }
    if (requestedEpoch !== state.epoch) throw new EnvironmentCacheInvalidatedError()

    // The server's own runtime registry commits create-session/attach-session
    // (and stop-session) as it spawns PTYs, advancing the revision without the
    // renderer seeing it first. Those commits do NOT change workspace content
    // (they write the top-level sessions array), so a revision conflict here is
    // almost always that race — retry once at the freshly-read cursor. If the
    // workspace content really changed under us, the retry conflicts again and
    // we stop, preserving the "never replay a stale payload" guarantee.
    let attempts = 0
    for (;;) {
      try {
        const cursor = state.cursor!
        const response = await api.executeEnvironmentCommand({
          clientId: rendererClientId,
          commandId: crypto.randomUUID(),
          serverId,
          expectedRevision: cursor.revision,
          command: { type: 'replace-workspace', workspace },
        })
        assertServerIdentity(serverId, response.serverId, 'Environment command')
        state.cursor = { serverId, revision: response.revision }
        recordAuthoritativeBaseline(serverId, workspace)
        break
      } catch (error) {
        if (attempts >= 1) throw error
        attempts += 1
        // Refresh the cursor from the server's current snapshot so subsequent
        // saves work even if we stop here. Without this, a single conflict
        // leaves the cursor stale forever and every later save fails.
        const snapshot = await api.getEnvironmentSnapshot()
        assertServerIdentity(serverId, snapshot.serverId, 'Environment snapshot')
        cacheEnvironmentSnapshot(snapshot)
        // Retry only for revision conflicts that came from the server's own
        // runtime-registry commits (create/attach/stop-session advance the
        // revision without touching workspace content). If the workspace
        // CONTENT changed since our last successful save, another client wrote
        // it — replaying our payload would clobber that write, so stop (never
        // replay a stale payload).
        if (!isRevisionConflict(error)) throw error
        if (fingerprintWorkspace(snapshot.workspace) !== getBaselineFingerprint(serverId)) throw error
      }
    }
  })
  state.saveQueue = operation.catch(() => undefined)
  return operation
}

function normalizeTabForSave(tab: any): OpenTab {
  const { backend, serverId: _serverId, authorityTabId, ...current } = tab
  return {
    ...current,
    id: authorityTabId ?? current.id,
    harnessId: current.harnessId ?? backend,
  } as OpenTab
}

// Inactive workspaces are restored lazily — their live openTabs/tileTree are
// empty until the user switches into them. Round-trip their on-disk savedData
// so the save effect doesn't flush every unswitched workspace to empty.
export function serializeSessionsForSave(
  sessions: WorkspaceSession[],
  serverId: string,
): SavedWorkspaceSession[] {
  return sessions
    .filter(session => session.serverId === serverId || session.openTabs.some(tab => tab.serverId === serverId))
    .map(s => {
    const authoritySessionId = s.serverId === serverId ? s.authoritySessionId : s.id
    if (!s.isRestored && s.savedData) {
      const openTabs = (s.savedData.openTabs ?? [])
        .filter((tab: OpenTab) => tab.serverId === serverId)
        .map(normalizeTabForSave)
      return {
        id: authoritySessionId,
        name: s.name,
        openTabs,
        activeTabId: openTabs.some(tab => tab.id === s.savedData!.activeTabId) ? s.savedData.activeTabId : openTabs[0]?.id ?? null,
        tileTree: s.savedData.tileTree ?? undefined,
        canvasScene: s.savedData.canvasScene,
        activeView: s.savedData.activeView ?? 'tiles',
      }
    }
    const serverTabs = [...new Map(s.openTabs
      .filter(tab => tab.serverId === serverId)
      .map(tab => [tab.authorityTabId ?? tab.id, tab])).values()]
    const openTabs = serverTabs
      .map(t => normalizeTabForSave({
        serverId: t.serverId,
        authorityTabId: t.authorityTabId,
        id: t.id,
        projectPath: t.projectPath,
        agentSessionId: t.agentSessionId,
        sessionId: t.sessionId,
        title: t.title,
        customTitle: t.customTitle || undefined,
        ptyId: t.ptyId,
        harnessId: t.harnessId ?? t.backend,
      })) as OpenTab[]
    const tabIdMapping = new Map(serverTabs
      .map(tab => [tab.id, tab.authorityTabId ?? tab.id]))
    const tileTree = s.activeTileTree?.type ? remapTabIds(s.activeTileTree, tabIdMapping) : s.activeTileTree || undefined
    const canvasScene = s.preservedCanvasScene
      ?? (s.canvasScene ? remapSceneTabIds(s.canvasScene, Object.fromEntries(tabIdMapping)) : undefined)
    const activeTabId = s.activeTabId ? tabIdMapping.get(s.activeTabId) ?? null : null
    return {
      id: authoritySessionId,
      name: s.name,
      openTabs,
      activeTabId: activeTabId && openTabs.some(tab => tab.id === activeTabId) ? activeTabId : openTabs[0]?.id ?? null,
      tileTree,
      canvasScene,
      activeView: s.preservedCanvasScene === undefined ? s.activeView : 'tiles',
    }
  })
}
