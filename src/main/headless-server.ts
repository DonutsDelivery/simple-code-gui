import { randomUUID } from 'crypto'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { EnvironmentRuntime, type EnvironmentRuntimeOptions } from './environment-runtime.js'

export interface RuntimeInfo {
  pid: number
  serverId: string
  endpoint: string
  version: string
  startupNonce: string
  startedAt: number
}

export function getRuntimeInfoPath(dataDir: string): string {
  return join(dataDir, 'runtime-info.json')
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
    const response = await fetch(`${info.endpoint}/health`, { signal: AbortSignal.timeout(1000) })
    if (!response.ok) return false
    const health = await response.json() as { serverId?: string; startupNonce?: string }
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

export class HeadlessServer {
  readonly runtime: EnvironmentRuntime
  private runtimeInfo: RuntimeInfo | null = null
  private readonly startupNonce = randomUUID()

  constructor(private readonly options: EnvironmentRuntimeOptions) {
    this.runtime = new EnvironmentRuntime({ ...options, startupNonce: this.startupNonce })
  }

  async start(): Promise<RuntimeInfo> {
    const existing = readRuntimeInfo(this.options.dataDir)
    if (existing && await isRuntimeInfoLive(existing)) {
      throw new Error(`DonutCode Server is already running with PID ${existing.pid}`)
    }
    if (existing || existsSync(getRuntimeInfoPath(this.options.dataDir))) {
      try { unlinkSync(getRuntimeInfoPath(this.options.dataDir)) } catch { /* stale file already gone */ }
    }

    const endpoint = await this.runtime.start()
    this.runtimeInfo = {
      pid: process.pid,
      serverId: endpoint.serverId,
      endpoint: `${endpoint.secure ? 'https' : 'http'}://${endpoint.host}:${endpoint.port}`,
      version: endpoint.version,
      startupNonce: this.startupNonce,
      startedAt: Date.now(),
    }
    writeRuntimeInfoAtomic(this.options.dataDir, this.runtimeInfo)
    return this.runtimeInfo
  }

  async stop(): Promise<void> {
    await this.runtime.stop()
    const current = readRuntimeInfo(this.options.dataDir)
    if (current && current.startupNonce === this.runtimeInfo?.startupNonce) {
      try { unlinkSync(getRuntimeInfoPath(this.options.dataDir)) } catch { /* already removed */ }
    }
    this.runtimeInfo = null
  }
}
