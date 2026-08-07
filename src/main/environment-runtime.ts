import { resolve } from 'path'
import { EnvironmentCommandRouter } from './environment-command-router.js'
import { EnvironmentEventLog } from './environment-event-log.js'
import { EnvironmentState } from './environment-state.js'
import { getOrCreateFingerprint } from './mobile-security/index.js'
import { MobileServer } from './mobile-server.js'
import { PtyManager } from './pty-manager.js'
import { configureRuntimePaths } from './runtime-paths.js'
import { RepositoryRegistry } from './repository-registry.js'
import { SessionRuntimeRegistry } from './session-runtime-registry.js'
import { SessionStore } from './session-store.js'
import type { Workspace } from './session-store.js'

export interface EnvironmentRuntimeOptions {
  dataDir: string
  appPath?: string
  version: string
  serverId?: string
  host?: string
  port?: number
  voiceManager?: unknown
  startupNonce?: string
  secure?: boolean
}

export interface EnvironmentRuntimeEndpoint {
  serverId: string
  host: string
  port: number
  secure: boolean
  certFingerprint: string
  version: string
}

export class EnvironmentRuntime {
  readonly dataDir: string
  readonly serverId: string
  readonly ptyManager: PtyManager
  readonly sessionStore: SessionStore
  readonly environmentState: EnvironmentState
  readonly environmentEventLog: EnvironmentEventLog<Workspace>
  readonly environmentRouter: EnvironmentCommandRouter
  readonly runtimeRegistry: SessionRuntimeRegistry
  readonly repositoryRegistry: RepositoryRegistry
  readonly server: MobileServer

  private started = false

  constructor(private readonly options: EnvironmentRuntimeOptions) {
    this.dataDir = resolve(options.dataDir)
    configureRuntimePaths({
      dataDir: this.dataDir,
      appPath: options.appPath || process.cwd(),
    })

    this.ptyManager = new PtyManager()
    this.sessionStore = new SessionStore(this.dataDir)
    this.serverId = options.serverId || getOrCreateFingerprint()
    const storedEnvironment = this.sessionStore.getEnvironmentAuthority(this.serverId)
    this.environmentState = new EnvironmentState(
      this.serverId,
      this.sessionStore.getWorkspace(),
      storedEnvironment?.snapshot,
    )
    this.environmentEventLog = new EnvironmentEventLog<Workspace>(this.serverId, storedEnvironment?.events)
    this.environmentRouter = new EnvironmentCommandRouter(
      this.environmentState,
      this.environmentEventLog,
      {
        receipts: storedEnvironment?.receipts,
        persist: authority => this.sessionStore.saveEnvironmentAuthority(authority),
      },
    )
    this.runtimeRegistry = new SessionRuntimeRegistry(this.ptyManager, this.environmentRouter)
    this.repositoryRegistry = new RepositoryRegistry(this.dataDir, this.serverId)
    this.server = new MobileServer({
      host: options.host ?? (this.sessionStore.getSettings().mobileAccessEnabled ? '0.0.0.0' : '127.0.0.1'),
      port: options.port,
      serverVersion: options.version,
      serverId: this.serverId,
      startupNonce: options.startupNonce,
      secure: options.secure,
    })
    this.server.setPtyManager(this.ptyManager)
    this.server.setRuntimeRegistry(this.runtimeRegistry)
    this.server.setSessionStore(this.sessionStore)
    this.server.setEnvironmentRouter(this.environmentRouter)
    this.server.setRepositoryRegistry(this.repositoryRegistry)
    if (options.voiceManager) this.server.setVoiceManager(options.voiceManager)
  }

  async start(): Promise<EnvironmentRuntimeEndpoint> {
    if (!this.started) {
      await this.server.start()
      this.started = true
    }
    return this.getEndpoint()
  }

  getEndpoint(): EnvironmentRuntimeEndpoint {
    return {
      serverId: this.serverId,
      version: this.options.version,
      ...this.server.getEndpoint(),
    }
  }

  async setLanAccess(enabled: boolean): Promise<EnvironmentRuntimeEndpoint> {
    const host = enabled ? '0.0.0.0' : '127.0.0.1'
    if (this.server.getEndpoint().host === host) return this.getEndpoint()
    if (this.started) await this.server.stop()
    this.server.setHost(host)
    if (this.started) await this.server.start()
    return this.getEndpoint()
  }

  async stop(): Promise<void> {
    if (!this.started) return
    await this.server.stop()
    await this.ptyManager.gracefulShutdown()
    this.started = false
  }
}
