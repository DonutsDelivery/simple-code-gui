import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TiledTerminalView } from './index'

let resizeCallback: ResizeObserverCallback

vi.mock('./TileTerminal.js', () => ({
  TileTerminal: ({ viewportSize, attentionByTabId }: {
    viewportSize: { width: number; height: number }
    attentionByTabId: Record<string, string>
  }) => (
    <div
      data-testid="tile-terminal"
      data-viewport-width={viewportSize.width}
      data-viewport-height={viewportSize.height}
      data-attention={attentionByTabId['tab-1'] ?? ''}
    />
  ),
}))

function props() {
  return {
    tabs: [],
    projects: [],
    theme: {} as never,
    focusedTabId: null,
    onCloseTab: vi.fn(),
    onRenameTab: vi.fn(),
    onFocusTab: vi.fn(),
    tileTree: null,
    onTreeChange: vi.fn(),
  }
}

describe('TiledTerminalView initial measurement', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the viewport mounted while the workspace is empty', () => {
    render(<TiledTerminalView {...props()} />)

    expect(screen.getByTestId('tiled-terminal-viewport')).toBeInTheDocument()
  })

  it('uses the measured empty viewport when the first tile is created', () => {
    const view = render(<TiledTerminalView {...props()} />)

    act(() => {
      resizeCallback(
        [{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      )
    })

    view.rerender(
      <TiledTerminalView
        {...props()}
        tabs={[{
          id: 'tab-1',
          projectPath: '/project',
          title: 'New',
          backend: 'hermes',
        }]}
        projects={[{ path: '/project', name: 'project' }]}
        attentionByTabId={{ 'tab-1': 'needs-input' }}
        tileTree={{
          type: 'leaf',
          id: 'leaf-1',
          tabIds: ['tab-1'],
          activeTabId: 'tab-1',
        }}
      />,
    )

    expect(screen.getByTestId('tile-terminal')).toHaveAttribute('data-viewport-width', '800')
    expect(screen.getByTestId('tile-terminal')).toHaveAttribute('data-viewport-height', '600')
    expect(screen.getByTestId('tile-terminal')).toHaveAttribute('data-attention', 'needs-input')
  })
})
