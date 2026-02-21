/**
 * MobileTerminalBar Component
 *
 * Static bottom bar for mobile terminals with horizontal scrolling.
 * Contains quick input buttons and menu categories.
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { getCommandMenuItems } from '../../utils/backendCommands'

interface MobileTerminalBarProps {
  onInput: (data: string) => void
  onCommand: (command: string) => void
  currentBackend: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
  onBackendChange: (backend: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider') => void
  onOpenFileBrowser?: () => void
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
  onBackendChange,
  onOpenFileBrowser
}: MobileTerminalBarProps): React.ReactElement {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, visible: false })
  const barRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (barRef.current && barRef.current.contains(target)) return
      if (dropdownRef.current && dropdownRef.current.contains(target)) return
      setOpenMenu(null)
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    if (!openMenu) {
      setMenuPosition((prev) => prev.visible ? { ...prev, visible: false } : prev)
    }
  }, [openMenu])

  const updateMenuPosition = useCallback(() => {
    if (!openMenu || !dropdownRef.current) return
    const button = menuButtonRefs.current[openMenu]
    if (!button) return

    const padding = 12
    const rect = button.getBoundingClientRect()
    const menuRect = dropdownRef.current.getBoundingClientRect()
    const maxTop = window.innerHeight - menuRect.height - padding
    const openDownTop = rect.bottom + 8

    let top = rect.top - menuRect.height - 8
    if (top < padding) {
      top = Math.min(openDownTop, maxTop)
    }

    let left = rect.left
    if (left + menuRect.width > window.innerWidth - padding) {
      left = window.innerWidth - menuRect.width - padding
    }
    if (left < padding) {
      left = padding
    }

    setMenuPosition((prev) => {
      if (prev.top === top && prev.left === left && prev.visible) return prev
      return { top, left, visible: true }
    })
  }, [openMenu])

  useLayoutEffect(() => {
    updateMenuPosition()
  }, [updateMenuPosition, openMenu])

  useEffect(() => {
    if (!openMenu) return
    const handleReposition = () => updateMenuPosition()
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [openMenu, updateMenuPosition])

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
      onBackendChange(item.id as 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider')
      setOpenMenu(null)
      return
    }

    if (categoryId === 'gsd') {
      onCommand(`/${item.id}`)
      setOpenMenu(null)
      return
    }

    if (categoryId === 'commands') {
      onCommand(item.id)
      setOpenMenu(null)
      return
    }

    onCommand(item.id)
    setOpenMenu(null)
  }

  const toggleMenu = (categoryId: string) => {
    setOpenMenu((prev) => (prev === categoryId ? null : categoryId))
  }

  const openCategory = menuCategories.find((category) => category.id === openMenu)

  return (
    <div className="mobile-terminal-bar" ref={barRef}>
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

        {/* Files button */}
        {onOpenFileBrowser && (
          <button
            className="mobile-bar-btn mobile-bar-btn--menu"
            onClick={onOpenFileBrowser}
            title="Browse Files"
          >
            <span className="mobile-bar-icon">📁</span>
            <span className="mobile-bar-label">Files</span>
          </button>
        )}

        {/* Menu categories */}
        {menuCategories.map((category) => (
          <div key={category.id} className="mobile-bar-menu-wrapper">
            <button
              className={`mobile-bar-btn mobile-bar-btn--menu ${openMenu === category.id ? 'active' : ''}`}
              onClick={() => toggleMenu(category.id)}
              aria-expanded={openMenu === category.id}
              ref={(node) => {
                menuButtonRefs.current[category.id] = node
              }}
            >
              <span className="mobile-bar-icon">{category.icon}</span>
              <span className="mobile-bar-label">{category.label}</span>
              <span className="mobile-bar-caret" aria-hidden="true">▲</span>
            </button>
          </div>
        ))}
      </div>

      {openCategory && ReactDOM.createPortal(
        <>
          <div
            className="mobile-bar-backdrop"
            onClick={() => setOpenMenu(null)}
          />
          <div
            className="mobile-bar-dropdown"
            ref={dropdownRef}
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
              visibility: menuPosition.visible ? 'visible' : 'hidden',
              pointerEvents: menuPosition.visible ? 'auto' : 'none'
            }}
          >
            {openCategory.items.map((item) => (
              <button
                key={item.id}
                className={`mobile-bar-dropdown-item ${item.disabled ? 'disabled' : ''} ${openCategory.id === 'backend' && item.id === currentBackend ? 'selected' : ''}`}
                onClick={() => handleMenuItemClick(openCategory.id, item)}
                disabled={item.disabled}
              >
                {item.label}
                {openCategory.id === 'backend' && item.id === currentBackend && (
                  <span className="mobile-bar-check">✓</span>
                )}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

export default MobileTerminalBar
