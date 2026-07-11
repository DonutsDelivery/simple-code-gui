import Database from 'better-sqlite3'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { homedir } from 'os'
import { basename, dirname, join, relative } from 'path'
import { execFileSync } from 'child_process'

export type HermesBackupReason =
  | 'pre-launch'
  | 'periodic'
  | 'renderer-gone'
  | 'renderer-unresponsive'
  | 'backend-exit'
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
const DEFAULT_INCIDENT_RETENTION = 5
const INCIDENT_REASONS = new Set<HermesBackupReason>([
  'renderer-gone',
  'renderer-unresponsive',
  'backend-exit',
  'emergency',
])

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
  private lastSnapshotAt = 0
  private lastSnapshotPath: string | null = null
  private workspacePath: string | null = null
  private activeProjectsProvider: (() => string[]) | null = null

  constructor(
    private readonly backupDir: string,
    private readonly stateDbPath = join(process.env.HERMES_HOME || join(homedir(), '.hermes'), 'state.db'),
    private readonly intervalMs = DEFAULT_INTERVAL_MS,
    private readonly retention = DEFAULT_RETENTION,
    private readonly onlineBackup: OnlineBackup = createOnlineBackup,
  ) {}

  setRecoveryContext(workspacePath: string, activeProjectsProvider: () => string[]): void {
    this.workspacePath = workspacePath
    this.activeProjectsProvider = activeProjectsProvider
  }

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
    if (reason === 'pre-launch' && this.lastSnapshotPath && Date.now() - this.lastSnapshotAt < 60_000) {
      return Promise.resolve(this.lastSnapshotPath)
    }
    this.inFlight = this.createSnapshot(reason).finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async createSnapshot(reason: HermesBackupReason): Promise<string | null> {
    if (!existsSync(this.stateDbPath)) return null

    mkdirSync(this.backupDir, { recursive: true })
    this.removeOrphanedTemporaryFiles()
    const createdAt = new Date()
    const stamp = createdAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const baseName = `state-${stamp}-${reason}`
    const finalPath = join(this.backupDir, `${baseName}.db`)
    const tempPath = `${finalPath}.tmp`
    const manifestPath = join(this.backupDir, `${baseName}.json`)

    try {
      await this.onlineBackup(this.stateDbPath, tempPath)

      renameSync(tempPath, finalPath)
      for (const sidecar of [`${tempPath}-shm`, `${tempPath}-wal`]) {
        try { unlinkSync(sidecar) } catch { /* best effort */ }
      }
      const manifest: HermesBackupManifest = {
        createdAt: createdAt.toISOString(),
        reason,
        source: this.stateDbPath,
        database: finalPath,
        quickCheck: 'ok',
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
      if (INCIDENT_REASONS.has(reason)) {
        this.captureRecoveryArtifacts(baseName)
      }
      this.prune()
      this.lastSnapshotAt = Date.now()
      this.lastSnapshotPath = finalPath
      console.log(`[hermes-backup] ${reason}: ${finalPath}`)
      return finalPath
    } catch (error) {
      this.removeBackupFileSet(tempPath)
      console.error(`[hermes-backup] ${reason} failed:`, error)
      throw error
    }
  }

  private prune(): void {
    const backups = readdirSync(this.backupDir)
      .filter(name => name.startsWith('state-') && name.endsWith('.db'))
      .map(name => ({
        name,
        incident: [...INCIDENT_REASONS].some(reason => name.endsWith(`-${reason}.db`)),
        mtimeMs: statSync(join(this.backupDir, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)

    const rolling = backups.filter(backup => !backup.incident)
    const incidents = backups.filter(backup => backup.incident)
    for (const backup of [
      ...rolling.slice(this.retention),
      ...incidents.slice(DEFAULT_INCIDENT_RETENTION),
    ]) {
      this.removeBackupFileSet(join(this.backupDir, backup.name))
      const recoveryDir = join(this.backupDir, backup.name.replace(/^state-/, 'recovery-').replace(/\.db$/, ''))
      try { rmSync(recoveryDir, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }

  private removeOrphanedTemporaryFiles(): void {
    for (const name of readdirSync(this.backupDir)) {
      if (name.includes('.db.tmp')) {
        try { unlinkSync(join(this.backupDir, name)) } catch { /* best effort */ }
      }
    }
  }

  private removeBackupFileSet(dbPath: string): void {
    for (const path of [
      dbPath,
      `${dbPath}-shm`,
      `${dbPath}-wal`,
      dbPath.replace(/\.db(?:\.tmp)?$/, '.json'),
    ]) {
      try { unlinkSync(path) } catch { /* best effort */ }
    }
  }

  private captureRecoveryArtifacts(baseName: string): void {
    const recoveryDir = join(this.backupDir, baseName.replace(/^state-/, 'recovery-'))
    const hermesHome = dirname(this.stateDbPath)
    mkdirSync(recoveryDir, { recursive: true })

    for (const source of [
      join(hermesHome, 'config.yaml'),
      join(hermesHome, 'processes.json'),
      join(hermesHome, 'gateway_state.json'),
      join(hermesHome, 'logs'),
      join(hermesHome, 'spawn-trees'),
      join(hermesHome, 'cache', 'delegation'),
      join(hermesHome, 'checkpoints'),
    ]) {
      if (!existsSync(source)) continue
      const destination = join(recoveryDir, 'hermes', relative(hermesHome, source))
      try {
        mkdirSync(dirname(destination), { recursive: true })
        cpSync(source, destination, { recursive: true })
      } catch { /* best effort */ }
    }

    if (this.workspacePath && existsSync(this.workspacePath)) {
      try { cpSync(this.workspacePath, join(recoveryDir, 'workspace.json')) } catch { /* best effort */ }
    }

    const workspaceProjects: string[] = []
    if (this.workspacePath && existsSync(this.workspacePath)) {
      try {
        const saved = JSON.parse(readFileSync(this.workspacePath, 'utf8'))
        for (const session of saved?.workspace?.sessions || []) {
          for (const tab of session?.openTabs || []) {
            if (typeof tab?.projectPath === 'string') workspaceProjects.push(tab.projectPath)
          }
        }
      } catch { /* the copied workspace still preserves malformed input for forensics */ }
    }
    const projects = [...new Set([...(this.activeProjectsProvider?.() || []), ...workspaceProjects])]
    for (const project of projects) {
      const projectDir = join(recoveryDir, 'worktrees', basename(project).replace(/[^A-Za-z0-9._-]/g, '_'))
      try {
        mkdirSync(projectDir, { recursive: true })
        writeFileSync(join(projectDir, 'path.txt'), `${project}\n`)
        writeFileSync(join(projectDir, 'head.txt'), execFileSync('git', ['-C', project, 'rev-parse', 'HEAD'], { encoding: 'utf8' }))
        writeFileSync(join(projectDir, 'status.txt'), execFileSync('git', ['-C', project, 'status', '--short'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
        writeFileSync(join(projectDir, 'changes.diff'), execFileSync('git', ['-C', project, 'diff', '--binary'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }))
      } catch (error) {
        try { writeFileSync(join(projectDir, 'capture-error.txt'), `${String(error)}\n`) } catch { /* best effort */ }
      }
    }
  }
}
