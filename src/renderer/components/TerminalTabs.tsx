import React, { useCallback } from 'react'
import { OpenTab } from '../stores/workspace'

interface TerminalTabsProps {
  tabs: OpenTab[]
  activeTabId: string | null
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
}

export function TerminalTabs({ tabs, activeTabId, onSelectTab, onCloseTab }: TerminalTabsProps) {
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (tabs.length <= 1) return

    const currentIndex = tabs.findIndex(t => t.id === activeTabId)
    if (currentIndex === -1) return

    // Scroll down (positive deltaY) = next tab, scroll up = previous tab
    const direction = e.deltaY > 0 ? 1 : -1
    const newIndex = (currentIndex + direction + tabs.length) % tabs.length
    onSelectTab(tabs[newIndex].id)
  }, [tabs, activeTabId, onSelectTab])

  return (
    <div className="tabs-bar" onWheel={handleWheel}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => onSelectTab(tab.id)}
        >
          <span className="tab-title" title={tab.title}>{tab.title}</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              onCloseTab(tab.id)
            }}
            title="Close tab"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
