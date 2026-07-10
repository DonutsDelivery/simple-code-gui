import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { HermesBackupManager } from '../hermes-backup-manager'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('HermesBackupManager', () => {
  it('creates an integrity-checked online backup and rotates old snapshots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-backup-manager-'))
    tempDirs.push(root)
    const sourcePath = join(root, 'state.db')
    const backupDir = join(root, 'backups')
    writeFileSync(sourcePath, 'latest context')
    const onlineBackup = async (source: string, destination: string): Promise<void> => {
      copyFileSync(source, destination)
    }

    const manager = new HermesBackupManager(backupDir, sourcePath, 60_000, 2, onlineBackup)
    const first = await manager.snapshot('pre-launch')
    expect(first).toBeTruthy()

    writeFileSync(sourcePath, 'latest context\nnewer context')
    await new Promise(resolve => setTimeout(resolve, 5))
    await manager.snapshot('periodic')
    await new Promise(resolve => setTimeout(resolve, 5))
    const latest = await manager.snapshot('emergency')
    const dbFiles = readdirSync(backupDir).filter(name => name.endsWith('.db'))
    expect(dbFiles).toHaveLength(2)
    expect(readdirSync(backupDir).filter(name => name.endsWith('.json'))).toHaveLength(2)

    expect(readFileSync(latest!, 'utf8')).toBe('latest context\nnewer context')
  })
})
