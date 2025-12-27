import React from 'react'
import { OpenTab } from '../stores/workspace'

interface TerminalTabsProps {
  tabs: OpenTab[]
  activeTabId: string | null
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
}

export function TerminalTabs({ tabs, activeTabId, onSelectTab, onCloseTab }: TerminalTabsProps) {
  return (
    <div className="tabs-bar">
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
