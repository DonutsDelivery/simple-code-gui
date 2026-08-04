import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyCanvasScene } from '../components/canvas'
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher'
import { useWorkspaceStore, type WorkspaceSession } from '../stores/workspace'

function session(id: string): WorkspaceSession {
  const authorityTabId = `tab-${id}`
  const rendererTabId = `server-a\0${authorityTabId}`
  return {
    serverId: 'server-a',
    authoritySessionId: id,
    id,
    name: id === 'one' ? 'Primary' : 'Background',
    openTabs: [{ serverId: 'server-a', authorityTabId, id: rendererTabId, ptyId: `pty-${id}`, projectPath: `/${id}`, title: id }],
    activeTabId: rendererTabId,
    activeTileTree: null,
    canvasScene: createEmptyCanvasScene(),
    activeView: 'tiles',
    isRestored: true,
  }
}

describe('WorkspaceSwitcher agent attention', () => {
  beforeEach(() => useWorkspaceStore.setState({ attentionByTabId: {} }))

  // AC: @agent-session-notifications ac-3
  it('aggregates the strongest child signal into an accessible workspace highlight', () => {
    const sessions = [session('one'), session('two')]
    sessions[1].openTabs.push({ serverId: 'server-a', authorityTabId: 'tab-blocked', id: 'server-a\0tab-blocked', ptyId: 'pty-blocked', projectPath: '/two', title: 'Blocked' })
    useWorkspaceStore.setState({
      attentionByTabId: {
        ['server-a\0tab-two']: 'completed',
        ['server-a\0tab-blocked']: 'needs-input',
      },
    })

    render(
      <WorkspaceSwitcher
        sessions={sessions}
        activeSessionId="one"
        onSwitch={vi.fn()}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onRename={vi.fn()}
        onReorder={vi.fn()}
        onMoveTabs={vi.fn()}
      />,
    )

    const background = screen.getByRole('tab', { name: /Background, needs your input/i })
    expect(background).toHaveClass('has-agent-attention--needs-input')
    expect(background.querySelector('.agent-attention-dot')).toBeInTheDocument()
  })
})
