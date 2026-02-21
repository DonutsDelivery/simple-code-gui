/**
 * TerminalBar Component
 *
 * Bottom bar for terminals with horizontal scrolling.
 * Works on both desktop and mobile.
 * Contains quick input buttons (mobile) and menu categories.
 */

import React, { useState, useRef, useEffect } from 'react'
import { CommandMenuItem, getCommandMenuItems } from '../utils/backendCommands'
import { AutoWorkOptions } from './TerminalMenu'

interface TerminalBarProps {
  ptyId: string
  onCommand: (command: string, options?: AutoWorkOptions) => void
  onInput?: (data: string) => void
  currentBackend: string
  onBackendChange: (backend: string) => void
  isMobile?: boolean
}

// Key codes for quick input
const CTRL_C = '\x03'
const ARROW_UP = '\x1b[A'
const ARROW_DOWN = '\x1b[B'
const TAB = '\t'
const ESCAPE = '\x1b'

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
  isMobile = false
}: TerminalBarProps): React.ReactElement {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

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
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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
      setAutoWorkOptions(prev => ({
        ...prev,
        [item.toggleKey!]: !prev[item.toggleKey!]
      }))
      return // Don't close menu for toggles
    }

    if (categoryId === 'backend') {
      onBackendChange(item.id)
    } else if (categoryId === 'gsd') {
      onCommand(`/${item.id}`)
    } else if (item.id === 'autowork') {
      onCommand('autowork', autoWorkOptions)
    } else {
      onCommand(item.id)
    }
    setOpenMenu(null)
  }

  const toggleMenu = (categoryId: string) => {
    setOpenMenu(openMenu === categoryId ? null : categoryId)
  }

  return (
    <div className="terminal-bar" ref={barRef}>
      <div className="terminal-bar-scroll">
        {/* Quick input buttons - always show on mobile, optionally on desktop */}
        {(isMobile || onInput) && onInput && (
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
            <div className="terminal-bar-divider" />
          </>
        )}

        {/* Menu categories */}
        {menuCategories.map((category) => (
          <div key={category.id} className="terminal-bar-menu-wrapper">
            <button
              className={`terminal-bar-btn terminal-bar-btn--menu ${openMenu === category.id ? 'active' : ''}`}
              onClick={() => toggleMenu(category.id)}
            >
              <span className="terminal-bar-icon">{category.icon}</span>
              <span className="terminal-bar-label">{category.label}</span>
            </button>

            {openMenu === category.id && (
              <div className="terminal-bar-dropdown" ref={dropdownRef}>
                {category.items.map((item) => {
                  const isToggle = item.isToggle && item.toggleKey
                  const isChecked = isToggle ? autoWorkOptions[item.toggleKey!] : false

                  return (
                    <button
                      key={item.id}
                      className={`terminal-bar-dropdown-item ${item.disabled ? 'disabled' : ''} ${isToggle ? 'toggle-item' : ''} ${isChecked ? 'checked' : ''} ${category.id === 'backend' && item.id === currentBackend ? 'selected' : ''}`}
                      onClick={() => handleMenuItemClick(category.id, item)}
                      disabled={item.disabled}
                    >
                      {isToggle && (
                        <span className="terminal-bar-toggle-indicator">{isChecked ? '✓' : '○'}</span>
                      )}
                      <span>{item.label}</span>
                      {category.id === 'backend' && item.id === currentBackend && (
                        <span className="terminal-bar-check">✓</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default TerminalBar
