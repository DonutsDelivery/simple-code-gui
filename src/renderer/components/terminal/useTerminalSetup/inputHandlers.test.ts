import { describe, expect, it, vi } from 'vitest'
import { createDataHandler, createInputHandlerState, createKeyEventHandler, isHermesMouseMotionReport } from './inputHandlers'

describe('Hermes terminal mouse-report filtering', () => {
  it('recognizes motion reports without swallowing wheel or click reports', () => {
    expect(isHermesMouseMotionReport('\x1b[<35;120;42M')).toBe(true)
    expect(isHermesMouseMotionReport('\x1b[<35;120;42M\x1b[<35;121;42M')).toBe(true)
    expect(isHermesMouseMotionReport('\x1b[<64;50;20M')).toBe(false)
    expect(isHermesMouseMotionReport('\x1b[<0;50;20m')).toBe(false)
    expect(isHermesMouseMotionReport('\x1b[A')).toBe(false)
    expect(isHermesMouseMotionReport('normal text')).toBe(false)
  })

  it('drops mouse motion for Hermes without dropping keyboard input', () => {
    const writePty = vi.fn()
    const onUserInput = vi.fn()
    const currentLineInputRef = { current: '' }
    const handler = createDataHandler(
      writePty,
      'pty-1',
      onUserInput,
      currentLineInputRef,
      createInputHandlerState(),
      { current: false },
      'hermes',
    )

    handler('\x1b[<35;120;42M')
    expect(writePty).not.toHaveBeenCalled()
    expect(currentLineInputRef.current).toBe('')

    handler('x')
    return new Promise<void>(resolve => setTimeout(() => {
      expect(writePty).toHaveBeenCalledWith('pty-1', 'x')
      expect(currentLineInputRef.current).toBe('x')
      resolve()
    }, 25))
  })
})

describe('Hermes terminal paging', () => {
  it('forwards PageUp and PageDown to the Hermes TUI', () => {
    const writePty = vi.fn()
    const handler = createKeyEventHandler({ getSelection: () => '' } as any, writePty, 'pty-1', 'hermes')
    const pageUp = { type: 'keydown', key: 'PageUp', preventDefault: vi.fn() } as unknown as KeyboardEvent
    const pageDown = { type: 'keydown', key: 'PageDown', preventDefault: vi.fn() } as unknown as KeyboardEvent

    expect(handler(pageUp)).toBe(false)
    expect(handler(pageDown)).toBe(false)
    expect(pageUp.preventDefault).toHaveBeenCalled()
    expect(pageDown.preventDefault).toHaveBeenCalled()
    expect(writePty.mock.calls).toEqual([
      ['pty-1', '\x1b[5~'],
      ['pty-1', '\x1b[6~'],
    ])
  })
})
