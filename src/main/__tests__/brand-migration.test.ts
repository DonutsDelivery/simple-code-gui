import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { migrateLegacyBrandData } from '../brand-migration'

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'donutcode-brand-'))
  roots.push(root)
  return root
}

function writeWorkspace(root: string, projects: string[]): void {
  const config = join(root, 'config')
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, 'workspace.json'), JSON.stringify({
    workspace: {
      projects: projects.map((path) => ({ path, name: path.split('/').pop() })),
      openTabs: [],
      activeTabId: null,
    },
  }))
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('DonutCode brand migration', () => {
  it('copies legacy application data without deleting the source', () => {
    const appData = makeRoot()
    const legacy = join(appData, 'simple-code-gui')
    const target = join(appData, 'DonutCode')
    writeWorkspace(legacy, ['/projects/alpha'])
    writeFileSync(join(legacy, 'mobile-server-token'), 'secret-token')

    const result = migrateLegacyBrandData(appData, target)

    expect(result.sourceDirectories).toContain(legacy)
    expect(readFileSync(join(target, 'mobile-server-token'), 'utf8')).toBe('secret-token')
    expect(readFileSync(join(target, 'config', 'workspace.json'), 'utf8')).toContain('/projects/alpha')
    expect(existsSync(join(legacy, 'config', 'workspace.json'))).toBe(true)
  })

  it('is idempotent and does not overwrite valid DonutCode data', () => {
    const appData = makeRoot()
    const legacy = join(appData, 'simple-claude-gui')
    const target = join(appData, 'DonutCode')
    writeWorkspace(legacy, ['/projects/legacy'])
    writeWorkspace(target, ['/projects/current'])
    writeFileSync(join(legacy, 'mobile-server-token'), 'legacy-token')
    writeFileSync(join(target, 'mobile-server-token'), 'current-token')

    migrateLegacyBrandData(appData, target)
    migrateLegacyBrandData(appData, target)

    expect(readFileSync(join(target, 'config', 'workspace.json'), 'utf8')).toContain('/projects/current')
    expect(readFileSync(join(target, 'config', 'workspace.json'), 'utf8')).not.toContain('/projects/legacy')
    expect(readFileSync(join(target, 'mobile-server-token'), 'utf8')).toBe('current-token')
  })

  it('replaces only an empty destination workspace and keeps a backup', () => {
    const appData = makeRoot()
    const legacy = join(appData, 'Simple Code GUI')
    const target = join(appData, 'DonutCode')
    writeWorkspace(legacy, ['/projects/recovered'])
    writeWorkspace(target, [])

    const result = migrateLegacyBrandData(appData, target)

    expect(result.workspaceReplaced).toBe(true)
    expect(readFileSync(join(target, 'config', 'workspace.json'), 'utf8')).toContain('/projects/recovered')
    expect(existsSync(join(target, 'config', 'workspace.json.pre-donutcode'))).toBe(true)
  })

  it('ignores transient Chromium singleton links from another live instance', () => {
    const appData = makeRoot()
    const legacy = join(appData, 'Claude Terminal')
    const target = join(appData, 'DonutCode')
    mkdirSync(legacy, { recursive: true })
    symlinkSync('/tmp/nonexistent-singleton-cookie', join(legacy, 'SingletonCookie'))
    writeFileSync(join(legacy, 'settings.json'), '{}')

    expect(() => migrateLegacyBrandData(appData, target)).not.toThrow()
    expect(existsSync(join(target, 'settings.json'))).toBe(true)
  })
})
