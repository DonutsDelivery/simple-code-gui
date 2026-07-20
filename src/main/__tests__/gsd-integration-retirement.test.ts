import { describe, expect, it } from 'vitest'
import { BUILTIN_REGISTRY } from '../extension-manager/constants'
import { getCommandsForProject, getInstalled } from '../extension-manager/management'
import type { ExtensionConfig, InstalledExtension } from '../extension-manager/types'

describe('GSD integration retirement', () => {
  // AC: @gsd-integration-retirement ac-2
  it('does not promote GSD in the built-in extension registry', () => {
    expect(BUILTIN_REGISTRY.skills.some((extension) => extension.id === 'get-shit-done')).toBe(false)
    expect(BUILTIN_REGISTRY.skills.some((extension) => extension.id === 'code-review')).toBe(true)
  })

  // AC: @gsd-integration-retirement ac-3
  it('preserves previously installed GSD entries in generic extension handling', () => {
    const installedGsd: InstalledExtension = {
      id: 'get-shit-done',
      name: 'Get Shit Done (GSD)',
      description: 'Previously installed extension',
      type: 'skill',
      commands: ['/gsd:status'],
      installedAt: 1,
      enabled: true,
      scope: 'global',
    }
    const config: ExtensionConfig = {
      installed: [installedGsd],
      enabledByProject: {},
      customUrls: [],
    }

    expect(getInstalled(config)).toEqual([installedGsd])
    expect(getCommandsForProject(config, '/project')).toEqual([
      {
        command: '/gsd:status',
        extensionId: 'get-shit-done',
        extensionName: 'Get Shit Done (GSD)',
      },
    ])
    expect(config.installed).toEqual([installedGsd])
  })
})
