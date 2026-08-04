import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'

export interface SidebarOverflowAction {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  active?: boolean
  disabled?: boolean
  status?: string
  closeOnSelect?: boolean
  onSelect: () => void | Promise<void>
}

interface SidebarActionOverflowProps {
  actions: SidebarOverflowAction[]
  tabIndex?: number
}

export function SidebarActionOverflow({ actions, tabIndex = 0 }: SidebarActionOverflowProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [menuPosition, setMenuPosition] = useState({ left: 8, bottom: 8, width: 264, maxHeight: 320 })

  const updateMenuPosition = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const sidebar = trigger.closest('.sidebar')
    const triggerRect = trigger.getBoundingClientRect()
    const sidebarRect = sidebar?.getBoundingClientRect()
    const width = Math.max(180, Math.min(264, (sidebarRect?.width ?? 280) - 16, window.innerWidth - 24))
    const preferredLeft = (sidebarRect?.left ?? 0) + 8
    const left = Math.max(8, Math.min(preferredLeft, window.innerWidth - width - 8))
    const maxHeight = Math.max(120, triggerRect.top - 16)
    setMenuPosition({ left, bottom: window.innerHeight - triggerRect.top + 10, width, maxHeight })
  }

  const closeAndRestoreFocus = () => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      itemRefs.current.find((item) => item && !item.disabled)?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  const moveFocus = (direction: 1 | -1) => {
    const available = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled))
    if (available.length === 0) return
    const currentIndex = available.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = currentIndex === -1
      ? 0
      : (currentIndex + direction + available.length) % available.length
    available[nextIndex].focus()
  }

  return (
    <div className="sidebar-action-overflow" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`sidebar-dock-button sidebar-dock-button--more ${open ? 'is-active' : ''}`}
        aria-label="More sidebar actions"
        title="More sidebar actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="sidebar-action-overflow-menu"
        tabIndex={tabIndex}
        onClick={() => setOpen((value) => !value)}
      >
        <svg className="sidebar-dock-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      </button>

      {open && ReactDOM.createPortal(
        <div
          ref={menuRef}
          id="sidebar-action-overflow-menu"
          className="sidebar-action-overflow-menu"
          role="menu"
          aria-label="More sidebar actions"
          style={menuPosition}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              closeAndRestoreFocus()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              moveFocus(1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              moveFocus(-1)
            } else if (event.key === 'Home') {
              event.preventDefault()
              itemRefs.current.find((item) => item && !item.disabled)?.focus()
            } else if (event.key === 'End') {
              event.preventDefault()
              const available = itemRefs.current.filter(
                (item): item is HTMLButtonElement => Boolean(item && !item.disabled)
              )
              available.at(-1)?.focus()
            }
          }}
        >
          <div className="sidebar-action-overflow-heading">Workspace controls</div>
          {actions.map((action, index) => (
            <button
              key={action.id}
              ref={(node) => { itemRefs.current[index] = node }}
              type="button"
              role="menuitem"
              className={`sidebar-action-overflow-item ${action.active ? 'is-active' : ''}`}
              disabled={action.disabled}
              onClick={async () => {
                await action.onSelect()
                if (action.closeOnSelect) closeAndRestoreFocus()
              }}
            >
              <span className="sidebar-action-overflow-icon" aria-hidden="true">{action.icon}</span>
              <span className="sidebar-action-overflow-copy">
                <span className="sidebar-action-overflow-label">{action.label}</span>
                <span className="sidebar-action-overflow-description">{action.description}</span>
              </span>
              {action.status && <span className="sidebar-action-overflow-status">{action.status}</span>}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
