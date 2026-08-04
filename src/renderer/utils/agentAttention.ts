import { getAllLeaves } from '../components/tile-tree'
import { tabResourceKey, type WorkspaceSession } from '../stores/workspace'

export function getVisibleTabIds(
  sessions: WorkspaceSession[],
  activeSessionId: string | null,
  isMobile: boolean,
): Set<string> {
  const active = sessions.find(session => session.id === activeSessionId)
  if (!active) return new Set()
  const keysFor = (tabIds: string[]): Set<string> => new Set(tabIds.flatMap(tabId => {
    const tab = active.openTabs.find(candidate => candidate.id === tabId)
    return tab ? [tabResourceKey(tab)] : []
  }))
  if (isMobile) return keysFor(active.activeTabId ? [active.activeTabId] : [])

  if (active.activeView === 'canvas') {
    return keysFor((active.canvasScene?.nodes ?? []).map(node => node.activeTabId).filter(Boolean))
  }

  if (!active.activeTileTree) return keysFor(active.activeTabId ? [active.activeTabId] : [])
  return keysFor(getAllLeaves(active.activeTileTree).map(leaf => leaf.activeTabId).filter(Boolean))
}

export function getActuallyVisibleTabIds(fallback: Set<string>): Set<string> {
  if (typeof document === 'undefined') return fallback
  if (document.hidden) return new Set()

  const elements = [...document.querySelectorAll<HTMLElement>('[data-agent-visible-tab-id]')]
  if (elements.length === 0) return fallback

  return new Set(elements.flatMap(element => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const visible = style.display !== 'none'
      && style.visibility !== 'hidden'
      && rect.width > 0
      && rect.height > 0
      && rect.right > 0
      && rect.bottom > 0
      && rect.left < window.innerWidth
      && rect.top < window.innerHeight
    return visible && element.dataset.agentVisibleTabId
      ? [element.dataset.agentVisibleTabId]
      : []
  }))
}

export function findTabByPtyId(sessions: WorkspaceSession[], serverId: string, ptyId: string): string | null {
  for (const session of sessions) {
    const tab = session.openTabs.find(candidate => candidate.serverId === serverId && candidate.ptyId === ptyId)
    if (tab) return tabResourceKey(tab)
  }
  return null
}
