/**
 * MobileTerminalBar Component
 *
 * Static bottom bar for mobile terminals with horizontal scrolling.
 * Contains quick input buttons and menu categories.
 */

import React, { useState, useRef } from 'react'
import { CommandMenuItem, getCommandMenuItems } from '../../utils/backendCommands'

interface MobileTerminalBarProps {
  onInput: (data: string) => void
  onCommand: (command: string) => void
  currentBackend: string
  onBackendChange: (backend: string) => void
}

// Key codes
const CTRL_C = '\x03'
const ARROW_UP = '\x1b[A'
const ARROW_DOWN = '\x1b[B'
const TAB = '\t'
const ESCAPE = '\x1b'
const ENTER = '\r'

interface MenuItem {
  id: string
  label: string
  disabled?: boolean
}

interface MenuCategory {
  id: string
  label: string
  icon: string
  items: MenuItem[]
}

export function MobileTerminalBar({
  onInput,
  onCommand,
  currentBackend,
  onBackendChange
}: MobileTerminalBarProps): React.ReactElement {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const commandItems = getCommandMenuItems(currentBackend)

  const menuCategories: MenuCategory[] = [
    {
      id: 'commands',
      label: 'Commands',
      icon: '/',
      items: commandItems.filter(item => !item.id.startsWith('divider')),
    },
    {
      id: 'gsd',
      label: 'GSD',
      icon: '📋',
      items: [
        { id: 'gsd:progress', label: 'Check Progress' },
        { id: 'gsd:execute-phase', label: 'Execute Phase' },
        { id: 'gsd:plan-phase', label: 'Plan Phase' },
        { id: 'gsd:new-project', label: 'New Project' },
        { id: 'gsd:map-codebase', label: 'Map Codebase' },
        { id: 'gsd:create-roadmap', label: 'Create Roadmap' },
        { id: 'gsd:resume-work', label: 'Resume Work' },
        { id: 'gsd:pause-work', label: 'Pause Work' },
        { id: 'gsd:help', label: 'Help' },
      ],
    },
    {
      id: 'session',
      label: 'Session',
      icon: '⚡',
      items: [
        { id: 'summarize', label: 'Summarize Context' },
        { id: 'cancel', label: 'Cancel Request' },
      ],
    },
    {
      id: 'backend',
      label: 'Backend',
      icon: '🔧',
      items: [
        { id: 'claude', label: 'Claude' },
        { id: 'gemini', label: 'Gemini' },
        { id: 'codex', label: 'Codex' },
        { id: 'opencode', label: 'OpenCode' },
        { id: 'aider', label: 'Aider' },
      ],
    },
  ]

  const handleMenuItemClick = (categoryId: string, item: MenuItem) => {
    if (item.disabled) return

    if (categoryId === 'backend') {
      onBackendChange(item.id)
    } else if (categoryId === 'gsd') {
      onCommand(`/${item.id}`)
    } else if (categoryId === 'commands') {
      onCommand(item.id)
    } else {
      onCommand(item.id)
    }
    setOpenMenu(null)
  }

  const toggleMenu = (categoryId: string) => {
    setOpenMenu(openMenu === categoryId ? null : categoryId)
  }

  return (
    <div className="mobile-terminal-bar">
      {/* Scrollable content */}
      <div className="mobile-terminal-bar-scroll">
        {/* Quick input buttons */}
        <button
          className="mobile-bar-btn mobile-bar-btn--danger"
          onClick={() => onInput(CTRL_C)}
          title="Interrupt (Ctrl+C)"
        >
          ^C
        </button>
        <button
          className="mobile-bar-btn"
          onClick={() => onInput(ARROW_UP)}
          title="Previous command"
        >
          ↑
        </button>
        <button
          className="mobile-bar-btn"
          onClick={() => onInput(ARROW_DOWN)}
          title="Next command"
        >
          ↓
        </button>
        <button
          className="mobile-bar-btn"
          onClick={() => onInput(TAB)}
          title="Tab (autocomplete)"
        >
          Tab
        </button>
        <button
          className="mobile-bar-btn"
          onClick={() => onInput(ESCAPE)}
          title="Escape"
        >
          Esc
        </button>
        <button
          className="mobile-bar-btn"
          onClick={() => onInput(ENTER)}
          title="Enter"
        >
          ⏎
        </button>

        <div className="mobile-bar-divider" />

        {/* Menu categories */}
        {menuCategories.map((category) => (
          <div key={category.id} className="mobile-bar-menu-wrapper" ref={menuRef}>
            <button
              className={`mobile-bar-btn mobile-bar-btn--menu ${openMenu === category.id ? 'active' : ''}`}
              onClick={() => toggleMenu(category.id)}
            >
              <span className="mobile-bar-icon">{category.icon}</span>
              <span className="mobile-bar-label">{category.label}</span>
            </button>

            {openMenu === category.id && (
              <div className="mobile-bar-dropdown">
                {category.items.map((item) => (
                  <button
                    key={item.id}
                    className={`mobile-bar-dropdown-item ${item.disabled ? 'disabled' : ''} ${category.id === 'backend' && item.id === currentBackend ? 'selected' : ''}`}
                    onClick={() => handleMenuItemClick(category.id, item)}
                    disabled={item.disabled}
                  >
                    {item.label}
                    {category.id === 'backend' && item.id === currentBackend && (
                      <span className="mobile-bar-check">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Backdrop to close menu */}
      {openMenu && (
        <div
          className="mobile-bar-backdrop"
          onClick={() => setOpenMenu(null)}
        />
      )}
    </div>
  )
}

export default MobileTerminalBar
