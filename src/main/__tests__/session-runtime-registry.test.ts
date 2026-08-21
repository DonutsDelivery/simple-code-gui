import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentCommandRouter } from '../environment-command-router'
import { EnvironmentEventLog } from '../environment-event-log'
import { EnvironmentState } from '../environment-state'
import { SessionRuntimeRegistry } from '../session-runtime-registry'

class FakePtyManager {
  private nextId = 0
  private live = new Map<string, object>()
  private exitListeners = new Map<string, Set<(code: number) => void>>()
  readonly spawn = vi.fn(() => {
    const id = `pty-${++this.nextId}`
    this.live.set(id, {})
    return id
  })
  readonly writeUserInput = vi.fn()
  readonly write = vi.fn()
  readonly resize = vi.fn()
  readonly terminate = vi.fn(async (id: string) => this.exit(id))

  getProcess(id: string): object | undefined {
    return this.live.get(id)
  }

  addExitListener(id: string, listener: (code: number) => void): () => void {
    const listeners = this.exitListeners.get(id) ?? new Set()
    listeners.add(listener)
    this.exitListeners.set(id, listeners)
    return () => listeners.delete(listener)
  }

  exit(id: string, code = 0): void {
    this.live.delete(id)
    for (const listener of this.exitListeners.get(id) ?? []) listener(code)
  }
}

describe('SessionRuntimeRegistry', () => {
  let ptyManager: FakePtyManager
  let router: EnvironmentCommandRouter
  let registry: SessionRuntimeRegistry

  beforeEach(() => {
    ptyManager = new FakePtyManager()
    const state = new EnvironmentState('server-a', {
      projects: [{ path: '/repo', name: 'Repo' }],
      sessions: [],
      activeSessionId: null,
    })
    router = new EnvironmentCommandRouter(state, new EnvironmentEventLog('server-a'))
    registry = new SessionRuntimeRegistry(ptyManager as any, router)
  })

  it('coalesces concurrent resume requests onto one canonical runtime and PTY', async () => {
    const spec = {
      agentSessionId: 'session-a',
      nativeSessionId: 'session-a',
      projectId: '/repo',
      harnessId: 'claude' as const,
    }

    const [first, second] = await Promise.all([
      registry.ensureRuntime(spec),
      registry.ensureRuntime(spec),
    ])

    expect(ptyManager.spawn).toHaveBeenCalledTimes(1)
    expect(second).toMatchObject({
      agentSessionId: first.agentSessionId,
      runtimeId: first.runtimeId,
      ptyId: first.ptyId,
      created: false,
    })
    expect(router.getSnapshot()).toMatchObject({
      sessions: [{
        agentSessionId: 'session-a',
        runtimeId: first.runtimeId,
        ptyId: first.ptyId,
        lifecycle: 'running',
      }],
      ptys: [{
        agentSessionId: 'session-a',
        runtimeId: first.runtimeId,
        ptyId: first.ptyId,
        lifecycle: 'running',
      }],
    })
  })

  it('keeps the canonical session after exit and creates one replacement runtime', async () => {
    const spec = {
      agentSessionId: 'session-a',
      nativeSessionId: 'session-a',
      projectId: '/repo',
      harnessId: 'claude' as const,
    }
    const first = await registry.ensureRuntime(spec)

    ptyManager.exit(first.ptyId)
    expect(router.getSnapshot().sessions[0]).toMatchObject({
      agentSessionId: 'session-a',
      lifecycle: 'stopped',
    })
    expect(router.getSnapshot().sessions[0].ptyId).toBeUndefined()

    const resumed = await registry.ensureRuntime(spec)
    expect(ptyManager.spawn).toHaveBeenCalledTimes(2)
    expect(resumed.agentSessionId).toBe('session-a')
    expect(resumed.runtimeId).not.toBe(first.runtimeId)
    expect(resumed.ptyId).not.toBe(first.ptyId)
  })

  it('uses the server-generated PTY identity as the canonical ID for a new session', async () => {
    const runtime = await registry.ensureRuntime({
      projectId: '/repo',
      harnessId: 'hermes',
    })

    expect(runtime.agentSessionId).toBe(runtime.ptyId)
    expect(router.getSnapshot().sessions[0]).toMatchObject({
      agentSessionId: runtime.ptyId,
      harnessId: 'hermes',
      runtimeId: runtime.runtimeId,
    })
  })

  it('rejects attaching a canonical session through another harness', async () => {
    await registry.ensureRuntime({
      agentSessionId: 'session-a',
      nativeSessionId: 'session-a',
      projectId: '/repo',
      harnessId: 'claude',
    })

    await expect(registry.ensureRuntime({
      agentSessionId: 'session-a',
      nativeSessionId: 'session-a',
      projectId: '/repo',
      harnessId: 'hermes',
    })).rejects.toThrow('already running with harness claude')
    expect(ptyManager.spawn).toHaveBeenCalledTimes(1)
  })

  it('rejects rebinding a canonical session to another native conversation', async () => {
    const first = await registry.ensureRuntime({
      agentSessionId: 'session-a',
      nativeSessionId: 'native-a',
      projectId: '/repo',
      harnessId: 'claude',
    })

    await expect(registry.ensureRuntime({
      agentSessionId: 'session-a',
      nativeSessionId: 'native-b',
      projectId: '/repo',
      harnessId: 'claude',
    })).rejects.toThrow('already bound to native session native-a')
    expect(registry.getRuntime('session-a')?.ptyId).toBe(first.ptyId)
    expect(ptyManager.spawn).toHaveBeenCalledTimes(1)
  })

  it('holds reconnects until the previous OS process has terminated', async () => {
    const spec = {
      agentSessionId: 'session-a',
      nativeSessionId: 'session-a',
      projectId: '/repo',
      harnessId: 'claude' as const,
    }
    const first = await registry.ensureRuntime(spec)
    let finishTermination!: () => void
    ptyManager.terminate.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finishTermination = resolve })
      ptyManager.exit(first.ptyId)
    })

    const stopping = registry.stopRuntimeByPty(first.ptyId)
    const reconnecting = registry.ensureRuntime(spec)
    await Promise.resolve()
    expect(ptyManager.spawn).toHaveBeenCalledTimes(1)

    finishTermination()
    await stopping
    const replacement = await reconnecting
    expect(replacement.ptyId).not.toBe(first.ptyId)
    expect(ptyManager.spawn).toHaveBeenCalledTimes(2)
  })

  it('ignores a stale exit callback after a replacement runtime is installed', async () => {
    const spec = {
      agentSessionId: 'session-a',
      nativeSessionId: 'session-a',
      projectId: '/repo',
      harnessId: 'claude' as const,
    }
    const first = await registry.ensureRuntime(spec)
    const oldExit = [...(ptyManager as any).exitListeners.get(first.ptyId)][0] as (code: number) => void
    await registry.stopRuntimeByPty(first.ptyId)
    const replacement = await registry.ensureRuntime(spec)

    // Simulate a delayed old-generation callback whose reverse mapping survived
    // another failure path. The captured runtime generation must still protect
    // the replacement.
    ;(registry as any).sessionByPty.set(first.ptyId, 'session-a')
    oldExit(0)

    expect(registry.getRuntime('session-a')).toMatchObject({
      runtimeId: replacement.runtimeId,
      ptyId: replacement.ptyId,
    })
    expect(router.getSnapshot().sessions[0]).toMatchObject({
      runtimeId: replacement.runtimeId,
      ptyId: replacement.ptyId,
      lifecycle: 'running',
    })
  })

  it('serializes input and resize through the canonical runtime boundary', async () => {
    const runtime = await registry.ensureRuntime({
      agentSessionId: 'session-a',
      nativeSessionId: 'session-a',
      projectId: '/repo',
      harnessId: 'claude',
    })

    expect(registry.writeInput(runtime.ptyId, 'first')).toEqual({
      runtimeId: runtime.runtimeId,
      sequence: 1,
    })
    expect(registry.writeInput(runtime.ptyId, 'second')).toEqual({
      runtimeId: runtime.runtimeId,
      sequence: 2,
    })
    expect(registry.resize(runtime.ptyId, 120, 40)).toBe(true)

    expect(ptyManager.writeUserInput.mock.calls).toEqual([
      [runtime.ptyId, 'first'],
      [runtime.ptyId, 'second'],
    ])
    expect(ptyManager.resize).toHaveBeenCalledWith(runtime.ptyId, 120, 40)
  })

  it('ignores a stale resize after the PTY runtime has disappeared', async () => {
    const runtime = await registry.ensureRuntime({
      agentSessionId: 'stale-resize-session',
      projectId: '/repo',
      harnessId: 'claude',
    })
    await registry.stopRuntimeByPty(runtime.ptyId)
    ptyManager.resize.mockClear()

    expect(registry.resize(runtime.ptyId, 80, 24)).toBe(false)
    expect(ptyManager.resize).not.toHaveBeenCalled()
  })
})
