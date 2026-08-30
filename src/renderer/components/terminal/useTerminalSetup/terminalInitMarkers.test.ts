import { describe, expect, it } from 'vitest'
import { disableHermesMouseTracking, hideStreamingAgentSignals } from './terminalInit'

const SIGNAL = '<ct-signal k="_y56ezC6Fs" t="c" />'

describe('hideStreamingAgentSignals', () => {
  it('hides complete signal metadata while preserving its width', () => {
    const state = { markerCarry: '' }
    const output = hideStreamingAgentSignals(`before${SIGNAL}after`, state)
    expect(output).not.toContain('<ct-signal')
    expect(output).not.toContain('_y56ezC6Fs')
    expect(output.length).toBe(`before${SIGNAL}after`.length)
  })

  it('never exposes a signal split across output chunks', () => {
    for (let split = 1; split < SIGNAL.length; split += 1) {
      const state = { markerCarry: '' }
      const output = hideStreamingAgentSignals(SIGNAL.slice(0, split), state)
        + hideStreamingAgentSignals(SIGNAL.slice(split), state)
      expect(output).not.toContain('<ct-signal')
      expect(output).not.toContain('_y56ezC6Fs')
      expect(output.length).toBe(SIGNAL.length)
    }
  })
})

describe('disableHermesMouseTracking', () => {
  it('removes mouse modes while preserving unrelated DEC private modes', () => {
    expect(disableHermesMouseTracking('\x1b[?1000;1006hframe', 'hermes')).toBe('frame')
    expect(disableHermesMouseTracking('\x1b[?25;1003hframe', 'hermes')).toBe('\x1b[?25hframe')
    expect(disableHermesMouseTracking('\x1b[?1000hframe', 'claude')).toBe('\x1b[?1000hframe')
  })

  it('carries a split Hermes mouse-mode sequence across PTY chunks', () => {
    const state = { mouseModeCarry: '' }
    expect(disableHermesMouseTracking('\x1b[?100', 'hermes', state)).toBe('')
    expect(disableHermesMouseTracking('6hvisible', 'hermes', state)).toBe('visible')
    expect(state.mouseModeCarry).toBe('')
  })
})
