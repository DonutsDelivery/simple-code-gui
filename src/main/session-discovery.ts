import { existsSync, readFileSync } from 'fs'
import { readdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { getEnhancedPathWithPortable } from './platform'

export interface DiscoveredSession {
  sessionId: string
  slug: string
  lastModified: number
  cwd: string
  fileSize: number
}

export type SessionBackend = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes'

// Message types that indicate actual conversation content (not just summaries)
const CONVERSATION_TYPES = ['user', 'assistant']

function encodeProjectPath(projectPath: string): string {
  // Claude's current encoding scheme:
  // 1. Remove trailing slashes/backslashes
  // 2. Replace / and \ with -
  // 3. Replace : with - (Windows drive letters)
  // 4. Replace _ with -
  // 5. Replace spaces with -
  // 6. Replace dots with dashes (e.g. .config -> -config)
  return projectPath
    .replace(/[/\\]+$/, '')  // Remove trailing slashes/backslashes
    .replace(/[/\\]/g, '-')  // Replace / and \ with -
    .replace(/:/g, '-')      // Replace : with - (Windows drive letters)
    .replace(/_/g, '-')      // Replace _ with -
    .replace(/ /g, '-')      // Replace spaces with -
    .replace(/\./g, '-')     // Replace dots with dashes
}

// Claude used a different encoding in older versions (no leading dash, spaces preserved)
function encodeProjectPathLegacy(projectPath: string): string {
  return projectPath
    .replace(/[/\\]+$/, '')
    .replace(/^[/\\]/, '')   // Strip leading slash (no leading dash)
    .replace(/[/\\]/g, '-')
    .replace(/:/g, '-')
    .replace(/_/g, '-')
    .replace(/\./g, '-')
    // Spaces are NOT replaced in the legacy format
}



interface SessionWithIndexData extends DiscoveredSession {
  fullPath: string
  firstPrompt: string
  messageCount: number
  created: string
  modified: string
}

interface SessionIndexEntry {
  sessionId: string
  fullPath: string
  fileMtime: number
  firstPrompt: string
  summary: string
  messageCount: number
  created: string
  modified: string
  gitBranch: string
  projectPath: string
  isSidechain: boolean
}

interface SessionsIndex {
  version: number
  entries: SessionIndexEntry[]
  originalPath: string
}

async function repairSessionsIndex(
  projectPath: string,
  projectSessionsDir: string,
  discovered: SessionWithIndexData[]
): Promise<void> {
  const indexPath = join(projectSessionsDir, 'sessions-index.json')

  let existing: SessionsIndex = { version: 1, entries: [], originalPath: projectPath }
  try {
    if (existsSync(indexPath)) {
      existing = JSON.parse(readFileSync(indexPath, 'utf-8'))
    }
  } catch {
    // Start fresh if corrupt
  }

  // Remove stale entries (JSONL file no longer exists)
  const liveEntries = existing.entries.filter(e => existsSync(e.fullPath))
  const removedCount = existing.entries.length - liveEntries.length

  const existingIds = new Set(liveEntries.map(e => e.sessionId))
  const newEntries: SessionIndexEntry[] = []

  for (const s of discovered) {
    if (!existingIds.has(s.sessionId)) {
      newEntries.push({
        sessionId: s.sessionId,
        fullPath: s.fullPath,
        fileMtime: s.lastModified,
        firstPrompt: s.firstPrompt,
        summary: s.slug,
        messageCount: s.messageCount,
        created: s.created,
        modified: s.modified,
        gitBranch: '',
        projectPath,
        isSidechain: false,
      })
    }
  }

  if (newEntries.length === 0 && removedCount === 0) return

  existing.entries = [...liveEntries, ...newEntries]
  try {
    await writeFile(indexPath, JSON.stringify(existing, null, 2), 'utf-8')
    if (newEntries.length > 0)
      console.log(`[SessionDiscovery] Added ${newEntries.length} session(s) to index for ${projectPath}`)
    if (removedCount > 0)
      console.log(`[SessionDiscovery] Removed ${removedCount} stale session(s) from index for ${projectPath}`)
  } catch (e) {
    console.error('[SessionDiscovery] Failed to update sessions-index.json:', e)
  }
}

async function discoverClaudeSessions(projectPath: string): Promise<DiscoveredSession[]> {
  const claudeDir = join(homedir(), '.claude', 'projects')

  // Check both current and legacy encoding schemes to find all sessions
  const candidateDirs = [
    join(claudeDir, encodeProjectPath(projectPath)),
    join(claudeDir, encodeProjectPathLegacy(projectPath))
  ]
  // Deduplicate (they may produce the same result for paths without spaces)
  const uniqueDirs = [...new Set(candidateDirs)].filter(dir => existsSync(dir))

  if (uniqueDirs.length === 0) {
    return []
  }

  const sessions = new Map<string, SessionWithIndexData>()

  for (const projectSessionsDir of uniqueDirs) {
    try {
      const files = await readdir(projectSessionsDir)

      // Process files in parallel for better performance
      const results = await Promise.all(
        files
          .filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'))
          .map(async (file) => {
            const sessionId = file.replace('.jsonl', '')
            const filePath = join(projectSessionsDir, file)

            try {
              // Read content first, then stat — ensures mtime/size reflect
              // at least the content we read (file may grow from active writes)
              const content = await readFile(filePath, 'utf-8')
              const fileStat = await stat(filePath)
              const lines = content.split('\n').filter(line => line.trim())

              // Look for slug and check if session has actual conversation
              let slug = sessionId.slice(0, 8)
              let cwd = projectPath
              let hasConversation = false
              let parseErrors = 0
              let firstPrompt = ''
              let messageCount = 0
              let firstTimestamp = ''

              for (const line of lines) {
                try {
                  const data = JSON.parse(line)
                  if (data.slug) slug = data.slug
                  if (data.cwd) cwd = data.cwd
                  if (data.type && CONVERSATION_TYPES.includes(data.type)) {
                    hasConversation = true
                    messageCount++
                    if (!firstTimestamp && data.timestamp) firstTimestamp = data.timestamp
                    if (data.type === 'user' && !firstPrompt) {
                      const msg = data.message
                      if (typeof msg === 'string') {
                        firstPrompt = msg.slice(0, 200)
                      } else if (msg?.content) {
                        const c = Array.isArray(msg.content)
                          ? (msg.content.find((x: any) => x.type === 'text')?.text ?? '')
                          : String(msg.content)
                        firstPrompt = c.slice(0, 200)
                      }
                    }
                  }
                } catch {
                  parseErrors++
                }
              }

              // Log if many lines failed to parse (suggests file corruption,
              // not just a single truncated line from a concurrent write)
              if (parseErrors > 1) {
                console.warn(`Session ${file}: ${parseErrors}/${lines.length} lines failed to parse`)
              }

              if (!hasConversation) {
                return null
              }

              return {
                sessionId,
                slug,
                lastModified: fileStat.mtimeMs,
                cwd,
                fileSize: fileStat.size,
                fullPath: filePath,
                firstPrompt,
                messageCount,
                created: firstTimestamp || fileStat.birthtime.toISOString(),
                modified: fileStat.mtime.toISOString(),
              } satisfies SessionWithIndexData
            } catch (e) {
              console.error(`Failed to parse session ${file}:`, e)
              return null
            }
          })
      )

      // Deduplicate by sessionId (same session may appear in both dirs)
      const dirSessions: SessionWithIndexData[] = []
      for (const result of results) {
        if (result && !sessions.has(result.sessionId)) {
          sessions.set(result.sessionId, result)
          dirSessions.push(result)
        }
      }

      // Keep sessions-index.json in sync so Claude's /resume shows real sessions
      await repairSessionsIndex(projectPath, projectSessionsDir, dirSessions)
    } catch (e) {
      console.error('Failed to read sessions directory:', e)
    }
  }

  // Sort by most recent first
  const sorted = [...sessions.values()]
  sorted.sort((a, b) => b.lastModified - a.lastModified)

  return sorted
}

async function discoverOpenCodeSessions(projectPath: string): Promise<DiscoveredSession[]> {
  try {
    const enhancedPath = getEnhancedPathWithPortable()
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile('opencode', ['session', 'list', '--format', 'json'], {
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        cwd: projectPath,
        env: { ...process.env, PATH: enhancedPath, CI: '1', TERM: 'dumb' },
      }, (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout)
      })
      child.stdin?.end()
    })

    const sessions: Array<{
      id: string
      title: string | null
      updated: number
      created: number
      directory: string
    }> = JSON.parse(stdout)

    return sessions
      .filter(s => s.directory === projectPath && (s.updated || s.created))
      .map(s => ({
        sessionId: s.id,
        slug: (s.title && s.title.trim()) || s.id.slice(0, 8),
        lastModified: s.updated || s.created,
        cwd: s.directory,
        fileSize: 0,
      }))
  } catch (e) {
    console.error('Failed to discover OpenCode sessions:', e)
    return []
  }
}

// Droid's path encoding: slashes become dashes, but dots/spaces/underscores are preserved
function encodeDroidProjectPath(projectPath: string): string {
  return projectPath
    .replace(/[/\\]+$/, '')
    .replace(/[/\\]/g, '-')
    .replace(/:/g, '-')
}

async function discoverDroidSessions(projectPath: string): Promise<DiscoveredSession[]> {
  const factoryDir = join(homedir(), '.factory', 'sessions')

  const candidateDirs = [
    join(factoryDir, encodeDroidProjectPath(projectPath)),
    // Also try Claude-style encoding in case droid changes its scheme
    join(factoryDir, encodeProjectPath(projectPath))
  ]
  const uniqueDirs = [...new Set(candidateDirs)].filter(dir => existsSync(dir))

  if (uniqueDirs.length === 0) {
    return []
  }

  const sessions = new Map<string, DiscoveredSession>()

  for (const projectSessionsDir of uniqueDirs) {
    try {
      const files = await readdir(projectSessionsDir)

      const results = await Promise.all(
        files
          .filter(file => file.endsWith('.jsonl'))
          .map(async (file) => {
            const sessionId = file.replace('.jsonl', '')
            const filePath = join(projectSessionsDir, file)

            try {
              const content = await readFile(filePath, 'utf-8')
              const fileStat = await stat(filePath)
              const lines = content.split('\n').filter(line => line.trim())

              let slug = sessionId.slice(0, 8)
              let cwd = projectPath
              let hasConversation = false

              for (const line of lines) {
                try {
                  const data = JSON.parse(line)
                  // Droid uses sessionTitle or title for the slug
                  if (data.sessionTitle) slug = data.sessionTitle
                  else if (data.title) slug = data.title
                  else if (data.slug) slug = data.slug
                  if (data.cwd) cwd = data.cwd
                  if (data.type === 'message') {
                    hasConversation = true
                  }
                } catch {
                  // skip unparseable lines
                }
              }

              if (!hasConversation) return null

              return {
                sessionId,
                slug,
                lastModified: fileStat.mtimeMs,
                cwd,
                fileSize: fileStat.size
              }
            } catch {
              return null
            }
          })
      )

      for (const result of results) {
        if (result && !sessions.has(result.sessionId)) {
          sessions.set(result.sessionId, result)
        }
      }
    } catch (e) {
      console.error('Failed to read droid sessions directory:', e)
    }
  }

  const sorted = [...sessions.values()]
  sorted.sort((a, b) => b.lastModified - a.lastModified)
  return sorted
}

export async function discoverSessions(projectPath: string, backend: SessionBackend = 'claude'): Promise<DiscoveredSession[]> {
  if (backend === 'opencode') {
    return await discoverOpenCodeSessions(projectPath)
  }
  if (backend === 'droid') {
    return discoverDroidSessions(projectPath)
  }
  if (backend === 'hermes') {
    return []
  }
  return discoverClaudeSessions(projectPath)
}
