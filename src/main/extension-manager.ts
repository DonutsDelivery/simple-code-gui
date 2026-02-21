import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'fs'
import { spawn } from 'child_process'

// Safe spawn wrapper that returns a promise - prevents shell injection by using argument arrays
function spawnAsync(command: string, args: string[], options?: { cwd?: string }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      shell: false,  // Critical: disable shell to prevent injection
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => { stdout += data.toString() })
    proc.stderr?.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`))
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })
  })
}

// Validate GitHub repository URL to prevent injection
function isValidGitHubUrl(url: string): boolean {
  // Only allow well-formed GitHub HTTPS URLs
  // Pattern: https://github.com/owner/repo or https://github.com/owner/repo.git
  const githubPattern = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\.git)?$/
  return githubPattern.test(url)
}

// Validate npm package name to prevent injection
function isValidNpmPackageName(name: string): boolean {
  // npm package names: lowercase, may include @scope/, hyphens, dots, underscores
  // Must not contain shell metacharacters
  const npmPattern = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
  return npmPattern.test(name) && name.length <= 214
}

// Types
export interface Extension {
  id: string
  name: string
  description: string
  type: 'skill' | 'mcp' | 'agent'
  repo?: string        // GitHub URL for skills
  npm?: string         // npm package for MCPs
  commands?: string[]  // Slash commands provided
  tags?: string[]
  configSchema?: Record<string, any>  // JSON schema for MCP config
}

export interface InstalledExtension extends Extension {
  installedAt: number
  version?: string
  enabled: boolean
  scope: 'global' | 'project'
  projectPath?: string  // Only for project-scoped
  config?: Record<string, any>
}

export interface Registry {
  version: number
  skills: Extension[]
  mcps: Extension[]
  agents: Extension[]
}

export interface ExtensionConfig {
  installed: InstalledExtension[]
  enabledByProject: Record<string, string[]>  // projectPath -> extensionIds
  customUrls: string[]  // User-added GitHub URLs
}

// Default registry URL (can be overridden)
const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/anthropics/claude-code-extensions/main/registry.json'

// Built-in default extensions (always available, no network needed)
const BUILTIN_REGISTRY: Registry = {
  version: 1,
  skills: [
    {
      id: 'get-shit-done',
      name: 'Get Shit Done (GSD)',
      description: 'Autonomous task execution framework with planning, codebase mapping, and guided execution',
      type: 'skill',
      repo: 'https://github.com/glittercowboy/get-shit-done',
      commands: ['/gsd:plan', '/gsd:execute', '/gsd:status', '/gsd:map-codebase'],
      tags: ['workflow', 'autonomous', 'planning', 'tasks']
    },
    {
      id: 'claudemcp-memory',
      name: 'Claude Memory',
      description: 'Persistent memory and knowledge base for Claude conversations',
      type: 'skill',
      repo: 'https://github.com/anthropics/claude-memory',
      commands: ['/memory:save', '/memory:recall', '/memory:list'],
      tags: ['memory', 'persistence', 'knowledge']
    },
    {
      id: 'code-review',
      name: 'Code Review',
      description: 'Automated code review with best practices checking',
      type: 'skill',
      repo: 'https://github.com/anthropics/claude-code-review',
      commands: ['/review', '/review:pr', '/review:file'],
      tags: ['review', 'quality', 'pr']
    }
  ],
  mcps: [
    {
      id: 'filesystem',
      name: 'Filesystem MCP',
      description: 'Read and write file access for Claude with configurable roots',
      type: 'mcp',
      npm: '@modelcontextprotocol/server-filesystem',
      tags: ['files', 'io', 'core'],
      configSchema: {
        roots: { type: 'array', items: { type: 'string' }, description: 'Allowed directories' }
      }
    },
    {
      id: 'puppeteer',
      name: 'Puppeteer MCP',
      description: 'Browser automation and web scraping capabilities',
      type: 'mcp',
      npm: '@modelcontextprotocol/server-puppeteer',
      tags: ['browser', 'automation', 'web'],
      configSchema: {}
    },
    {
      id: 'github',
      name: 'GitHub MCP',
      description: 'GitHub API integration for repos, issues, and PRs',
      type: 'mcp',
      npm: '@modelcontextprotocol/server-github',
      tags: ['github', 'git', 'api'],
      configSchema: {
        token: { type: 'string', description: 'GitHub personal access token' }
      }
    },
    {
      id: 'sqlite',
      name: 'SQLite MCP',
      description: 'SQLite database access and querying',
      type: 'mcp',
      npm: '@modelcontextprotocol/server-sqlite',
      tags: ['database', 'sql', 'storage'],
      configSchema: {
        dbPath: { type: 'string', description: 'Path to SQLite database file' }
      }
    },
    {
      id: 'brave-search',
      name: 'Brave Search MCP',
      description: 'Web search using Brave Search API',
      type: 'mcp',
      npm: '@modelcontextprotocol/server-brave-search',
      tags: ['search', 'web', 'api'],
      configSchema: {
        apiKey: { type: 'string', description: 'Brave Search API key' }
      }
    },
    {
      id: 'fetch',
      name: 'Fetch MCP',
      description: 'HTTP fetch capabilities for web requests',
      type: 'mcp',
      npm: '@modelcontextprotocol/server-fetch',
      tags: ['http', 'web', 'api'],
      configSchema: {}
    }
  ],
  agents: [
    {
      id: 'pr-review-agent',
      name: 'PR Review Agent',
      description: 'Autonomous agent that reviews pull requests and provides feedback',
      type: 'agent',
      repo: 'https://github.com/anthropics/claude-pr-agent',
      tags: ['review', 'pr', 'autonomous']
    },
    {
      id: 'test-generator',
      name: 'Test Generator Agent',
      description: 'Generates unit tests for your codebase automatically',
      type: 'agent',
      repo: 'https://github.com/anthropics/claude-test-generator',
      tags: ['testing', 'automation', 'quality']
    }
  ]
}

// Paths
const getExtensionsDir = () => join(homedir(), '.claude', 'extensions')
const getInstalledJsonPath = () => join(getExtensionsDir(), 'installed.json')
const getRegistryCachePath = () => join(getExtensionsDir(), 'registry-cache.json')
const getSkillsDir = () => join(homedir(), '.claude', 'skills')
const getMcpConfigPath = () => join(homedir(), '.claude', 'mcp_config.json')

// Cache TTL: 1 hour
const REGISTRY_CACHE_TTL = 60 * 60 * 1000

export class ExtensionManager {
  private config: ExtensionConfig | null = null
  private registryCache: { data: Registry; fetchedAt: number } | null = null

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

  // ==================== CONFIG ====================

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

  // ==================== REGISTRY ====================

  async fetchRegistry(forceRefresh = false): Promise<Registry> {
    // Helper to merge registries (remote extensions supplement builtin)
    const mergeRegistries = (remote: Registry | null): Registry => {
      if (!remote) {
        return BUILTIN_REGISTRY
      }

      // Merge: builtin first, then remote (avoiding duplicates by id)
      const builtinSkillIds = new Set(BUILTIN_REGISTRY.skills.map(s => s.id))
      const builtinMcpIds = new Set(BUILTIN_REGISTRY.mcps.map(m => m.id))
      const builtinAgentIds = new Set(BUILTIN_REGISTRY.agents.map(a => a.id))

      return {
        version: Math.max(BUILTIN_REGISTRY.version, remote.version),
        skills: [
          ...BUILTIN_REGISTRY.skills,
          ...remote.skills.filter(s => !builtinSkillIds.has(s.id))
        ],
        mcps: [
          ...BUILTIN_REGISTRY.mcps,
          ...remote.mcps.filter(m => !builtinMcpIds.has(m.id))
        ],
        agents: [
          ...BUILTIN_REGISTRY.agents,
          ...remote.agents.filter(a => !builtinAgentIds.has(a.id))
        ]
      }
    }

    // Check cache
    if (!forceRefresh && this.registryCache) {
      const age = Date.now() - this.registryCache.fetchedAt
      if (age < REGISTRY_CACHE_TTL) {
        return this.registryCache.data
      }
    }

    // Check disk cache
    const cachePath = getRegistryCachePath()
    if (!forceRefresh && existsSync(cachePath)) {
      try {
        const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
        if (Date.now() - cached.fetchedAt < REGISTRY_CACHE_TTL) {
          this.registryCache = cached
          return cached.data
        }
      } catch {
        // Invalid cache, fetch fresh
      }
    }

    // Fetch from network and merge with builtin
    try {
      const response = await fetch(DEFAULT_REGISTRY_URL)
      if (!response.ok) {
        throw new Error(`Failed to fetch registry: ${response.status}`)
      }
      const remoteData = await response.json() as Registry
      const data = mergeRegistries(remoteData)

      // Cache it
      this.registryCache = { data, fetchedAt: Date.now() }
      writeFileSync(cachePath, JSON.stringify(this.registryCache, null, 2))

      return data
    } catch (error) {
      // Network failed - return builtin registry
      console.error('Failed to fetch remote registry, using built-in:', error)
      const data = mergeRegistries(null)

      // Cache the builtin registry so we don't spam network requests
      this.registryCache = { data, fetchedAt: Date.now() }

      return data
    }
  }

  async fetchFromUrl(url: string): Promise<Extension | null> {
    // Parse GitHub URL to get repo info
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) {
      throw new Error('Invalid GitHub URL')
    }

    const [, owner, repo] = match
    const repoName = repo.replace(/\.git$/, '')

    // Try to fetch package.json or skill.json for metadata
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/main`

    try {
      // Try skill.json first (for skills)
      const skillJsonUrl = `${rawUrl}/skill.json`
      const skillResponse = await fetch(skillJsonUrl)
      if (skillResponse.ok) {
        const skillData = await skillResponse.json()
        return {
          id: skillData.id || repoName,
          name: skillData.name || repoName,
          description: skillData.description || '',
          type: 'skill',
          repo: url,
          commands: skillData.commands || [],
          tags: skillData.tags || []
        }
      }

      // Try package.json for npm packages (MCPs)
      const pkgJsonUrl = `${rawUrl}/package.json`
      const pkgResponse = await fetch(pkgJsonUrl)
      if (pkgResponse.ok) {
        const pkgData = await pkgResponse.json()
        return {
          id: pkgData.name || repoName,
          name: pkgData.name || repoName,
          description: pkgData.description || '',
          type: pkgData.keywords?.includes('mcp') ? 'mcp' : 'skill',
          repo: url,
          npm: pkgData.name,
          tags: pkgData.keywords || []
        }
      }

      // Fallback: assume it's a skill
      return {
        id: repoName,
        name: repoName,
        description: `Extension from ${owner}/${repoName}`,
        type: 'skill',
        repo: url
      }
    } catch (error) {
      console.error('Failed to fetch extension info from URL:', error)
      return null
    }
  }

  // ==================== INSTALLATION ====================

  async installSkill(extension: Extension, scope: 'global' | 'project' = 'global', projectPath?: string): Promise<{ success: boolean; error?: string }> {
    if (!extension.repo) {
      return { success: false, error: 'No repository URL provided' }
    }

    // Validate repository URL to prevent shell injection
    if (!isValidGitHubUrl(extension.repo)) {
      return { success: false, error: 'Invalid repository URL. Only GitHub HTTPS URLs are allowed (https://github.com/owner/repo)' }
    }

    const config = this.loadConfig()

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
      this.saveConfig()

      return { success: true }
    } catch (error: any) {
      // Cleanup on failure
      if (existsSync(installDir)) {
        rmSync(installDir, { recursive: true })
      }
      return { success: false, error: error.message }
    }
  }

  async installMcp(extension: Extension, mcpConfig?: Record<string, any>): Promise<{ success: boolean; error?: string }> {
    if (!extension.npm) {
      return { success: false, error: 'No npm package name provided' }
    }

    // Validate npm package name to prevent shell injection
    if (!isValidNpmPackageName(extension.npm)) {
      return { success: false, error: 'Invalid npm package name. Package names must follow npm naming conventions.' }
    }

    const config = this.loadConfig()

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
      let currentMcpConfig: Record<string, any> = { mcpServers: {} }
      if (existsSync(mcpConfigPath)) {
        try {
          currentMcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf8'))
        } catch {
          // Invalid config, start fresh
        }
      }

      // Add the MCP server entry
      currentMcpConfig.mcpServers = currentMcpConfig.mcpServers || {}
      currentMcpConfig.mcpServers[extension.id] = {
        command: 'npx',
        args: ['-y', extension.npm, ...(mcpConfig?.args || [])],
        ...mcpConfig
      }
      writeFileSync(mcpConfigPath, JSON.stringify(currentMcpConfig, null, 2))

      // Add to installed list
      const installed: InstalledExtension = {
        ...extension,
        installedAt: Date.now(),
        enabled: true,
        scope: 'global',
        config: mcpConfig
      }
      config.installed.push(installed)
      this.saveConfig()

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  // ==================== MANAGEMENT ====================

  getInstalled(): InstalledExtension[] {
    const config = this.loadConfig()
    return config.installed
  }

  getInstalledForProject(projectPath: string): InstalledExtension[] {
    const config = this.loadConfig()
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

  getCommandsForProject(projectPath: string): { command: string; extensionId: string; extensionName: string }[] {
    const installed = this.getInstalledForProject(projectPath)
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

  async update(extensionId: string): Promise<{ success: boolean; error?: string }> {
    const config = this.loadConfig()
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
      } catch (error: any) {
        return { success: false, error: error.message }
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
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }

    return { success: false, error: 'Cannot update this extension type' }
  }

  async remove(extensionId: string): Promise<{ success: boolean; error?: string }> {
    const config = this.loadConfig()
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
          const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf8'))
          if (mcpConfig.mcpServers && mcpConfig.mcpServers[extension.id]) {
            delete mcpConfig.mcpServers[extension.id]
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

      this.saveConfig()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  // ==================== CONFIGURATION ====================

  getConfig(extensionId: string): Record<string, any> | null {
    const config = this.loadConfig()
    const extension = config.installed.find(e => e.id === extensionId)
    return extension?.config || null
  }

  setConfig(extensionId: string, newConfig: Record<string, any>): { success: boolean; error?: string } {
    const config = this.loadConfig()
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
          const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf8'))
          if (mcpConfig.mcpServers && mcpConfig.mcpServers[extension.id]) {
            mcpConfig.mcpServers[extension.id] = {
              ...mcpConfig.mcpServers[extension.id],
              ...newConfig
            }
            writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2))
          }
        } catch {
          // Ignore config update errors
        }
      }
    }

    this.saveConfig()
    return { success: true }
  }

  enableForProject(extensionId: string, projectPath: string): { success: boolean; error?: string } {
    const config = this.loadConfig()
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

    this.saveConfig()
    return { success: true }
  }

  disableForProject(extensionId: string, projectPath: string): { success: boolean; error?: string } {
    const config = this.loadConfig()

    if (config.enabledByProject[projectPath]) {
      config.enabledByProject[projectPath] = config.enabledByProject[projectPath].filter(id => id !== extensionId)
    }

    this.saveConfig()
    return { success: true }
  }

  // ==================== CUSTOM URLS ====================

  addCustomUrl(url: string): void {
    const config = this.loadConfig()
    if (!config.customUrls.includes(url)) {
      config.customUrls.push(url)
      this.saveConfig()
    }
  }

  removeCustomUrl(url: string): void {
    const config = this.loadConfig()
    config.customUrls = config.customUrls.filter(u => u !== url)
    this.saveConfig()
  }

  getCustomUrls(): string[] {
    const config = this.loadConfig()
    return config.customUrls
  }
}

// Singleton instance
export const extensionManager = new ExtensionManager()
