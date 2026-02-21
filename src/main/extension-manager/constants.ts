import { homedir } from 'os'
import { join } from 'path'
import type { Registry } from './types.js'

// Default registry URL (can be overridden)
export const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/anthropics/claude-code-extensions/main/registry.json'

// Cache TTL: 1 hour
export const REGISTRY_CACHE_TTL = 60 * 60 * 1000

// Built-in default extensions (always available, no network needed)
export const BUILTIN_REGISTRY: Registry = {
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

// Path helpers
export function getExtensionsDir(): string {
  return join(homedir(), '.claude', 'extensions')
}

export function getInstalledJsonPath(): string {
  return join(getExtensionsDir(), 'installed.json')
}

export function getRegistryCachePath(): string {
  return join(getExtensionsDir(), 'registry-cache.json')
}

export function getSkillsDir(): string {
  return join(homedir(), '.claude', 'skills')
}

export function getMcpConfigPath(): string {
  return join(homedir(), '.claude', 'mcp_config.json')
}
