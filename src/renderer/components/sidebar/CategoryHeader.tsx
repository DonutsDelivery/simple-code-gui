import React from 'react'
import { ProjectCategory } from '../../stores/workspace.js'

interface CategoryHeaderProps {
  category: ProjectCategory
  projectCount: number
  gradient: string
  textDark: boolean
  isCollapsed: boolean
  isDragging: boolean
  isEditing: boolean
  editingName: string
  editInputRef: React.RefObject<HTMLInputElement | null>
  draggedCategory: string | null
  draggedProject: string | null
  onToggleCollapse: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onCategoryHeaderDragOver: (e: React.DragEvent, position: 'before' | 'after') => void
  onCategoryDragOver: (e: React.DragEvent) => void
  onCategoryHeaderDrop: (e: React.DragEvent) => void
  onCategoryDrop: (e: React.DragEvent) => void
  onStartRename: () => void
  onEditingChange: (name: string) => void
  onRenameSubmit: () => void
  onRenameKeyDown: (e: React.KeyboardEvent) => void
}

export const CategoryHeader = React.memo(function CategoryHeader({
  category,
  projectCount,
  gradient,
  textDark,
  isCollapsed,
  isDragging,
  isEditing,
  editingName,
  editInputRef,
  draggedCategory,
  draggedProject,
  onToggleCollapse,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onCategoryHeaderDragOver,
  onCategoryDragOver,
  onCategoryHeaderDrop,
  onCategoryDrop,
  onStartRename,
  onEditingChange,
  onRenameSubmit,
  onRenameKeyDown,
}: CategoryHeaderProps) {
  return (
    <div
      className={`category-header ${isCollapsed ? 'collapsed' : ''} ${isDragging ? 'dragging' : ''} ${textDark ? 'text-dark' : ''}`}
      style={{ background: gradient }}
      role="button"
      tabIndex={0}
      draggable={!isEditing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        const position = e.clientY < midY ? 'before' : 'after'
        if (draggedCategory) {
          onCategoryHeaderDragOver(e, position)
        } else if (draggedProject) {
          onCategoryDragOver(e)
        }
      }}
      onDrop={(e) => {
        if (draggedCategory) {
          onCategoryHeaderDrop(e)
        } else if (draggedProject) {
          onCategoryDrop(e)
        }
      }}
      onClick={onToggleCollapse}
      onKeyDown={(e) => {
        if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onToggleCollapse()
        }
      }}
      onContextMenu={onContextMenu}
      aria-expanded={!isCollapsed}
      aria-label={`${category.name} category`}
    >
      <span className="expand-arrow" aria-hidden="true">
        {isCollapsed ? '▶' : '▼'}
      </span>
      {isEditing ? (
        <input
          ref={editInputRef}
          type="text"
          className="category-name-input"
          value={editingName}
          onChange={(e) => onEditingChange(e.target.value)}
          onKeyDown={onRenameKeyDown}
          onBlur={onRenameSubmit}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="category-name" onDoubleClick={onStartRename}>
          {category.name}
        </span>
      )}
      <span className="category-count">{projectCount}</span>
    </div>
  )
})
