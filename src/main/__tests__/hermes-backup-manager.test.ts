import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
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
    // Rolling snapshots rotate independently from incident snapshots.
    expect(dbFiles).toHaveLength(3)
    expect(readdirSync(backupDir).filter(name => name.endsWith('.json'))).toHaveLength(3)

    expect(readFileSync(latest!, 'utf8')).toBe('latest context\nnewer context')
  })

  it('keeps crash evidence outside rolling retention and captures recovery context', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-backup-incident-'))
    tempDirs.push(root)
    const hermesHome = join(root, 'hermes')
    const sourcePath = join(hermesHome, 'state.db')
    const backupDir = join(root, 'backups')
    const workspacePath = join(root, 'workspace.json')
    mkdirSync(join(hermesHome, 'logs'), { recursive: true })
    writeFileSync(sourcePath, 'context at crash')
    writeFileSync(join(hermesHome, 'config.yaml'), 'model: test\n')
    writeFileSync(join(hermesHome, 'logs', 'agent.log'), 'last tool call\n')
    writeFileSync(workspacePath, '{"sessions":[]}\n')
    const onlineBackup = async (source: string, destination: string): Promise<void> => {
      copyFileSync(source, destination)
    }

    const manager = new HermesBackupManager(backupDir, sourcePath, 60_000, 1, onlineBackup)
    manager.setRecoveryContext(workspacePath, () => [])
    const incident = await manager.snapshot('renderer-gone')
    await manager.snapshot('periodic')

    expect(incident && existsSync(incident)).toBe(true)
    const recoveryDir = readdirSync(backupDir).find(name => name.startsWith('recovery-'))
    expect(recoveryDir).toBeTruthy()
    expect(readFileSync(join(backupDir, recoveryDir!, 'workspace.json'), 'utf8')).toContain('sessions')
    expect(readFileSync(join(backupDir, recoveryDir!, 'hermes', 'logs', 'agent.log'), 'utf8')).toContain('last tool call')
  })
})
