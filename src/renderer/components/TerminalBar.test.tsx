import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalBar } from './TerminalBar'

function renderBar(backend: 'claude' | 'gemini' = 'claude') {
  const onCommand = vi.fn()
  render(
    <TerminalBar
      ptyId="pty-1"
      currentBackend={backend}
      onCommand={onCommand}
      onBackendChange={vi.fn()}
    />
  )
  return { onCommand }
}

describe('TerminalBar command menus', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  })

  // AC: @gsd-integration-retirement ac-1
  it('does not expose a dedicated GSD command menu', () => {
    renderBar()

    expect(screen.queryByRole('button', { name: 'GSD' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commands' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Session' })).toBeInTheDocument()
  })

  // AC: @compact-terminal-command-menus ac-1
  // AC: @compact-terminal-command-menus ac-2
  it('uses dense layouts only for long production menu categories', async () => {
    renderBar('gemini')

    fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
    expect(await screen.findByRole('menu', { name: 'Commands' })).toHaveClass('terminal-bar-dropdown--dense')

    fireEvent.click(screen.getByRole('button', { name: 'Session' }))
    expect(await screen.findByRole('menu', { name: 'Session' })).toHaveClass('terminal-bar-dropdown--single')
  })

  // AC: @compact-terminal-command-menus ac-3
  it('supports roving focus, activation, Escape, and trigger restoration', async () => {
    const { onCommand } = renderBar()
    const trigger = screen.getByRole('button', { name: 'Session' })
    fireEvent.click(trigger)

    const summarize = await screen.findByRole('menuitem', { name: 'Summarize Context' })
    const cancel = screen.getByRole('menuitem', { name: 'Cancel Request' })
    await waitFor(() => expect(summarize).toHaveFocus())

    fireEvent.keyDown(summarize, { key: 'ArrowDown' })
    expect(cancel).toHaveFocus()
    fireEvent.keyDown(cancel, { key: 'Home' })
    expect(summarize).toHaveFocus()
    fireEvent.click(summarize)
    expect(onCommand).toHaveBeenCalledWith('summarize')
    await waitFor(() => expect(trigger).toHaveFocus())

    fireEvent.click(trigger)
    const menu = await screen.findByRole('menu', { name: 'Session' })
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  // AC: @compact-terminal-command-menus ac-4
  it('keeps the portal menu constrained and repositions it on viewport changes', async () => {
    renderBar('gemini')
    const trigger = screen.getByRole('button', { name: 'Commands' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(1160, 760, 32, 24))

    fireEvent.click(trigger)
    const menu = await screen.findByRole('menu', { name: 'Commands' })
    Object.defineProperty(menu, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(0, 0, 440, 420),
    })
    fireEvent(window, new Event('resize'))

    await waitFor(() => {
      expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(752)
      expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(8)
    })
  })
})
