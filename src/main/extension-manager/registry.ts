import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { Extension, Registry } from './types.js'
import {
  BUILTIN_REGISTRY,
  DEFAULT_REGISTRY_URL,
  REGISTRY_CACHE_TTL,
  getRegistryCachePath
} from './constants.js'

export interface RegistryCache {
  data: Registry
  fetchedAt: number
}

// Merge registries (remote extensions supplement builtin)
function mergeRegistries(remote: Registry | null): Registry {
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

export async function fetchRegistry(
  forceRefresh: boolean,
  memoryCache: RegistryCache | null
): Promise<{ data: Registry; cache: RegistryCache }> {
  // Check memory cache
  if (!forceRefresh && memoryCache) {
    const age = Date.now() - memoryCache.fetchedAt
    if (age < REGISTRY_CACHE_TTL) {
      return { data: memoryCache.data, cache: memoryCache }
    }
  }

  // Check disk cache
  const cachePath = getRegistryCachePath()
  if (!forceRefresh && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as RegistryCache
      if (Date.now() - cached.fetchedAt < REGISTRY_CACHE_TTL) {
        return { data: cached.data, cache: cached }
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
    const cache: RegistryCache = { data, fetchedAt: Date.now() }
    writeFileSync(cachePath, JSON.stringify(cache, null, 2))

    return { data, cache }
  } catch (error) {
    // Network failed - return builtin registry
    console.error('Failed to fetch remote registry, using built-in:', error)
    const data = mergeRegistries(null)

    // Cache the builtin registry so we don't spam network requests
    const cache: RegistryCache = { data, fetchedAt: Date.now() }

    return { data, cache }
  }
}

export async function fetchFromUrl(url: string): Promise<Extension | null> {
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
      const skillData = await skillResponse.json() as Record<string, unknown>
      return {
        id: (skillData.id as string) || repoName,
        name: (skillData.name as string) || repoName,
        description: (skillData.description as string) || '',
        type: 'skill',
        repo: url,
        commands: (skillData.commands as string[]) || [],
        tags: (skillData.tags as string[]) || []
      }
    }

    // Try package.json for npm packages (MCPs)
    const pkgJsonUrl = `${rawUrl}/package.json`
    const pkgResponse = await fetch(pkgJsonUrl)
    if (pkgResponse.ok) {
      const pkgData = await pkgResponse.json() as Record<string, unknown>
      const keywords = pkgData.keywords as string[] | undefined
      return {
        id: (pkgData.name as string) || repoName,
        name: (pkgData.name as string) || repoName,
        description: (pkgData.description as string) || '',
        type: keywords?.includes('mcp') ? 'mcp' : 'skill',
        repo: url,
        npm: pkgData.name as string,
        tags: keywords || []
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
