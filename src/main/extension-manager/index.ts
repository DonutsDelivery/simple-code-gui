import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import type { Extension, InstalledExtension, ExtensionConfig, Registry, OperationResult } from './types.js'
import { getExtensionsDir, getSkillsDir, getInstalledJsonPath } from './constants.js'
import { fetchRegistry as fetchRegistryImpl, fetchFromUrl as fetchFromUrlImpl, RegistryCache } from './registry.js'
import { installSkill as installSkillImpl, installMcp as installMcpImpl } from './installation.js'
import * as management from './management.js'

// Re-export types
export type { Extension, InstalledExtension, ExtensionConfig, Registry, OperationResult }

export class ExtensionManager {
  private config: ExtensionConfig | null = null
  private registryCache: RegistryCache | null = null

  constructor() {
    this.ensureDirectories()
  }

  private ensureDirectories(): void {
    const dirs = [getExtensionsDir(), getSkillsDir()]
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
  }

  private loadConfig(): ExtensionConfig {
    if (this.config) return this.config

    const configPath = getInstalledJsonPath()
    if (existsSync(configPath)) {
      try {
        this.config = JSON.parse(readFileSync(configPath, 'utf8'))
        return this.config!
      } catch {
        // Invalid JSON, start fresh
      }
    }

    this.config = {
      installed: [],
      enabledByProject: {},
      customUrls: []
    }
    return this.config
  }

  private saveConfig(): void {
    if (!this.config) return
    writeFileSync(getInstalledJsonPath(), JSON.stringify(this.config, null, 2))
  }

  // Registry methods
  async fetchRegistry(forceRefresh = false): Promise<Registry> {
    const result = await fetchRegistryImpl(forceRefresh, this.registryCache)
    this.registryCache = result.cache
    return result.data
  }

  async fetchFromUrl(url: string): Promise<Extension | null> {
    return fetchFromUrlImpl(url)
  }

  // Installation methods
  async installSkill(
    extension: Extension,
    scope: 'global' | 'project' = 'global',
    projectPath?: string
  ): Promise<OperationResult> {
    const config = this.loadConfig()
    const result = await installSkillImpl(extension, scope, projectPath, config)
    if (result.success) {
      this.saveConfig()
    }
    return result
  }

  async installMcp(extension: Extension, mcpConfig?: Record<string, unknown>): Promise<OperationResult> {
    const config = this.loadConfig()
    const result = await installMcpImpl(extension, mcpConfig, config)
    if (result.success) {
      this.saveConfig()
    }
    return result
  }

  // Management methods
  getInstalled(): InstalledExtension[] {
    return management.getInstalled(this.loadConfig())
  }

  getInstalledForProject(projectPath: string): InstalledExtension[] {
    return management.getInstalledForProject(this.loadConfig(), projectPath)
  }

  getCommandsForProject(projectPath: string): { command: string; extensionId: string; extensionName: string }[] {
    return management.getCommandsForProject(this.loadConfig(), projectPath)
  }

  async update(extensionId: string): Promise<OperationResult> {
    const config = this.loadConfig()
    const result = await management.update(config, extensionId)
    if (result.success) {
      this.saveConfig()
    }
    return result
  }

  async remove(extensionId: string): Promise<OperationResult> {
    const config = this.loadConfig()
    const result = await management.remove(config, extensionId)
    if (result.success) {
      this.saveConfig()
    }
    return result
  }

  getConfig(extensionId: string): Record<string, unknown> | null {
    return management.getConfig(this.loadConfig(), extensionId)
  }

  setConfig(extensionId: string, newConfig: Record<string, unknown>): OperationResult {
    const config = this.loadConfig()
    const result = management.setConfig(config, extensionId, newConfig)
    if (result.success) {
      this.saveConfig()
    }
    return result
  }

  enableForProject(extensionId: string, projectPath: string): OperationResult {
    const config = this.loadConfig()
    const result = management.enableForProject(config, extensionId, projectPath)
    if (result.success) {
      this.saveConfig()
    }
    return result
  }

  disableForProject(extensionId: string, projectPath: string): OperationResult {
    const config = this.loadConfig()
    const result = management.disableForProject(config, extensionId, projectPath)
    this.saveConfig()
    return result
  }

  // Custom URL methods
  addCustomUrl(url: string): void {
    const config = this.loadConfig()
    management.addCustomUrl(config, url)
    this.saveConfig()
  }

  removeCustomUrl(url: string): void {
    const config = this.loadConfig()
    management.removeCustomUrl(config, url)
    this.saveConfig()
  }

  getCustomUrls(): string[] {
    return management.getCustomUrls(this.loadConfig())
  }
}

// Singleton instance
export const extensionManager = new ExtensionManager()
