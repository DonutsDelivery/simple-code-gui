import React, { useRef, useLayoutEffect } from 'react'
import ReactDOM from 'react-dom'
import { Project, ProjectCategory } from '../../stores/workspace.js'
import { adjustMenuPosition } from './utils.js'
import { PROJECT_COLORS } from './constants.js'

interface ProjectContextMenuProps {
  x: number
  y: number
  project: Project
  categories: ProjectCategory[]
  onClose: () => void
  onRunExecutable: () => void
  onSelectExecutable: () => void
  onClearExecutable: () => void
  onOpenSettings: () => void
  onOpenExtensions: () => void
  onEditClaudeMd: () => void
  onUpdateColor: (color: string | undefined) => void
  onMoveToCategory: (categoryId: string | null) => void
  onCreateCategory: () => void
  onDelete: () => void
}

export function ProjectContextMenu({
  x,
  y,
  project,
  categories,
  onClose,
  onRunExecutable,
  onSelectExecutable,
  onClearExecutable,
  onOpenSettings,
  onOpenExtensions,
  onEditClaudeMd,
  onUpdateColor,
  onMoveToCategory,
  onCreateCategory,
  onDelete,
}: ProjectContextMenuProps) {
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

  const sortedCategories = [...categories].sort((a, b) => a.order - b.order)

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {project.executable ? (
        <>
          <button onClick={onRunExecutable}>
            <span className="icon">▶</span> Run App
          </button>
          <button onClick={onSelectExecutable}>
            <span className="icon">⚡</span> Change Executable
          </button>
          <button onClick={onClearExecutable}>
            <span className="icon">✕</span> Clear Executable
          </button>
        </>
      ) : (
        <button onClick={onSelectExecutable}>
          <span className="icon">⚡</span> Set Executable
        </button>
      )}
      <div className="context-menu-divider" />
      <button onClick={onOpenSettings}>
        <span className="icon">⚙</span> Project Settings
        {(project.apiPort || project.autoAcceptTools?.length || project.permissionMode) && (
          <span className="menu-hint">configured</span>
        )}
      </button>
      <button onClick={onOpenExtensions}>
        <span className="icon">🧩</span> Extensions...
      </button>
      <button onClick={onEditClaudeMd}>
        <span className="icon">📝</span> Edit {
          { claude: 'CLAUDE.md', gemini: 'GEMINI.md', codex: 'AGENTS.md', opencode: 'OPENCODE.md', aider: 'CONVENTIONS.md', droid: 'AGENTS.md', hermes: 'HERMES.md', grok: 'AGENTS.md' }[
            project.backend && project.backend !== 'default' ? project.backend : 'claude'
          ] || 'CLAUDE.md'
        }
      </button>
      <div className="context-menu-divider" />
      <div className="context-menu-label">Color</div>
      <div className="color-picker-row">
        {PROJECT_COLORS.map((color) => (
          <button
            key={color.name}
            className={`color-swatch ${project.color === color.value ? 'selected' : ''} ${!color.value ? 'none' : ''}`}
            style={color.value ? { backgroundColor: color.value } : undefined}
            title={color.name}
            onClick={() => {
              onUpdateColor(color.value)
              onClose()
            }}
          >
            {!color.value && '✕'}
          </button>
        ))}
      </div>
      <div className="context-menu-divider" />
      <div className="context-menu-label">Move to Category</div>
      <div className="category-move-options">
        <button
          className={!project.categoryId ? 'selected' : ''}
          onClick={() => {
            onMoveToCategory(null)
            onClose()
          }}
        >
          <span className="icon">—</span> None
        </button>
        {sortedCategories.map((cat) => (
          <button
            key={cat.id}
            className={project.categoryId === cat.id ? 'selected' : ''}
            onClick={() => {
              onMoveToCategory(cat.id)
              onClose()
            }}
          >
            <span className="icon">📁</span> {cat.name}
          </button>
        ))}
        <button onClick={onCreateCategory}>
          <span className="icon">+</span> New Category
        </button>
      </div>
      <div className="context-menu-divider" />
      <button className="danger" onClick={onDelete}>
        <span className="icon">🗑</span> Remove Project
      </button>
    </div>,
    document.body
  )
}
