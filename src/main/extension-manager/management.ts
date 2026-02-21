import { existsSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { InstalledExtension, ExtensionConfig, OperationResult } from './types.js'
import { getSkillsDir, getMcpConfigPath } from './constants.js'
import { spawnAsync, isValidNpmPackageName } from './validation.js'

export function getInstalled(config: ExtensionConfig): InstalledExtension[] {
  return config.installed
}

export function getInstalledForProject(config: ExtensionConfig, projectPath: string): InstalledExtension[] {
  const enabledIds = config.enabledByProject[projectPath] || []

  // Return globally installed + project-specific + enabled for this project
  return config.installed.filter(ext => {
    // Project-specific extension
    if (ext.scope === 'project' && ext.projectPath === projectPath) {
      return true
    }
    // Global extension enabled for this project
    if (ext.scope === 'global' && enabledIds.includes(ext.id)) {
      return true
    }
    // Global extension with no project restrictions (enabled everywhere)
    if (ext.scope === 'global' && ext.enabled) {
      return true
    }
    return false
  })
}

export function getCommandsForProject(
  config: ExtensionConfig,
  projectPath: string
): { command: string; extensionId: string; extensionName: string }[] {
  const installed = getInstalledForProject(config, projectPath)
  const commands: { command: string; extensionId: string; extensionName: string }[] = []

  for (const ext of installed) {
    if (ext.type === 'skill' && ext.commands) {
      for (const cmd of ext.commands) {
        commands.push({
          command: cmd,
          extensionId: ext.id,
          extensionName: ext.name
        })
      }
    }
  }

  return commands
}

export async function update(config: ExtensionConfig, extensionId: string): Promise<OperationResult> {
  const extension = config.installed.find(e => e.id === extensionId)

  if (!extension) {
    return { success: false, error: 'Extension not found' }
  }

  if (extension.type === 'skill' && extension.repo) {
    // Git pull to update
    let installDir: string
    if (extension.scope === 'project' && extension.projectPath) {
      installDir = join(extension.projectPath, '.claude', 'skills', extension.id)
    } else {
      installDir = join(getSkillsDir(), extension.id)
    }

    try {
      // Use spawn with argument array to prevent shell injection
      await spawnAsync('git', ['pull'], { cwd: installDir })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  if (extension.type === 'mcp' && extension.npm) {
    // Validate npm package name
    if (!isValidNpmPackageName(extension.npm)) {
      return { success: false, error: 'Invalid npm package name' }
    }

    try {
      // Use spawn with argument array to prevent shell injection
      await spawnAsync('npm', ['update', '-g', extension.npm])
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  return { success: false, error: 'Cannot update this extension type' }
}

export async function remove(config: ExtensionConfig, extensionId: string): Promise<OperationResult> {
  const extensionIndex = config.installed.findIndex(e => e.id === extensionId)

  if (extensionIndex === -1) {
    return { success: false, error: 'Extension not found' }
  }

  const extension = config.installed[extensionIndex]

  try {
    if (extension.type === 'skill') {
      // Remove skill directory
      let installDir: string
      if (extension.scope === 'project' && extension.projectPath) {
        installDir = join(extension.projectPath, '.claude', 'skills', extension.id)
      } else {
        installDir = join(getSkillsDir(), extension.id)
      }

      if (existsSync(installDir)) {
        rmSync(installDir, { recursive: true })
      }
    }

    if (extension.type === 'mcp') {
      // Remove from MCP config
      const mcpConfigPath = getMcpConfigPath()
      if (existsSync(mcpConfigPath)) {
        const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf8')) as Record<string, unknown>
        const mcpServers = mcpConfig.mcpServers as Record<string, unknown> | undefined
        if (mcpServers && mcpServers[extension.id]) {
          delete mcpServers[extension.id]
          writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2))
        }
      }

      // Optionally uninstall npm package
      if (extension.npm && isValidNpmPackageName(extension.npm)) {
        try {
          // Use spawn with argument array to prevent shell injection
          await spawnAsync('npm', ['uninstall', '-g', extension.npm])
        } catch {
          // Ignore uninstall errors
        }
      }
    }

    // Remove from installed list
    config.installed.splice(extensionIndex, 1)

    // Remove from project enablements
    for (const projectPath in config.enabledByProject) {
      config.enabledByProject[projectPath] = config.enabledByProject[projectPath].filter(id => id !== extensionId)
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function getConfig(config: ExtensionConfig, extensionId: string): Record<string, unknown> | null {
  const extension = config.installed.find(e => e.id === extensionId)
  return extension?.config || null
}

export function setConfig(
  config: ExtensionConfig,
  extensionId: string,
  newConfig: Record<string, unknown>
): OperationResult {
  const extension = config.installed.find(e => e.id === extensionId)

  if (!extension) {
    return { success: false, error: 'Extension not found' }
  }

  extension.config = newConfig

  // If it's an MCP, update the MCP config file too
  if (extension.type === 'mcp') {
    const mcpConfigPath = getMcpConfigPath()
    if (existsSync(mcpConfigPath)) {
      try {
        const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf8')) as Record<string, unknown>
        const mcpServers = mcpConfig.mcpServers as Record<string, unknown> | undefined
        if (mcpServers && mcpServers[extension.id]) {
          mcpServers[extension.id] = {
            ...(mcpServers[extension.id] as Record<string, unknown>),
            ...newConfig
          }
          writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2))
        }
      } catch {
        // Ignore config update errors
      }
    }
  }

  return { success: true }
}

export function enableForProject(
  config: ExtensionConfig,
  extensionId: string,
  projectPath: string
): OperationResult {
  const extension = config.installed.find(e => e.id === extensionId)

  if (!extension) {
    return { success: false, error: 'Extension not found' }
  }

  if (!config.enabledByProject[projectPath]) {
    config.enabledByProject[projectPath] = []
  }

  if (!config.enabledByProject[projectPath].includes(extensionId)) {
    config.enabledByProject[projectPath].push(extensionId)
  }

  return { success: true }
}

export function disableForProject(
  config: ExtensionConfig,
  extensionId: string,
  projectPath: string
): OperationResult {
  if (config.enabledByProject[projectPath]) {
    config.enabledByProject[projectPath] = config.enabledByProject[projectPath].filter(id => id !== extensionId)
  }

  return { success: true }
}

export function addCustomUrl(config: ExtensionConfig, url: string): void {
  if (!config.customUrls.includes(url)) {
    config.customUrls.push(url)
  }
}

export function removeCustomUrl(config: ExtensionConfig, url: string): void {
  config.customUrls = config.customUrls.filter(u => u !== url)
}

export function getCustomUrls(config: ExtensionConfig): string[] {
  return config.customUrls
}
