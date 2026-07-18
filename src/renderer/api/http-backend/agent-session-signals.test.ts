import { describe, expect, it, vi } from 'vitest'
import { emitAgentSessionSignal, onAgentSessionSignal } from './agent-session-signals'

describe('HTTP agent session signal bridge', () => {
  // AC: @agent-session-notifications ac-1
  // AC: @agent-session-notifications ac-2
  it('delivers typed mobile signals globally and supports unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = onAgentSessionSignal(listener)

    emitAgentSessionSignal({ ptyId: 'pty-background', type: 'input-needed' })
    expect(listener).toHaveBeenCalledWith({ ptyId: 'pty-background', type: 'input-needed' })

    unsubscribe()
    emitAgentSessionSignal({ ptyId: 'pty-background', type: 'complete' })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
