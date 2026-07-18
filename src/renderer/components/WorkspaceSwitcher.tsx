import React, { useState, useRef, useCallback, memo } from 'react'
import { WorkspaceSession } from '../stores/workspace'

interface WorkspaceSwitcherProps {
  sessions: WorkspaceSession[]
  activeSessionId: string | null
  onSwitch: (id: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onRename: (id: string, name: string) => void
  onReorder: (id: string, toIndex: number) => void
  onMoveTabs: (
    toSessionId: string,
    payload: { type: 'subtab'; tabId: string } | { type: 'tile'; tileId: string }
  ) => void
  onWheel?: (e: React.WheelEvent) => void
}

interface SessionTabProps {
  session: WorkspaceSession
  index: number
  isActive: boolean
  isRestoring: boolean
  insertSide: 'before' | 'after' | null
  isDropTarget: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => void
  onTabDragStart: (id: string) => void
  onTabDragOver: (index: number, before: boolean) => void
  onTabDrop: () => void
  onTabDragEnd: () => void
  onExternalDragOver: (id: string) => void
  onExternalDragLeave: (id: string) => void
  onExternalDrop: (
    id: string,
    payload: { type: 'subtab'; tabId: string } | { type: 'tile'; tileId: string }
  ) => void
}

const SessionTab = memo(function SessionTab({
  session,
  index,
  isActive,
  isRestoring,
  insertSide,
  isDropTarget,
  onSelect,
  onClose,
  onRename,
  onTabDragStart,
  onTabDragOver,
  onTabDrop,
  onTabDragEnd,
  onExternalDragOver,
  onExternalDragLeave,
  onExternalDrop,
}: SessionTabProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)

  const handleClick = useCallback(() => {
    if (!editing) onSelect(session.id)
  }, [editing, onSelect, session.id])

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onClose(session.id)
  }, [onClose, session.id])

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditing(true)
    setEditValue(session.name)
    cancelledRef.current = false
    setTimeout(() => inputRef.current?.select(), 0)
  }, [session.name])

  const commitRename = useCallback(() => {
    if (cancelledRef.current) return
    const trimmed = editValue.trim()
    if (trimmed) onRename(session.id, trimmed)
    setEditing(false)
  }, [editValue, onRename, session.id])

  const cancelRename = useCallback(() => {
    cancelledRef.current = true
    setEditing(false)
  }, [])

  const tabCount = session.openTabs.length

  return (
    <div
      className={`tab workspace-tab ${isActive ? 'active' : ''} ${isRestoring ? 'restoring' : ''}${insertSide === 'before' ? ' ws-insert-before' : ''}${insertSide === 'after' ? ' ws-insert-after' : ''}${isDropTarget ? ' ws-drop-target' : ''}`}
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-workspace-tab', session.id)
        e.dataTransfer.effectAllowed = 'move'
        onTabDragStart(session.id)
      }}
      onDragOver={(e) => {
        const types = e.dataTransfer.types
        if (types.includes('application/x-workspace-tab')) {
          e.preventDefault()
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          onTabDragOver(index, e.clientX < rect.left + rect.width / 2)
          return
        }
        // External: a sub-tab or whole tile dragged from the tiled view
        if (!isActive && (types.includes('application/x-subtab') || types.includes('text/plain'))) {
          e.preventDefault()
          onExternalDragOver(session.id)
        }
      }}
      onDragLeave={() => onExternalDragLeave(session.id)}
      onDrop={(e) => {
        const types = e.dataTransfer.types
        if (types.includes('application/x-workspace-tab')) {
          e.preventDefault()
          onTabDrop()
          return
        }
        if (isActive) return
        if (types.includes('application/x-subtab')) {
          e.preventDefault()
          try {
            const { tabId } = JSON.parse(e.dataTransfer.getData('application/x-subtab'))
            if (tabId) onExternalDrop(session.id, { type: 'subtab', tabId })
          } catch { /* ignore malformed payload */ }
          return
        }
        if (types.includes('text/plain')) {
          e.preventDefault()
          const tileId = e.dataTransfer.getData('text/plain')
          if (tileId) onExternalDrop(session.id, { type: 'tile', tileId })
        }
      }}
      onDragEnd={onTabDragEnd}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(session.id) }
      }}
      title={session.name}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="tab-title-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename() }
            else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
            e.stopPropagation()
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          autoFocus
        />
      ) : (
        <span
          className="tab-title"
          title={session.name}
          onDoubleClick={(e) => { e.stopPropagation(); startRename(e) }}
        >
          {isRestoring ? '⟳ ' : ''}{session.name}
          {tabCount > 0 && (
            <span className="workspace-tab-count">{tabCount}</span>
          )}
        </span>
      )}
      <button
        className="tab-close"
        onClick={handleClose}
        title="Close workspace"
        aria-label="Close workspace"
      >
        ×
      </button>
    </div>
  )
})

export function WorkspaceSwitcher({
  sessions,
  activeSessionId,
  onSwitch,
  onAdd,
  onRemove,
  onRename,
  onReorder,
  onMoveTabs,
  onWheel,
}: WorkspaceSwitcherProps) {
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropInsert, setDropInsert] = useState<{ index: number; before: boolean } | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const handleExternalDragOver = useCallback((id: string) => setDropTargetId(id), [])
  const handleExternalDragLeave = useCallback((id: string) => {
    setDropTargetId(prev => (prev === id ? null : prev))
  }, [])
  const handleExternalDrop = useCallback((
    id: string,
    payload: { type: 'subtab'; tabId: string } | { type: 'tile'; tileId: string }
  ) => {
    setDropTargetId(null)
    onMoveTabs(id, payload)
  }, [onMoveTabs])

  const handleTabDragStart = useCallback((id: string) => setDragId(id), [])
  const handleTabDragOver = useCallback((index: number, before: boolean) => {
    setDropInsert({ index, before })
  }, [])
  const handleTabDragEnd = useCallback(() => { setDragId(null); setDropInsert(null) }, [])
  const handleTabDrop = useCallback(() => {
    if (dragId && dropInsert) {
      const toIndex = dropInsert.index + (dropInsert.before ? 0 : 1)
      onReorder(dragId, toIndex)
    }
    setDragId(null)
    setDropInsert(null)
  }, [dragId, dropInsert, onReorder])

  const handleSwitch = useCallback((id: string) => {
    const session = sessions.find(s => s.id === id)
    if (!session) return
    if (session.isRestored) {
      onSwitch(id)
    } else {
      // Mark as restoring; caller handles the async restore
      setRestoringIds(prev => new Set(prev).add(id))
      onSwitch(id)
      // Clear restoring state once the session becomes restored
      // (checked on next render via isRestored)
    }
  }, [sessions, onSwitch])

  // Clear restoring flag when session becomes restored
  const restoringCleared = restoringIds.size > 0
    ? new Set([...restoringIds].filter(id => {
        const s = sessions.find(s => s.id === id)
        return s && !s.isRestored
      }))
    : restoringIds

  const handleRemove = useCallback((id: string) => {
    const session = sessions.find(s => s.id === id)
    if (!session) return
    if (session.openTabs.length > 0) {
      if (!window.confirm(`Close "${session.name}"? This will kill ${session.openTabs.length} terminal(s).`)) return
    }
    onRemove(id)
  }, [sessions, onRemove])

  return (
    <div className="workspace-switcher tabs-bar" role="tablist" aria-label="Workspaces" onWheel={onWheel}>
      {sessions.map((session, index) => (
        <SessionTab
          key={session.id}
          session={session}
          index={index}
          isActive={session.id === activeSessionId}
          isRestoring={restoringCleared.has(session.id)}
          insertSide={
            dropInsert && dropInsert.index === index
              ? (dropInsert.before ? 'before' : 'after')
              : null
          }
          onSelect={handleSwitch}
          onClose={handleRemove}
          onRename={onRename}
          isDropTarget={dropTargetId === session.id}
          onTabDragStart={handleTabDragStart}
          onTabDragOver={handleTabDragOver}
          onTabDrop={handleTabDrop}
          onTabDragEnd={handleTabDragEnd}
          onExternalDragOver={handleExternalDragOver}
          onExternalDragLeave={handleExternalDragLeave}
          onExternalDrop={handleExternalDrop}
        />
      ))}
      <button
        className="workspace-add-btn tab-new-session"
        onClick={onAdd}
        title="New workspace"
        aria-label="New workspace"
        style={{ opacity: 1, minWidth: 32, maxWidth: 32, alignSelf: 'center' }}
      >
        +
      </button>
    </div>
  )
}
