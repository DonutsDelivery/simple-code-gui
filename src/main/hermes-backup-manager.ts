import Database from 'better-sqlite3'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export type HermesBackupReason =
  | 'pre-launch'
  | 'periodic'
  | 'renderer-gone'
  | 'renderer-unresponsive'
  | 'emergency'
  | 'shutdown'

interface HermesBackupManifest {
  createdAt: string
  reason: HermesBackupReason
  source: string
  database: string
  quickCheck: 'ok'
}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_RETENTION = 3

type OnlineBackup = (sourcePath: string, destinationPath: string) => Promise<void>

async function createOnlineBackup(sourcePath: string, destinationPath: string): Promise<void> {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try {
    await source.backup(destinationPath)
  } finally {
    source.close()
  }

  const backup = new Database(destinationPath, { readonly: true, fileMustExist: true })
  let quickCheck: unknown
  try {
    quickCheck = backup.pragma('quick_check', { simple: true })
  } finally {
    backup.close()
  }
  if (quickCheck !== 'ok') {
    throw new Error(`SQLite quick_check failed: ${String(quickCheck)}`)
  }
}

export class HermesBackupManager {
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<string | null> | null = null

  constructor(
    private readonly backupDir: string,
    private readonly stateDbPath = join(process.env.HERMES_HOME || join(homedir(), '.hermes'), 'state.db'),
    private readonly intervalMs = DEFAULT_INTERVAL_MS,
    private readonly retention = DEFAULT_RETENTION,
    private readonly onlineBackup: OnlineBackup = createOnlineBackup,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.snapshot('periodic')
    }, this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  snapshot(reason: HermesBackupReason): Promise<string | null> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.createSnapshot(reason).finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async createSnapshot(reason: HermesBackupReason): Promise<string | null> {
    if (!existsSync(this.stateDbPath)) return null

    mkdirSync(this.backupDir, { recursive: true })
    const createdAt = new Date()
    const stamp = createdAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const baseName = `state-${stamp}-${reason}`
    const finalPath = join(this.backupDir, `${baseName}.db`)
    const tempPath = `${finalPath}.tmp`
    const manifestPath = join(this.backupDir, `${baseName}.json`)

    try {
      await this.onlineBackup(this.stateDbPath, tempPath)

      renameSync(tempPath, finalPath)
      const manifest: HermesBackupManifest = {
        createdAt: createdAt.toISOString(),
        reason,
        source: this.stateDbPath,
        database: finalPath,
        quickCheck: 'ok',
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
      this.prune()
      console.log(`[hermes-backup] ${reason}: ${finalPath}`)
      return finalPath
    } catch (error) {
      try { unlinkSync(tempPath) } catch { /* best effort */ }
      console.error(`[hermes-backup] ${reason} failed:`, error)
      throw error
    }
  }

  private prune(): void {
    const backups = readdirSync(this.backupDir)
      .filter(name => name.startsWith('state-') && name.endsWith('.db'))
      .map(name => ({ name, mtimeMs: statSync(join(this.backupDir, name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)

    for (const backup of backups.slice(this.retention)) {
      const dbPath = join(this.backupDir, backup.name)
      const manifestPath = dbPath.replace(/\.db$/, '.json')
      try { unlinkSync(dbPath) } catch { /* best effort */ }
      try { unlinkSync(manifestPath) } catch { /* best effort */ }
    }
  }
}
