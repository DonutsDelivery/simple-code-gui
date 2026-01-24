/**
 * TerminalBar Component
 *
 * Bottom bar for terminals with horizontal scrolling.
 * Works on both desktop and mobile.
 * Contains quick input buttons (mobile) and menu categories.
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { getCommandMenuItems } from '../utils/backendCommands'
import { AutoWorkOptions } from './TerminalMenu'

interface TerminalBarProps {
  ptyId: string
  onCommand: (command: string, options?: AutoWorkOptions) => void
  onInput?: (data: string) => void
  currentBackend: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'
  onBackendChange: (backend: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider') => void
  isMobile?: boolean
  onOpenFileBrowser?: () => void
  onClearWithRestore?: () => void
  onCompactWithRestore?: () => void
}

// Key codes for quick input
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
  isToggle?: boolean
  toggleKey?: keyof AutoWorkOptions
}

interface MenuCategory {
  id: string
  label: string
  icon: string
  items: MenuItem[]
}

const AUTOWORK_OPTIONS_KEY = 'terminal-autowork-options'

const defaultAutoWorkOptions: AutoWorkOptions = {
  withContext: false,
  askQuestions: false,
  pauseForReview: false,
  finalEvaluation: false,
  gitCommitEachTask: false,
}

export function TerminalBar({
  ptyId,
  onCommand,
  onInput,
  currentBackend,
  onBackendChange,
  isMobile = false,
  onOpenFileBrowser,
  onClearWithRestore,
  onCompactWithRestore
}: TerminalBarProps): React.ReactElement {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, visible: false })
  const barRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // Auto work options state
  const [autoWorkOptions, setAutoWorkOptions] = useState<AutoWorkOptions>(() => {
    const stored = localStorage.getItem(AUTOWORK_OPTIONS_KEY)
    if (stored) {
      try {
        return { ...defaultAutoWorkOptions, ...JSON.parse(stored) }
      } catch {
        return defaultAutoWorkOptions
      }
    }
    return defaultAutoWorkOptions
  })

  // Persist autowork options
  useEffect(() => {
    localStorage.setItem(AUTOWORK_OPTIONS_KEY, JSON.stringify(autoWorkOptions))
  }, [autoWorkOptions])

  // Close menu when clicking outside
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

    const padding = 8
    const rect = button.getBoundingClientRect()
    const menuRect = dropdownRef.current.getBoundingClientRect()
    const maxTop = window.innerHeight - menuRect.height - padding
    const openDownTop = rect.bottom + 6

    let top = rect.top - menuRect.height - 6
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
      items: commandItems.filter((item) => !item.id.startsWith('divider')),
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
        { id: 'gsd:update', label: 'Update GSD' },
        { id: 'gsd:help', label: 'Help' },
      ],
    },
    {
      id: 'automation',
      label: 'Auto',
      icon: '🤖',
      items: [
        { id: 'autowork', label: 'Start Auto Work' },
        { id: 'toggle-context', label: 'With Context', isToggle: true, toggleKey: 'withContext' },
        { id: 'toggle-questions', label: 'Ask Questions', isToggle: true, toggleKey: 'askQuestions' },
        { id: 'toggle-review', label: 'Pause for Review', isToggle: true, toggleKey: 'pauseForReview' },
        { id: 'toggle-evaluation', label: 'Final Evaluation', isToggle: true, toggleKey: 'finalEvaluation' },
        { id: 'toggle-git', label: 'Git Commit Each', isToggle: true, toggleKey: 'gitCommitEachTask' },
        { id: 'continuework', label: 'Continue to Next' },
        { id: 'stopwork', label: 'Stop After Task' },
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

    // Handle toggles
    if (item.isToggle && item.toggleKey) {
      setAutoWorkOptions((prev) => ({
        ...prev,
        [item.toggleKey!]: !prev[item.toggleKey!]
      }))
      return // Don't close menu for toggles
    }

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

    if (item.id === 'autowork') {
      onCommand('autowork', autoWorkOptions)
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
    <div className="terminal-bar" ref={barRef}>
      <div className="terminal-bar-scroll">
        {/* Quick input buttons - only show on mobile */}
        {isMobile && onInput && (
          <>
            <button
              className="terminal-bar-btn terminal-bar-btn--danger"
              onClick={() => onInput(CTRL_C)}
              title="Interrupt (Ctrl+C)"
            >
              ^C
            </button>
            <button
              className="terminal-bar-btn"
              onClick={() => onInput(ARROW_UP)}
              title="Previous command"
            >
              ↑
            </button>
            <button
              className="terminal-bar-btn"
              onClick={() => onInput(ARROW_DOWN)}
              title="Next command"
            >
              ↓
            </button>
            <button
              className="terminal-bar-btn"
              onClick={() => onInput(TAB)}
              title="Tab (autocomplete)"
            >
              Tab
            </button>
            <button
              className="terminal-bar-btn"
              onClick={() => onInput(ESCAPE)}
              title="Escape"
            >
              Esc
            </button>
            <button
              className="terminal-bar-btn terminal-bar-btn--primary"
              onClick={() => onInput(ENTER)}
              title="Enter"
            >
              ⏎
            </button>
            <div className="terminal-bar-divider" />
          </>
        )}

        {/* Files button - mobile only */}
        {isMobile && onOpenFileBrowser && (
          <button
            className="terminal-bar-btn terminal-bar-btn--menu"
            onClick={onOpenFileBrowser}
            title="Browse Files"
          >
            <span className="terminal-bar-icon">📁</span>
            <span className="terminal-bar-label">Files</span>
          </button>
        )}

        {/* Quick action buttons for /clear and /compact */}
        {onClearWithRestore && (
          <button
            className="terminal-bar-btn terminal-bar-btn--action"
            onClick={onClearWithRestore}
            title="Clear session (preserves your current input)"
          >
            <span className="terminal-bar-icon">🧹</span>
            <span className="terminal-bar-label">Clear</span>
          </button>
        )}
        {onCompactWithRestore && (
          <button
            className="terminal-bar-btn terminal-bar-btn--action"
            onClick={onCompactWithRestore}
            title="Compact session (preserves your current input)"
          >
            <span className="terminal-bar-icon">📦</span>
            <span className="terminal-bar-label">Compact</span>
          </button>
        )}

        {/* Divider between quick actions and menus */}
        {(onClearWithRestore || onCompactWithRestore) && (
          <div className="terminal-bar-divider" />
        )}

        {/* Menu categories */}
        {menuCategories.map((category) => (
          <div key={category.id} className="terminal-bar-menu-wrapper">
            <button
              className={`terminal-bar-btn terminal-bar-btn--menu ${openMenu === category.id ? 'active' : ''}`}
              onClick={() => toggleMenu(category.id)}
              aria-expanded={openMenu === category.id}
              ref={(node) => {
                menuButtonRefs.current[category.id] = node
              }}
            >
              <span className="terminal-bar-icon">{category.icon}</span>
              <span className="terminal-bar-label">{category.label}</span>
              <span className="terminal-bar-caret" aria-hidden="true">▲</span>
            </button>
          </div>
        ))}
      </div>

      {openCategory && ReactDOM.createPortal(
        <div
          className="terminal-bar-dropdown"
          ref={dropdownRef}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            visibility: menuPosition.visible ? 'visible' : 'hidden',
            pointerEvents: menuPosition.visible ? 'auto' : 'none'
          }}
        >
          {openCategory.items.map((item) => {
            const isToggle = item.isToggle && item.toggleKey
            const isChecked = isToggle ? autoWorkOptions[item.toggleKey!] : false

            return (
              <button
                key={item.id}
                className={`terminal-bar-dropdown-item ${item.disabled ? 'disabled' : ''} ${isToggle ? 'toggle-item' : ''} ${isChecked ? 'checked' : ''} ${openCategory.id === 'backend' && item.id === currentBackend ? 'selected' : ''}`}
                onClick={() => handleMenuItemClick(openCategory.id, item)}
                disabled={item.disabled}
              >
                {isToggle && (
                  <span className="terminal-bar-toggle-indicator">{isChecked ? '✓' : '○'}</span>
                )}
                <span>{item.label}</span>
                {openCategory.id === 'backend' && item.id === currentBackend && (
                  <span className="terminal-bar-check">✓</span>
                )}
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </div>
  )
}

export default TerminalBar
