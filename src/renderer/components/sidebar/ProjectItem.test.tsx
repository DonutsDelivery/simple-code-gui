import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectItem } from './ProjectItem'

describe('ProjectItem session actions', () => {
  it('requests a fresh session through named options', () => {
    const onOpenSession = vi.fn()

    render(
      <ProjectItem
        project={{ path: '/project', name: 'project' }}
        isExpanded
        isFocused={false}
        hasOpenTab={false}
        isDragging={false}
        isEditing={false}
        editingName=""
        sessions={[]}
        dropTarget={null}
        editInputRef={{ current: null }}
        onToggleExpand={vi.fn()}
        onOpenSession={onOpenSession}
        onRunExecutable={vi.fn()}
        onCloseProjectTabs={vi.fn()}
        onContextMenu={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragOver={vi.fn()}
        onDrop={vi.fn()}
        onStartRename={vi.fn()}
        onEditingChange={vi.fn()}
        onRenameSubmit={vi.fn()}
        onRenameKeyDown={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('New Session'))

    expect(onOpenSession).toHaveBeenCalledWith({ forceNewSession: true })
  })
})
