import type { WorkspaceSession } from './workspace'
import type { SavedWorkspaceSession, OpenTab } from '../api/types'

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
        openTabs: (s.savedData.openTabs ?? []) as OpenTab[],
        activeTabId: s.savedData.activeTabId ?? null,
        tileTree: s.savedData.tileTree ?? undefined,
      }
    }
    return {
      id: s.id,
      name: s.name,
      openTabs: s.openTabs.map(t => ({
        id: t.id,
        projectPath: t.projectPath,
        sessionId: t.sessionId,
        title: t.title,
        customTitle: t.customTitle || undefined,
        ptyId: t.ptyId,
        backend: t.backend,
      })) as OpenTab[],
      activeTabId: s.activeTabId,
      tileTree: s.activeTileTree || undefined,
    }
  })
}
