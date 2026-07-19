import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/mock/userData' } }))
vi.mock('../mobile-server/utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('../mobile-server/utils')>(),
  log: vi.fn(),
}))

import { MobileServer } from '../mobile-server'

describe('MobileServer agent signal lifecycle', () => {
  // AC: @agent-session-notifications ac-1
  // AC: @agent-session-notifications ac-2
  it('unsubscribes when stopped and resubscribes when restarted', () => {
    const unsubscribe = vi.fn()
    const onAgentSessionSignal = vi.fn(() => unsubscribe)
    const server = Object.create(MobileServer.prototype) as MobileServer & Record<string, unknown>
    Object.assign(server, {
      unsubscribeAgentSessionSignals: null,
      connectedClients: new Set(),
      rateLimitCleanupInterval: null,
      wss: null,
      server: null,
    })

    server.setPtyManager({ onAgentSessionSignal })
    server.stop()
    ;(server as any).subscribeAgentSessionSignals()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(onAgentSessionSignal).toHaveBeenCalledTimes(2)

    server.stop()
    expect(unsubscribe).toHaveBeenCalledTimes(2)
    expect((server as any).unsubscribeAgentSessionSignals).toBeNull()
  })
})
