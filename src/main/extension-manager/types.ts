// Types for extension management

export interface Extension {
  id: string
  name: string
  description: string
  type: 'skill' | 'mcp' | 'agent'
  repo?: string        // GitHub URL for skills
  npm?: string         // npm package for MCPs
  commands?: string[]  // Slash commands provided
  tags?: string[]
  configSchema?: Record<string, unknown>  // JSON schema for MCP config
}

export interface InstalledExtension extends Extension {
  installedAt: number
  version?: string
  enabled: boolean
  scope: 'global' | 'project'
  projectPath?: string  // Only for project-scoped
  config?: Record<string, unknown>
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

export interface OperationResult {
  success: boolean
  error?: string
}
