import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactDOM from 'react-dom'

interface Command {
  command: string
  extensionId: string
  extensionName: string
}

interface QuickActionsMenuProps {
  projectPath: string | null
  ptyId: string | null
  onOpenExtensions?: () => void
}

export function QuickActionsMenu({ projectPath, ptyId, onOpenExtensions }: QuickActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [commands, setCommands] = useState<Command[]>([])
  const [loading, setLoading] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Load commands when menu opens
  useEffect(() => {
    if (isOpen && projectPath) {
      setLoading(true)
      window.electronAPI.extensionsGetCommands(projectPath)
        .then(cmds => {
          setCommands(cmds || [])
        })
        .catch(() => {
          setCommands([])
        })
        .finally(() => {
          setLoading(false)
        })
    }
  }, [isOpen, projectPath])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  // Send command to terminal
  const handleCommand = useCallback((cmd: string) => {
    if (!ptyId) return

    // Write the command to the PTY
    window.electronAPI.writePty(ptyId, cmd + '\n')
    setIsOpen(false)
  }, [ptyId])

  // Calculate menu position
  const getMenuPosition = () => {
    if (!buttonRef.current) return { top: 0, left: 0 }

    const rect = buttonRef.current.getBoundingClientRect()
    return {
      top: rect.bottom + 4,
      left: Math.max(8, rect.left - 150)  // Align to left side of button, clamped
    }
  }

  const menuPos = getMenuPosition()

  return (
    <>
      <button
        ref={buttonRef}
        className="quick-actions-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Quick Actions"
        disabled={!projectPath}
      >
        <span className="icon">⚡</span>
        <span className="label">Actions</span>
        <span className="caret">▾</span>
      </button>

      {isOpen && ReactDOM.createPortal(
        <div
          ref={menuRef}
          className="quick-actions-menu"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {/* Built-in plugin commands */}
          <button
            className="quick-actions-item"
            onClick={() => handleCommand('/plugin list')}
          >
            <span className="cmd">/plugin list</span>
            <span className="ext">Built-in</span>
          </button>
          <div className="quick-actions-divider" />

          {loading ? (
            <div className="quick-actions-loading">Loading...</div>
          ) : commands.length > 0 ? (
            <>
              {commands.map((cmd, idx) => (
                <button
                  key={`${cmd.extensionId}-${idx}`}
                  className="quick-actions-item"
                  onClick={() => handleCommand(cmd.command)}
                >
                  <span className="cmd">{cmd.command}</span>
                  <span className="ext">{cmd.extensionName}</span>
                </button>
              ))}
              <div className="quick-actions-divider" />
            </>
          ) : null}
          {onOpenExtensions && (
            <button
              className="quick-actions-item manage"
              onClick={() => {
                setIsOpen(false)
                onOpenExtensions()
              }}
            >
              <span className="icon">🧩</span>
              <span>Manage Extensions...</span>
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
