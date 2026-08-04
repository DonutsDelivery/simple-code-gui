import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename, join, resolve } from 'path'

export const DONUTCODE_APP_NAME = 'DonutCode'
export const DONUTCODE_APP_SLUG = 'donutcode'
export const LEGACY_APP_NAMES = [
  'simple-code-gui',
  'Simple Code GUI',
  'simple-claude-gui',
  'Simple Claude GUI',
  'Claude Terminal',
] as const

const TRANSIENT_CHROMIUM_ENTRIES = new Set([
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
])

export interface BrandMigrationResult {
  copiedEntries: string[]
  sourceDirectories: string[]
  workspaceReplaced: boolean
}

function workspaceProjectCount(path: string): number | null {
  try {
    if (!existsSync(path) || statSync(path).size === 0) return null
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed?.workspace?.projects) ? parsed.workspace.projects.length : null
  } catch {
    return null
  }
}

function migrateWorkspaceIfNeeded(sourceDir: string, targetDir: string): boolean {
  const sourceWorkspace = join(sourceDir, 'config', 'workspace.json')
  const targetWorkspace = join(targetDir, 'config', 'workspace.json')
  const sourceCount = workspaceProjectCount(sourceWorkspace)
  const targetCount = workspaceProjectCount(targetWorkspace)

  if (sourceCount === null || sourceCount === 0 || (targetCount !== null && targetCount > 0)) {
    return false
  }

  mkdirSync(join(targetDir, 'config'), { recursive: true })
  if (existsSync(targetWorkspace)) {
    const backup = targetWorkspace + '.pre-donutcode'
    if (!existsSync(backup)) cpSync(targetWorkspace, backup, { preserveTimestamps: true })
  }
  cpSync(sourceWorkspace, targetWorkspace, { preserveTimestamps: true, force: true })
  return true
}

/**
 * Copy legacy application data into DonutCode without deleting or overwriting
 * valid destination data. Safe to run on every launch.
 */
export function migrateLegacyBrandData(appDataPath: string, userDataPath: string): BrandMigrationResult {
  const target = resolve(userDataPath)
  mkdirSync(target, { recursive: true })

  const copiedEntries: string[] = []
  const sourceDirectories: string[] = []
  let workspaceReplaced = false

  for (const legacyName of LEGACY_APP_NAMES) {
    const source = resolve(appDataPath, legacyName)
    if (source === target || !existsSync(source) || !statSync(source).isDirectory()) continue

    sourceDirectories.push(source)
    for (const entry of readdirSync(source)) {
      if (TRANSIENT_CHROMIUM_ENTRIES.has(entry)) continue
      const sourceEntry = join(source, entry)
      const targetEntry = join(target, entry)
      if (existsSync(targetEntry)) continue
      cpSync(sourceEntry, targetEntry, {
        recursive: true,
        errorOnExist: true,
        preserveTimestamps: true,
      })
      copiedEntries.push(join(basename(source), entry))
    }

    workspaceReplaced = migrateWorkspaceIfNeeded(source, target) || workspaceReplaced
  }

  const markerPath = join(target, 'brand-migration.json')
  const markerTemp = markerPath + '.tmp'
  writeFileSync(markerTemp, JSON.stringify({
    version: 1,
    product: DONUTCODE_APP_NAME,
    completedAt: new Date().toISOString(),
    sourceDirectories,
    copiedEntries,
    workspaceReplaced,
  }, null, 2))
  renameSync(markerTemp, markerPath)

  return { copiedEntries, sourceDirectories, workspaceReplaced }
}
