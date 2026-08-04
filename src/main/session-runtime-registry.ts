import crypto from 'crypto'
import type { Backend, PtyManager } from './pty-manager.js'
import type { EnvironmentCommand, EnvironmentCommandRouter } from './environment-command-router.js'

export interface RuntimeSpawnSpec {
  agentSessionId?: string
  nativeSessionId?: string
  projectId: string
  harnessId: Backend
  autoAcceptTools?: string[]
  permissionMode?: string
  model?: string
  hermesTmuxSessionId?: string
}

export interface SessionRuntimeHandle {
  agentSessionId: string
  runtimeId: string
  ptyId: string
  projectId: string
  harnessId: Backend
  nativeSessionId?: string
  created: boolean
}

type RuntimeSpawner = Pick<
  PtyManager,
  'spawn' | 'terminate' | 'getProcess' | 'addExitListener' | 'writeUserInput' | 'write' | 'resize'
>

interface LiveRuntime extends Omit<SessionRuntimeHandle, 'created'> {}

/**
 * Server-owned single-flight boundary between canonical agent sessions and PTYs.
 * Frontends may request attach/resume concurrently, but only this registry may
 * decide whether a process already exists or one new process must be spawned.
 */
export class SessionRuntimeRegistry {
  private readonly liveBySession = new Map<string, LiveRuntime>()
  private readonly sessionByPty = new Map<string, string>()
  private readonly inFlight = new Map<string, Promise<SessionRuntimeHandle>>()
  private readonly inputSequenceByRuntime = new Map<string, number>()
  private readonly stoppingBySession = new Map<string, Promise<void>>()

  constructor(
    private readonly ptyManager: RuntimeSpawner,
    private readonly environmentRouter: EnvironmentCommandRouter,
  ) {}

  getRuntime(agentSessionId: string): SessionRuntimeHandle | null {
    const runtime = this.liveBySession.get(agentSessionId)
    if (!runtime || !this.ptyManager.getProcess(runtime.ptyId)) return null
    return { ...runtime, created: false }
  }

  getRuntimeByPty(ptyId: string): SessionRuntimeHandle | null {
    const agentSessionId = this.sessionByPty.get(ptyId)
    return agentSessionId ? this.getRuntime(agentSessionId) : null
  }

  writeInput(ptyId: string, data: string, terminalDeviceResponse = false): {
    runtimeId: string
    sequence: number
  } {
    const runtime = this.getRuntimeByPty(ptyId)
    if (!runtime) throw new Error(`Runtime for PTY ${ptyId} not found`)
    const sequence = (this.inputSequenceByRuntime.get(runtime.runtimeId) ?? 0) + 1
    this.inputSequenceByRuntime.set(runtime.runtimeId, sequence)
    if (terminalDeviceResponse) this.ptyManager.write(ptyId, data)
    else this.ptyManager.writeUserInput(ptyId, data)
    return { runtimeId: runtime.runtimeId, sequence }
  }

  resize(ptyId: string, cols: number, rows: number): void {
    if (!this.getRuntimeByPty(ptyId)) throw new Error(`Runtime for PTY ${ptyId} not found`)
    this.ptyManager.resize(ptyId, cols, rows)
  }

  async ensureRuntime(spec: RuntimeSpawnSpec): Promise<SessionRuntimeHandle> {
    const requestedSessionId = spec.agentSessionId || spec.nativeSessionId
    if (requestedSessionId) {
      await this.stoppingBySession.get(requestedSessionId)
      const existing = this.getRuntime(requestedSessionId)
      if (existing) {
        this.assertCompatible(existing, spec)
        return existing
      }

      const pending = this.inFlight.get(requestedSessionId)
      if (pending) {
        const runtime = await pending
        this.assertCompatible(runtime, spec)
        return { ...runtime, created: false }
      }
    }

    const operation = this.spawnRuntime(spec, requestedSessionId)
    if (requestedSessionId) this.inFlight.set(requestedSessionId, operation)
    try {
      return await operation
    } finally {
      if (requestedSessionId && this.inFlight.get(requestedSessionId) === operation) {
        this.inFlight.delete(requestedSessionId)
      }
    }
  }

  async stopRuntimeByPty(ptyId: string): Promise<boolean> {
    const agentSessionId = this.sessionByPty.get(ptyId)
    if (!agentSessionId) return false
    const runtime = this.liveBySession.get(agentSessionId)
    if (!runtime || runtime.ptyId !== ptyId) return false

    const stopPromise = this.ptyManager.terminate(ptyId).finally(() => {
      if (this.stoppingBySession.get(agentSessionId) === stopPromise) {
        this.stoppingBySession.delete(agentSessionId)
      }
    })
    this.stoppingBySession.set(agentSessionId, stopPromise)

    this.liveBySession.delete(agentSessionId)
    this.sessionByPty.delete(ptyId)
    this.inputSequenceByRuntime.delete(runtime.runtimeId)
    this.commit({ type: 'stop-session', agentSessionId })
    await stopPromise
    return true
  }

  private async spawnRuntime(
    spec: RuntimeSpawnSpec,
    requestedSessionId?: string,
  ): Promise<SessionRuntimeHandle> {
    const snapshot = this.environmentRouter.getSnapshot()
    if (requestedSessionId) {
      const canonical = snapshot.sessions.find(session => session.agentSessionId === requestedSessionId)
      if (canonical) {
        if (canonical.harnessId !== spec.harnessId) {
          throw new Error(
            `Session ${requestedSessionId} belongs to harness ${canonical.harnessId}; create a new session to use ${spec.harnessId}`,
          )
        }
        if (canonical.projectId !== spec.projectId) {
          throw new Error(`Session ${requestedSessionId} belongs to project ${canonical.projectId}`)
        }
        if (
          canonical.nativeSessionId
          && spec.nativeSessionId
          && canonical.nativeSessionId !== spec.nativeSessionId
        ) {
          throw new Error(
            `Session ${requestedSessionId} belongs to native session ${canonical.nativeSessionId}`,
          )
        }
      }
    }

    const ptyId = this.ptyManager.spawn(
      spec.projectId,
      spec.nativeSessionId,
      spec.autoAcceptTools,
      spec.permissionMode,
      spec.model,
      spec.harnessId,
      spec.hermesTmuxSessionId,
    )
    const agentSessionId = requestedSessionId || ptyId
    const runtimeId = crypto.randomUUID()
    const runtime: LiveRuntime = {
      agentSessionId,
      runtimeId,
      ptyId,
      projectId: spec.projectId,
      harnessId: spec.harnessId,
      nativeSessionId: spec.nativeSessionId,
    }

    this.liveBySession.set(agentSessionId, runtime)
    this.sessionByPty.set(ptyId, agentSessionId)

    const current = this.environmentRouter.getSnapshot()
    if (!current.sessions.some(session => session.agentSessionId === agentSessionId)) {
      this.commit({
        type: 'create-session',
        session: {
          agentSessionId,
          serverId: current.serverId,
          harnessId: spec.harnessId,
          nativeSessionId: spec.nativeSessionId,
          projectId: spec.projectId,
          lifecycle: 'starting',
        },
      })
    }
    this.commit({ type: 'attach-session', agentSessionId, runtimeId, ptyId })

    this.ptyManager.addExitListener(ptyId, () => {
      const current = this.liveBySession.get(agentSessionId)
      if (!current || current.runtimeId !== runtimeId || current.ptyId !== ptyId) return
      if (this.sessionByPty.get(ptyId) !== agentSessionId) return
      this.liveBySession.delete(agentSessionId)
      this.sessionByPty.delete(ptyId)
      this.inputSequenceByRuntime.delete(runtimeId)
      this.commit({ type: 'stop-session', agentSessionId })
    })

    return { ...runtime, created: true }
  }

  private commit(command: EnvironmentCommand): void {
    const snapshot = this.environmentRouter.getSnapshot()
    this.environmentRouter.execute({
      serverId: snapshot.serverId,
      clientId: 'server-runtime-registry',
      commandId: crypto.randomUUID(),
      expectedRevision: snapshot.revision,
      command,
    }, { allowRuntimeLifecycle: true })
  }

  private assertCompatible(
    runtime: Pick<SessionRuntimeHandle, 'agentSessionId' | 'harnessId' | 'projectId' | 'nativeSessionId'>,
    spec: RuntimeSpawnSpec,
  ): void {
    if (runtime.harnessId !== spec.harnessId) {
      throw new Error(
        `Session ${runtime.agentSessionId} is already running with harness ${runtime.harnessId}`,
      )
    }
    if (runtime.projectId !== spec.projectId) {
      throw new Error(`Session ${runtime.agentSessionId} is already running in ${runtime.projectId}`)
    }
    if (
      runtime.nativeSessionId
      && spec.nativeSessionId
      && runtime.nativeSessionId !== spec.nativeSessionId
    ) {
      throw new Error(
        `Session ${runtime.agentSessionId} is already bound to native session ${runtime.nativeSessionId}`,
      )
    }
  }
}
