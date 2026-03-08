import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import type { UnifiedTask } from './adapters/types.js'
import { formatTaskPrompt } from './types.js'

// Type guard for checking if event target is a valid Node for contains() check
function isEventTargetNode(target: EventTarget | null): target is Node {
  return target !== null && target instanceof Node
}

interface StartDropdownProps {
  taskId: string | null
  position: { top: number; left: number } | null
  tasks: UnifiedTask[]
  currentTabPtyId: string | null | undefined
  onStartInNewTab?: (prompt: string) => void
  onSendToCurrentTab?: (prompt: string) => void
  onClose: () => void
  onCloseBrowser: () => void
}

export function StartDropdown({
  taskId, position, tasks, currentTabPtyId,
  onStartInNewTab, onSendToCurrentTab, onClose, onCloseBrowser
}: StartDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && isEventTargetNode(e.target) && !dropdownRef.current.contains(e.target)) {
        onClose()
      }
    }
    if (taskId) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [taskId, onClose])

  if (!taskId || !position) return null

  const task = tasks.find(t => t.id === taskId)

  return ReactDOM.createPortal(
    <div
      ref={dropdownRef}
      className="beads-start-dropdown"
      style={{ top: position.top, left: position.left }}
    >
      <button
        className="beads-start-option"
        onClick={() => {
          if (task && onStartInNewTab) {
            onStartInNewTab(formatTaskPrompt(task))
          }
          onClose()
          onCloseBrowser()
        }}
      >
        <span className="beads-start-icon">+</span>
        Start in new tab
      </button>
      <button
        className="beads-start-option"
        onClick={() => {
          if (task && onSendToCurrentTab && currentTabPtyId) {
            onSendToCurrentTab(formatTaskPrompt(task))
          }
          onClose()
          onCloseBrowser()
        }}
        disabled={!currentTabPtyId}
        title={!currentTabPtyId ? 'No active terminal tab' : ''}
      >
        <span className="beads-start-icon">&#8594;</span>
        Send to current tab
      </button>
    </div>,
    document.body
  )
}
