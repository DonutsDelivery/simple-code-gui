import { describe, expect, it, vi } from 'vitest'
import { createWheelHandler } from './eventHandlers.js'

function createTerminal(overrides: Partial<any> = {}) {
  const screen = document.createElement('div')
  screen.className = 'xterm-screen'
  screen.getBoundingClientRect = () => ({
    left: 10,
    top: 20,
    width: 800,
    height: 400,
    right: 810,
    bottom: 420,
    x: 10,
    y: 20,
    toJSON: () => {},
  })

  const element = document.createElement('div')
  element.appendChild(screen)

  return {
    cols: 80,
    rows: 20,
    element,
    options: { fontSize: 14 },
    buffer: {
      active: {
        type: 'normal',
        viewportY: 0,
        baseY: 10,
      },
    },
    modes: {
      mouseTrackingMode: 'none',
    },
    ...overrides,
  }
}

function createWheelEvent(init: Partial<WheelEvent> = {}): WheelEvent {
  return {
    ctrlKey: false,
    deltaY: 0,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    clientX: 0,
    clientY: 0,
    preventDefault: vi.fn(),
    ...init,
  } as unknown as WheelEvent
}

describe('createWheelHandler', () => {
  it('handles Ctrl+wheel zoom without passing the event to xterm', () => {
    const terminal = createTerminal()
    const fitAddon = {
      fit: vi.fn(),
      proposeDimensions: vi.fn(() => ({ cols: 100, rows: 30 })),
    }
    const resizePty = vi.fn()
    const writePty = vi.fn()
    const event = createWheelEvent({ ctrlKey: true, deltaY: -100 })

    const result = createWheelHandler(
      terminal as any,
      fitAddon as any,
      { current: false },
      resizePty,
      'pty-1',
      writePty,
      'opencode'
    )(event)

    expect(result).toBe(false)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(terminal.options.fontSize).toBe(15)
    expect(resizePty).toHaveBeenCalledWith('pty-1', 100, 30)
    expect(writePty).not.toHaveBeenCalled()
  })

  it('lets normal-buffer wheel events pass through to xterm while tracking scroll state', () => {
    const terminal = createTerminal()
    const writePty = vi.fn()
    const userScrolledUpRef = { current: false }
    const event = createWheelEvent({ deltaY: -80 })

    const result = createWheelHandler(
      terminal as any,
      { fit: vi.fn(), proposeDimensions: vi.fn() } as any,
      userScrolledUpRef,
      vi.fn(),
      'pty-1',
      writePty,
      'opencode'
    )(event)

    expect(result).toBe(true)
    expect(userScrolledUpRef.current).toBe(true)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(writePty).not.toHaveBeenCalled()
  })

  it('synthesizes SGR wheel reports for OpenCode alternate-buffer fallback', () => {
    const terminal = createTerminal({
      buffer: {
        active: {
          type: 'alternate',
          viewportY: 0,
          baseY: 0,
        },
      },
    })
    const writePty = vi.fn()
    const event = createWheelEvent({ deltaY: -80, clientX: 115, clientY: 65 })

    const result = createWheelHandler(
      terminal as any,
      { fit: vi.fn(), proposeDimensions: vi.fn() } as any,
      { current: false },
      vi.fn(),
      'pty-1',
      writePty,
      'opencode'
    )(event)

    expect(result).toBe(false)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(writePty).toHaveBeenCalledWith('pty-1', '\x1b[<64;11;3M\x1b[<64;11;3M')
  })
})
