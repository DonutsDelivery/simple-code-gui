import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { darkTheme } from '../themes'
import { createEmptyCanvasScene, type CanvasScene } from '../components/canvas'
import { CanvasWorkspaceView } from '../components/canvas/CanvasWorkspaceView'

vi.mock('../components/Terminal', () => ({
  Terminal: ({ ptyId }: { ptyId: string }) => <div data-testid="mounted-terminal">Terminal {ptyId}</div>,
}))
vi.mock('../components/Terminal.js', () => ({
  Terminal: ({ ptyId }: { ptyId: string }) => <div data-testid="mounted-terminal">Terminal {ptyId}</div>,
}))

function sceneWithNodes(): CanvasScene {
  const scene = createEmptyCanvasScene()
  scene.nodes = [
    {
      id: 'node-a',
      tabIds: ['tab-a'],
      activeTabId: 'tab-a',
      projectPath: '/alpha',
      rect: { x: 0, y: 0, width: 680, height: 420 },
      zIndex: 1,
      presentation: { title: 'Alpha', status: 'running' },
    },
    {
      id: 'node-b',
      tabIds: ['tab-b'],
      activeTabId: 'tab-b',
      projectPath: '/beta',
      rect: { x: 760, y: 0, width: 680, height: 420 },
      zIndex: 2,
      presentation: { title: 'Beta', status: 'waiting' },
    },
  ]
  return scene
}

function renderCanvas(overrides: Partial<React.ComponentProps<typeof CanvasWorkspaceView>> = {}) {
  const onSceneChange = vi.fn()
  const onFocusTab = vi.fn()
  const view = render(
    <div style={{ width: 1200, height: 800 }}>
      <CanvasWorkspaceView
        tabs={[
          { id: 'tab-a', projectPath: '/alpha', title: 'Alpha terminal' },
          { id: 'tab-b', projectPath: '/beta', title: 'Beta terminal' },
        ]}
        projects={[
          { path: '/alpha', name: 'Alpha project', color: '#5ca3d8' },
          { path: '/beta', name: 'Beta project', color: '#8dae78' },
        ]}
        theme={darkTheme}
        scene={sceneWithNodes()}
        onSceneChange={onSceneChange}
        focusedTabId={null}
        onFocusTab={onFocusTab}
        onCloseTab={vi.fn()}
        onRenameTab={vi.fn()}
        {...overrides}
      />
    </div>
  )
  return { ...view, onSceneChange, onFocusTab }
}

describe('CanvasWorkspaceView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    global.ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    window.PointerEvent = MouseEvent as typeof PointerEvent
  })

  // AC: @canvas-accessibility ac-2
  it('exposes the spatial canvas and its controls accessibly', () => {
    renderCanvas()

    expect(screen.getByRole('application', { name: /spatial terminal canvas/i })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('toolbar', { name: 'Canvas controls' })).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: 'Terminal nodes' })).toHaveAttribute('aria-multiselectable', 'true')
    expect(screen.getByRole('option', { name: /Alpha terminal, Running/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Beta terminal, Needs input/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /canvas minimap/i })).toBeInTheDocument()
  })

  // AC: @canvas-node-interaction ac-3
  it('selects nodes and offers selection arrangement actions', async () => {
    const { container, onSceneChange } = renderCanvas()
    const alpha = container.querySelector<HTMLElement>('[data-node-id="node-a"]')!

    fireEvent.pointerDown(alpha, { button: 0 })
    expect(container.querySelector('[data-node-id="node-a"]')).toHaveAttribute('aria-selected', 'true')
    fireEvent.pointerDown(container.querySelector<HTMLElement>('[data-node-id="node-b"]')!, { button: 0, shiftKey: true })

    expect(container.querySelector('[data-node-id="node-a"]')).toHaveAttribute('aria-selected', 'true')
    expect(container.querySelector('[data-node-id="node-b"]')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('toolbar', { name: 'Arrange selected terminals' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Row' }))
    await waitFor(() => expect(onSceneChange).toHaveBeenCalled())
  })

  // AC: @canvas-navigation ac-3
  it('navigates nodes with the keyboard and activates with Enter', () => {
    const { container, onFocusTab } = renderCanvas()
    const surface = screen.getByRole('application', { name: /spatial terminal canvas/i })
    surface.focus()

    fireEvent.keyDown(surface, { key: 'ArrowRight' })
    expect(container.querySelector('[data-node-id="node-a"]')).toHaveClass('is-focused')
    fireEvent.keyDown(surface, { key: 'ArrowRight' })
    expect(container.querySelector('[data-node-id="node-b"]')).toHaveClass('is-focused')
    fireEvent.keyDown(surface, { key: 'Enter' })
    expect(onFocusTab).toHaveBeenCalledWith('tab-b')
  })

  // AC: @canvas-accessibility ac-1
  // AC: @canvas-accessibility ac-3
  it('moves selected terminals from the keyboard and announces focus and selection', async () => {
    const { onSceneChange } = renderCanvas()
    const surface = screen.getByRole('application', { name: /spatial terminal canvas/i })
    surface.focus()

    fireEvent.keyDown(surface, { key: 'ArrowRight' })
    expect(document.querySelector('.canvas-live-region')).toHaveTextContent('Alpha focused. 1 terminal selected.')

    fireEvent.keyDown(surface, { key: 'ArrowRight', shiftKey: true })
    await waitFor(() => expect(onSceneChange).toHaveBeenCalled())
    expect((onSceneChange.mock.calls.at(-1)?.[0] as CanvasScene).nodes[0].rect.x).toBe(20)
  })

  // AC: @canvas-terminal-lifecycle ac-3
  it('bounds live terminal mounts and renders suspended previews', async () => {
    const { container } = renderCanvas({ maxMountedTerminals: 1 })

    await waitFor(() => expect(screen.getAllByTestId('mounted-terminal')).toHaveLength(1))
    expect(container.querySelectorAll('.canvas-node__preview')).toHaveLength(1)
  })

  // AC: @canvas-node-interaction ac-1
  it('drags at arbitrary zoom and clamps resize to the minimum size', async () => {
    const zoomed = sceneWithNodes()
    zoomed.camera.zoom = 0.5
    const { container, onSceneChange } = renderCanvas({ scene: zoomed })
    const header = container.querySelector<HTMLElement>('[data-node-id="node-a"] .canvas-node__header')!

    fireEvent.pointerDown(header, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 110, clientY: 60 })
    fireEvent.pointerUp(window)
    await waitFor(() => expect(onSceneChange).toHaveBeenCalled())
    const moved = onSceneChange.mock.calls.at(-1)?.[0] as CanvasScene
    expect(moved.nodes[0].rect).toMatchObject({ x: 200, y: 100 })

    const selectedNode = container.querySelector<HTMLElement>('[data-node-id="node-a"]')!
    fireEvent.pointerDown(selectedNode, { button: 0 })
    const resize = container.querySelector<HTMLElement>('.canvas-node__resize--se')!
    fireEvent.pointerDown(resize, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: -2000, clientY: -2000 })
    fireEvent.pointerUp(window)
    await waitFor(() => {
      const latest = onSceneChange.mock.calls.at(-1)?.[0] as CanvasScene
      expect(latest.nodes[0].rect).toMatchObject({ width: 360, height: 220 })
    })
  })

  // AC: @canvas-node-interaction ac-2
  it('renames and moves a group with its contained nodes', async () => {
    const grouped = sceneWithNodes()
    grouped.groups = [{
      id: 'review',
      title: 'Review',
      rect: { x: -40, y: -40, width: 1520, height: 500 },
      zIndex: 0,
      collapsed: false,
    }]
    grouped.nodes = grouped.nodes.map(node => ({ ...node, groupId: 'review' }))
    const { container, onSceneChange } = renderCanvas({ scene: grouped })

    fireEvent.doubleClick(screen.getByTitle('Double-click to rename group'))
    const titleInput = screen.getByRole('textbox', { name: 'Group title' })
    fireEvent.change(titleInput, { target: { value: 'Deployment' } })
    fireEvent.keyDown(titleInput, { key: 'Enter' })
    await waitFor(() => expect(onSceneChange).toHaveBeenCalled())
    expect((onSceneChange.mock.calls.at(-1)?.[0] as CanvasScene).groups[0].title).toBe('Deployment')

    onSceneChange.mockClear()
    const groupHeader = container.querySelector<HTMLElement>('.canvas-group > header')!
    fireEvent.pointerDown(groupHeader, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 70, clientY: 50 })
    fireEvent.pointerUp(window)
    await waitFor(() => expect(onSceneChange).toHaveBeenCalled())
    const moved = onSceneChange.mock.calls.at(-1)?.[0] as CanvasScene
    expect(moved.groups[0].rect).toMatchObject({ x: 20, y: 0 })
    expect(moved.nodes[0].rect).toMatchObject({ x: 60, y: 40 })
    expect(moved.nodes[1].rect).toMatchObject({ x: 820, y: 40 })
  })

  // AC: @canvas-node-interaction ac-4
  it('places dropped sessions and reports dropped projects at world coordinates', async () => {
    const onDropProject = vi.fn()
    const { onSceneChange } = renderCanvas({ onDropProject })
    const surface = screen.getByRole('application', { name: /spatial terminal canvas/i })
    const sessionTransfer = {
      types: ['application/x-subtab'],
      dropEffect: 'none',
      getData: (type: string) => type === 'application/x-subtab' ? JSON.stringify({ tabId: 'tab-a' }) : '',
    }

    fireEvent.dragOver(surface, { dataTransfer: sessionTransfer })
    const sessionDrop = new MouseEvent('drop', { clientX: 320, clientY: 180, bubbles: true, cancelable: true })
    Object.defineProperty(sessionDrop, 'dataTransfer', { value: sessionTransfer })
    fireEvent(surface, sessionDrop)
    await waitFor(() => expect(onSceneChange).toHaveBeenCalled())
    const moved = onSceneChange.mock.calls.at(-1)?.[0] as CanvasScene
    expect(moved.nodes[0].rect).toMatchObject({ x: 320, y: 180 })
    expect(moved.nodes[1].rect).toMatchObject({ x: 760, y: 0 })

    const projectTransfer = {
      types: ['application/x-sidebar-project'],
      dropEffect: 'none',
      getData: (type: string) => type === 'application/x-sidebar-project' ? '/beta' : '',
    }
    const projectDrop = new MouseEvent('drop', { clientX: 200, clientY: 140, bubbles: true, cancelable: true })
    Object.defineProperty(projectDrop, 'dataTransfer', { value: projectTransfer })
    fireEvent(surface, projectDrop)
    expect(onDropProject).toHaveBeenCalledWith('/beta', { x: 200, y: 140 })
  })

  // AC: @canvas-navigation ac-1
  it('zooms around the cursor with modified wheel input', async () => {
    const { onSceneChange } = renderCanvas()
    const surface = screen.getByRole('application', { name: /spatial terminal canvas/i })
    const wheel = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: 400, clientY: 300, bubbles: true, cancelable: true })
    expect(fireEvent(surface, wheel)).toBe(false)
    expect(wheel.defaultPrevented).toBe(true)

    await waitFor(() => expect(onSceneChange).toHaveBeenCalled())
    expect(onSceneChange.mock.calls.at(-1)?.[0].camera.zoom).toBeGreaterThan(1)
  })
})
