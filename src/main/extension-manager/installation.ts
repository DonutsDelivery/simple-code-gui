import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, cpSync } from 'fs'
import { join, resolve } from 'path'
import type { Extension, InstalledExtension, ExtensionConfig, OperationResult } from './types.js'
import { getSkillsDir, getExtensionsDir, getMcpConfigPath } from './constants.js'
import { spawnAsync, isValidGitHubUrl, isValidNpmPackageName, addToOpenCodeMcpConfig } from './validation.js'

export async function installSkill(
  extension: Extension,
  scope: 'global' | 'project',
  projectPath: string | undefined,
  config: ExtensionConfig
): Promise<OperationResult> {
  if (!extension.repo) {
    return { success: false, error: 'No repository URL provided' }
  }

  // Validate repository URL to prevent shell injection
  if (!isValidGitHubUrl(extension.repo)) {
    return { success: false, error: 'Invalid repository URL. Only GitHub HTTPS URLs are allowed (https://github.com/owner/repo)' }
  }

  // Check if already installed
  const existing = config.installed.find(e => e.id === extension.id && e.type === 'skill')
  if (existing) {
    return { success: false, error: 'Skill already installed' }
  }

  // Determine install directory
  let installDir: string
  if (scope === 'project' && projectPath) {
    installDir = join(projectPath, '.claude', 'skills', extension.id)
  } else {
    installDir = join(getSkillsDir(), extension.id)
  }

  try {
    // Git clone the repository
    if (existsSync(installDir)) {
      rmSync(installDir, { recursive: true })
    }
    mkdirSync(installDir, { recursive: true })

    // Use spawn with argument array to prevent shell injection
    await spawnAsync('git', ['clone', '--depth', '1', extension.repo, installDir])

    // Add to installed list
    const installed: InstalledExtension = {
      ...extension,
      installedAt: Date.now(),
      enabled: true,
      scope,
      projectPath: scope === 'project' ? projectPath : undefined
    }
    config.installed.push(installed)

    return { success: true }
  } catch (error) {
    // Cleanup on failure
    if (existsSync(installDir)) {
      rmSync(installDir, { recursive: true })
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function installLocalMcp(
  extension: Extension,
  mcpConfig: Record<string, unknown> | undefined,
  config: ExtensionConfig
): Promise<OperationResult> {
  if (!extension.sourceDir) {
    return { success: false, error: 'No source directory provided' }
  }

  // Resolve project root: installation.ts is at dist/main/extension-manager/
  const projectRoot = resolve(__dirname, '../../..')
  const sourcePath = resolve(projectRoot, extension.sourceDir)
  const entryFile = extension.entryPoint || 'server.mjs'

  if (!existsSync(sourcePath)) {
    return { success: false, error: `MCP server source not found at ${sourcePath}` }
  }

  // Install directory: ~/.claude/extensions/<id>/
  const installDir = join(getExtensionsDir(), extension.id)

  try {
    // Remove existing if present
    if (existsSync(installDir)) {
      rmSync(installDir, { recursive: true })
    }
    mkdirSync(installDir, { recursive: true })

    // Copy server files
    cpSync(sourcePath, installDir, { recursive: true })

    // Install dependencies
    await spawnAsync('npm', ['install', '--production'], { cwd: installDir })

    // Add to MCP config
    const mcpConfigPath = getMcpConfigPath()
    let currentMcpConfig: Record<string, unknown> = { mcpServers: {} }
    if (existsSync(mcpConfigPath)) {
      try {
        currentMcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf8'))
      } catch {
        // Invalid config, start fresh
      }
    }

    const mcpServers = (currentMcpConfig.mcpServers || {}) as Record<string, unknown>
    const serverCmd = 'node'
    const serverArgs = [join(installDir, entryFile)]
    mcpServers[extension.id] = {
      command: serverCmd,
      args: serverArgs,
      ...mcpConfig
    }
    currentMcpConfig.mcpServers = mcpServers
    writeFileSync(mcpConfigPath, JSON.stringify(currentMcpConfig, null, 2))

    // Register with OpenCode too
    addToOpenCodeMcpConfig(extension.id, serverCmd, serverArgs)

    // Add to installed list
    const installed: InstalledExtension = {
      ...extension,
      installedAt: Date.now(),
      enabled: true,
      scope: 'global',
      config: mcpConfig
    }
    config.installed.push(installed)

    return { success: true }
  } catch (error) {
    // Cleanup on failure
    if (existsSync(installDir)) {
      rmSync(installDir, { recursive: true })
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function installMcp(
  extension: Extension,
  mcpConfig: Record<string, unknown> | undefined,
  config: ExtensionConfig
): Promise<OperationResult> {
  if (extension.sourceDir) {
    return installLocalMcp(extension, mcpConfig, config)
  }

  if (!extension.npm) {
    return { success: false, error: 'No npm package name provided' }
  }

  // Validate npm package name to prevent shell injection
  if (!isValidNpmPackageName(extension.npm)) {
    return { success: false, error: 'Invalid npm package name. Package names must follow npm naming conventions.' }
  }

  // Check if already installed
  const existing = config.installed.find(e => e.id === extension.id && e.type === 'mcp')
  if (existing) {
    return { success: false, error: 'MCP already installed' }
  }

  try {
    // Install npm package globally using spawn with argument array
    await spawnAsync('npm', ['install', '-g', extension.npm])

    // Add to MCP config
    const mcpConfigPath = getMcpConfigPath()
    let currentMcpConfig: Record<string, unknown> = { mcpServers: {} }
    if (existsSync(mcpConfigPath)) {
      try {
        currentMcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf8'))
      } catch {
        // Invalid config, start fresh
      }
    }

    // Add the MCP server entry
    const mcpServers = (currentMcpConfig.mcpServers || {}) as Record<string, unknown>
    const configArgs = mcpConfig?.args as string[] | undefined
    const serverCmd = 'npx'
    const serverArgs = ['-y', extension.npm, ...(configArgs || [])]
    mcpServers[extension.id] = {
      command: serverCmd,
      args: serverArgs,
      ...mcpConfig
    }
    currentMcpConfig.mcpServers = mcpServers
    writeFileSync(mcpConfigPath, JSON.stringify(currentMcpConfig, null, 2))

    // Register with OpenCode too
    addToOpenCodeMcpConfig(extension.id, serverCmd, serverArgs)

    // Add to installed list
    const installed: InstalledExtension = {
      ...extension,
      installedAt: Date.now(),
      enabled: true,
      scope: 'global',
      config: mcpConfig
    }
    config.installed.push(installed)

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
