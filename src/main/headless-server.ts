import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { EnvironmentRuntime, type EnvironmentRuntimeOptions } from './environment-runtime.js'
import { runtimeHttpRequest } from './runtime-http.js'

const processClaims = new Set<string>()

export interface RuntimeInfo {
  pid: number
  serverId: string
  endpoint: string
  version: string
  startupNonce: string
  startedAt: number
  certFingerprint: string
  pairingCode?: string
}

export function getRuntimeInfoPath(dataDir: string): string {
  return join(dataDir, 'runtime-info.json')
}

function getRuntimeLockPath(dataDir: string): string {
  return join(dataDir, 'runtime.lock')
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function isRuntimeInfoLive(info: RuntimeInfo): Promise<boolean> {
  if (!isProcessAlive(info.pid)) return false
  try {
    const endpoint = new URL(info.endpoint)
    if (endpoint.hostname === '0.0.0.0' || endpoint.hostname === '::') endpoint.hostname = '127.0.0.1'
    const response = await runtimeHttpRequest({ ...info, endpoint: endpoint.toString() }, '/health', { timeoutMs: 1_000 })
    if (response.status < 200 || response.status >= 300) return false
    const health = response.json<{ serverId?: string; startupNonce?: string }>()
    return health.serverId === info.serverId && health.startupNonce === info.startupNonce
  } catch {
    return false
  }
}

export function readRuntimeInfo(dataDir: string): RuntimeInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(getRuntimeInfoPath(dataDir), 'utf8')) as RuntimeInfo
    if (!parsed.startupNonce || !parsed.serverId || !parsed.endpoint || !Number.isSafeInteger(parsed.pid)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeRuntimeInfoAtomic(dataDir: string, info: RuntimeInfo): void {
  const path = getRuntimeInfoPath(dataDir)
  const temporaryPath = `${path}.${process.pid}.${info.startupNonce}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, path)
}

function acquireRuntimeLock(dataDir: string, startupNonce: string): void {
  const lockPath = getRuntimeLockPath(dataDir)
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  try {
    writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, startupNonce })}\n`, { mode: 0o600, flag: 'wx' })
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    let ownerPid: number
    try {
      const owner = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: unknown }
      if (typeof owner.pid !== 'number') throw new Error('missing PID')
      ownerPid = owner.pid
    } catch {
      throw new Error('DonutCode Server has an unreadable runtime lock; remove it only after confirming no server is running')
    }
    if (isProcessAlive(ownerPid)) throw new Error(`DonutCode Server is already running with PID ${ownerPid}`)
    try { unlinkSync(lockPath) } catch { /* another owner may have claimed the lock */ }
    acquireRuntimeLock(dataDir, startupNonce)
  }
}

function releaseRuntimeLock(dataDir: string, startupNonce: string): void {
  const lockPath = getRuntimeLockPath(dataDir)
  try {
    const owner = JSON.parse(readFileSync(lockPath, 'utf8')) as { startupNonce?: unknown }
    if (owner.startupNonce !== startupNonce) return
  } catch {
    return
  }
  try { unlinkSync(lockPath) } catch { /* already removed */ }
}

export class HeadlessServer {
  readonly runtime: EnvironmentRuntime
  private runtimeInfo: RuntimeInfo | null = null
  private readonly startupNonce = randomUUID()

  constructor(private readonly options: EnvironmentRuntimeOptions) {
    this.runtime = new EnvironmentRuntime({ ...options, startupNonce: this.startupNonce })
  }

  async start(): Promise<RuntimeInfo> {
    if (processClaims.has(this.options.dataDir)) {
      throw new Error(`DonutCode Server is already running with PID ${process.pid}`)
    }
    acquireRuntimeLock(this.options.dataDir, this.startupNonce)
    const existing = readRuntimeInfo(this.options.dataDir)
    if (existing && await isRuntimeInfoLive(existing)) {
      releaseRuntimeLock(this.options.dataDir, this.startupNonce)
      throw new Error(`DonutCode Server is already running with PID ${existing.pid}`)
    }
    if (existing || existsSync(getRuntimeInfoPath(this.options.dataDir))) {
      try { unlinkSync(getRuntimeInfoPath(this.options.dataDir)) } catch { /* stale file already gone */ }
    }

    processClaims.add(this.options.dataDir)
    let endpoint: Awaited<ReturnType<EnvironmentRuntime['start']>>
    try {
      endpoint = await this.runtime.start()
    } catch (error) {
      processClaims.delete(this.options.dataDir)
      releaseRuntimeLock(this.options.dataDir, this.startupNonce)
      throw error
    }
    this.runtimeInfo = {
      pid: process.pid,
      serverId: endpoint.serverId,
      endpoint: `${endpoint.secure ? 'https' : 'http'}://${endpoint.host}:${endpoint.port}`,
      version: endpoint.version,
      startupNonce: this.startupNonce,
      startedAt: Date.now(),
      certFingerprint: endpoint.certFingerprint,
      pairingCode: this.runtime.server.getConnectionInfo().pairingCode,
    }
    writeRuntimeInfoAtomic(this.options.dataDir, this.runtimeInfo)
    return this.runtimeInfo
  }

  async stop(): Promise<void> {
    try {
      await this.runtime.stop()
      const current = readRuntimeInfo(this.options.dataDir)
      if (current && current.startupNonce === this.runtimeInfo?.startupNonce) {
        try { unlinkSync(getRuntimeInfoPath(this.options.dataDir)) } catch { /* already removed */ }
      }
      this.runtimeInfo = null
    } finally {
      processClaims.delete(this.options.dataDir)
      releaseRuntimeLock(this.options.dataDir, this.startupNonce)
    }
  }
}
