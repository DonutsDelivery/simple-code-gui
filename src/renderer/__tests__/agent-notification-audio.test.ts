import { describe, expect, it, vi } from 'vitest'
import { playAgentNotificationSound } from '../utils/agentNotificationAudio'

function audioHarness() {
  const oscillators: Array<{ frequency: number; start: number; stop: number }> = []
  const gains: number[] = []
  const context = {
    currentTime: 10,
    destination: {} as AudioDestinationNode,
    state: 'running' as AudioContextState,
    resume: vi.fn().mockResolvedValue(undefined),
    createOscillator: vi.fn(() => {
      const record = { frequency: 0, start: 0, stop: 0 }
      oscillators.push(record)
      return {
        type: 'sine',
        frequency: { setValueAtTime: (value: number) => { record.frequency = value } },
        connect: vi.fn(),
        start: (time: number) => { record.start = time },
        stop: (time: number) => { record.stop = time },
      } as unknown as OscillatorNode
    }),
    createGain: vi.fn(() => ({
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: (value: number) => { gains.push(value) },
      },
      connect: vi.fn(),
    } as unknown as GainNode)),
  }
  return { context, oscillators, gains }
}

describe('agent notification audio', () => {
  // AC: @agent-session-notifications ac-1
  // AC: @agent-session-notifications ac-2
  it('uses distinct two-note patterns for completion and input-needed cues', () => {
    const completed = audioHarness()
    playAgentNotificationSound('completed', 0.65, completed.context)
    const needsInput = audioHarness()
    playAgentNotificationSound('needs-input', 0.65, needsInput.context)

    expect(completed.oscillators.map(note => note.frequency)).toEqual([523.25, 659.25])
    expect(needsInput.oscillators.map(note => note.frequency)).toEqual([659.25, 659.25])
    expect(completed.oscillators.map(note => note.start)).not.toEqual(needsInput.oscillators.map(note => note.start))
  })

  // AC: @agent-session-notifications ac-6
  it('clamps independent notification volume and skips muted playback', () => {
    const loud = audioHarness()
    playAgentNotificationSound('completed', 5, loud.context)
    expect(Math.max(...loud.gains)).toBeLessThanOrEqual(0.18)

    const muted = audioHarness()
    playAgentNotificationSound('completed', 0, muted.context)
    expect(muted.context.createOscillator).not.toHaveBeenCalled()
  })

  // AC: @agent-session-notifications ac-6
  it('keeps AudioContext construction failures non-fatal', () => {
    vi.stubGlobal('AudioContext', class {
      constructor() { throw new Error('audio unavailable') }
    })
    expect(() => playAgentNotificationSound('completed', 0.65)).not.toThrow()
    vi.unstubAllGlobals()
  })

  // AC: @agent-session-notifications ac-6
  it('keeps audio failures non-fatal so visual attention can continue', () => {
    const broken = audioHarness()
    broken.context.createOscillator.mockImplementation(() => { throw new Error('audio blocked') })
    expect(() => playAgentNotificationSound('needs-input', 0.65, broken.context)).not.toThrow()
  })
})
