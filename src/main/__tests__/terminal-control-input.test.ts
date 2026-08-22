import { describe, expect, it } from 'vitest'
import { isTerminalControlInput } from '../terminal-control-input'

describe('isTerminalControlInput', () => {
  it('recognizes SGR and legacy mouse reports used for terminal scrolling', () => {
    expect(isTerminalControlInput('\x1b[<64;120;30M')).toBe(true)
    expect(isTerminalControlInput('\x1b[M`xy')).toBe(true)
  })

  it('recognizes cursor-position replies', () => {
    expect(isTerminalControlInput('\x1b[12;40R')).toBe(true)
  })

  it('keeps keyboard input classified as user input', () => {
    expect(isTerminalControlInput('hello')).toBe(false)
    expect(isTerminalControlInput('\r')).toBe(false)
  })
})
