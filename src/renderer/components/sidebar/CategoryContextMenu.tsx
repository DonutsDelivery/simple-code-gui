import React, { useRef, useLayoutEffect } from 'react'
import ReactDOM from 'react-dom'
import { ProjectCategory } from '../../stores/workspace.js'
import { adjustMenuPosition } from './utils.js'

interface CategoryContextMenuProps {
  x: number
  y: number
  category: ProjectCategory
  onRename: () => void
  onDelete: () => void
}

export function CategoryContextMenu({ x, y, category, onRename, onDelete }: CategoryContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (menuRef.current) {
      const adjusted = adjustMenuPosition(menuRef.current, { x, y })
      if (adjusted.x !== x || adjusted.y !== y) {
        menuRef.current.style.left = `${adjusted.x}px`
        menuRef.current.style.top = `${adjusted.y}px`
      }
    }
  }, [x, y])

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={onRename}>
        <span className="icon">✏️</span> Rename
      </button>
      <div className="context-menu-divider" />
      <button className="danger" onClick={onDelete}>
        <span className="icon">🗑</span> Delete Category
      </button>
    </div>,
    document.body
  )
}
