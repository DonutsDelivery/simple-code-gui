import { getAllLeaves } from '../components/tile-tree'
import type { WorkspaceSession } from '../stores/workspace'

export function getVisibleTabIds(
  sessions: WorkspaceSession[],
  activeSessionId: string | null,
  isMobile: boolean,
): Set<string> {
  const active = sessions.find(session => session.id === activeSessionId)
  if (!active) return new Set()
  if (isMobile) return new Set(active.activeTabId ? [active.activeTabId] : [])

  if (active.activeView === 'canvas') {
    return new Set((active.canvasScene?.nodes ?? []).map(node => node.activeTabId).filter(Boolean))
  }

  if (!active.activeTileTree) return new Set(active.activeTabId ? [active.activeTabId] : [])
  return new Set(getAllLeaves(active.activeTileTree).map(leaf => leaf.activeTabId).filter(Boolean))
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

export function findTabByPtyId(sessions: WorkspaceSession[], ptyId: string): string | null {
  for (const session of sessions) {
    const tab = session.openTabs.find(candidate => candidate.ptyId === ptyId)
    if (tab) return tab.id
  }
  return null
}
