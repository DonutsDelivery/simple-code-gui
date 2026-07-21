import { createReadStream, existsSync } from 'fs'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'path'
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

export type SessionBackend = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok' | 'claude-codex'

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

let indexRepairTempCounter = 0

async function repairSessionsIndex(
  projectPath: string,
  projectSessionsDir: string,
  discovered: SessionWithIndexData[]
): Promise<void> {
  const indexPath = join(projectSessionsDir, 'sessions-index.json')
  const readIndexSource = async (): Promise<string | null> => {
    try {
      return await readFile(indexPath, 'utf-8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  let source: string | null
  try {
    source = await readIndexSource()
  } catch (e) {
    console.error('[SessionDiscovery] Failed to read sessions-index.json:', e)
    return
  }

  let existing: SessionsIndex = { version: 1, entries: [], originalPath: projectPath }
  if (source !== null) {
    try {
      const parsed = JSON.parse(source) as SessionsIndex
      if (Array.isArray(parsed.entries)) existing = parsed
    } catch {
      // Start fresh if corrupt
    }
  }

  // Remove stale entries (JSONL file no longer exists)
  const liveEntries = existing.entries.filter(e => existsSync(e.fullPath))
  const removedCount = existing.entries.length - liveEntries.length
  const discoveredById = new Map(discovered.map(session => [session.sessionId, session]))
  let refreshedCount = 0

  const mergedEntries = liveEntries.map(entry => {
    const session = discoveredById.get(entry.sessionId)
    if (!session) return entry

    if (
      entry.fullPath === session.fullPath
      && entry.projectPath === session.cwd
      && entry.fileMtime === session.lastModified
      && entry.modified === session.modified
      && entry.messageCount === session.messageCount
    ) {
      return entry
    }

    refreshedCount++
    return {
      ...entry,
      fullPath: session.fullPath,
      projectPath: session.cwd,
      fileMtime: session.lastModified,
      modified: session.modified,
      messageCount: session.messageCount,
    }
  })

  const existingIds = new Set(liveEntries.map(entry => entry.sessionId))
  const newEntries: SessionIndexEntry[] = discovered
    .filter(session => !existingIds.has(session.sessionId))
    .map(session => ({
      sessionId: session.sessionId,
      fullPath: session.fullPath,
      fileMtime: session.lastModified,
      firstPrompt: session.firstPrompt,
      summary: session.slug,
      messageCount: session.messageCount,
      created: session.created,
      modified: session.modified,
      gitBranch: '',
      projectPath: session.cwd || projectPath,
      isSidechain: false,
    }))

  const next: SessionsIndex = {
    ...existing,
    entries: [...mergedEntries, ...newEntries].sort((a, b) =>
      a.fileMtime - b.fileMtime || a.sessionId.localeCompare(b.sessionId)
    ),
  }

  if (JSON.stringify(next) === JSON.stringify(existing)) return

  const tempPath = `${indexPath}.${process.pid}.${indexRepairTempCounter++}.tmp`
  try {
    await writeFile(tempPath, JSON.stringify(next, null, 2), { encoding: 'utf-8', mode: 0o600 })

    // Do not replace metadata Claude Code changed while this repair was prepared.
    if (await readIndexSource() !== source) {
      await unlink(tempPath)
      return
    }

    await rename(tempPath, indexPath)
    if (newEntries.length > 0)
      console.log(`[SessionDiscovery] Added ${newEntries.length} session(s) to index for ${projectPath}`)
    if (refreshedCount > 0)
      console.log(`[SessionDiscovery] Refreshed ${refreshedCount} session(s) in index for ${projectPath}`)
    if (removedCount > 0)
      console.log(`[SessionDiscovery] Removed ${removedCount} stale session(s) from index for ${projectPath}`)
  } catch (e) {
    await unlink(tempPath).catch(() => {})
    console.error('[SessionDiscovery] Failed to update sessions-index.json:', e)
  }
}

function isOwnedClaudeSessionCwd(projectPath: string, cwd: string): boolean {
  const root = resolve(projectPath)
  const actual = resolve(cwd)
  if (actual === root) return true

  const worktreesRoot = resolve(root, '.claude', 'worktrees')
  const worktreeRelative = relative(worktreesRoot, actual)
  return worktreeRelative !== ''
    && worktreeRelative !== '..'
    && !worktreeRelative.startsWith(`..${sep}`)
    && !isAbsolute(worktreeRelative)
}

async function discoverClaudeSessions(projectPath: string): Promise<DiscoveredSession[]> {
  const claudeDir = join(homedir(), '.claude', 'projects')
  const exactStoreNames = new Set([
    encodeProjectPath(projectPath),
    encodeProjectPathLegacy(projectPath),
  ])
  const worktreeStorePrefixes = [...new Set([
    `${encodeProjectPath(join(projectPath, '.claude', 'worktrees'))}-`,
    `${encodeProjectPathLegacy(join(projectPath, '.claude', 'worktrees'))}-`,
  ])]

  let stores: Array<{ path: string; isRoot: boolean }>
  try {
    const entries = await readdir(claudeDir, { withFileTypes: true })
    stores = entries
      .filter(entry => entry.isDirectory())
      .filter(entry => exactStoreNames.has(entry.name) || worktreeStorePrefixes.some(prefix => entry.name.startsWith(prefix)))
      .map(entry => ({ path: join(claudeDir, entry.name), isRoot: exactStoreNames.has(entry.name) }))
      .sort((a, b) => a.path.localeCompare(b.path))
  } catch {
    return []
  }

  if (stores.length === 0) return []

  const sessions = new Map<string, SessionWithIndexData>()

  for (const store of stores) {
    const projectSessionsDir = store.path
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
              let recordedCwd = ''
              let hasForeignCwd = false
              let hasConversation = false
              let parseErrors = 0
              let firstPrompt = ''
              let messageCount = 0
              let firstTimestamp = ''

              for (const line of lines) {
                try {
                  const data = JSON.parse(line)
                  if (data.slug) slug = data.slug
                  if (data.cwd) {
                    recordedCwd = String(data.cwd)
                    if (!isOwnedClaudeSessionCwd(projectPath, recordedCwd)) hasForeignCwd = true
                  }
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

              const cwd = recordedCwd || (store.isRoot ? projectPath : '')
              if (!hasConversation || !cwd || hasForeignCwd) {
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

      const dirSessions = results.filter((result): result is SessionWithIndexData => result !== null)

      // Worktree indexes remain local; root indexes are repaired after global deduplication.
      if (!store.isRoot) {
        const indexProjectPath = [...dirSessions]
          .sort((a, b) => a.fullPath.localeCompare(b.fullPath))[0]?.cwd ?? projectPath
        await repairSessionsIndex(indexProjectPath, projectSessionsDir, dirSessions)
      }

      // A session may have a stale root copy and a newer worktree copy.
      for (const result of dirSessions) {
        const current = sessions.get(result.sessionId)
        if (
          !current
          || result.lastModified > current.lastModified
          || (result.lastModified === current.lastModified && result.fullPath.localeCompare(current.fullPath) < 0)
        ) {
          sessions.set(result.sessionId, result)
        }
      }
    } catch (e) {
      console.error('Failed to read sessions directory:', e)
    }
  }

  // Sort by most recent first
  const sorted = [...sessions.values()]
  sorted.sort((a, b) =>
    b.lastModified - a.lastModified || a.fullPath.localeCompare(b.fullPath)
  )

  // Mirror owned worktree entries into the root index so native /resume can
  // surface them without switching to Claude Code's all-projects view.
  const rootIndexDirs = stores.filter(store => store.isRoot).map(store => store.path)
  if (sorted.length > 0 && rootIndexDirs.length === 0) {
    const rootIndexDir = join(claudeDir, encodeProjectPath(projectPath))
    await mkdir(rootIndexDir, { recursive: true })
    rootIndexDirs.push(rootIndexDir)
  }
  for (const rootIndexDir of rootIndexDirs) {
    await repairSessionsIndex(projectPath, rootIndexDir, sorted)
  }

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

async function discoverCodexSessions(projectPath: string): Promise<DiscoveredSession[]> {
  // Codex stores sessions under ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<UUID>.jsonl
  // The first line of each file is a session_meta entry with {id, cwd}.
  const codexSessionsDir = join(homedir(), '.codex', 'sessions')

  const results: DiscoveredSession[] = []

  function readFirstLine(filePath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const stream = createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 8192 })
      let buffered = ''
      let settled = false

      const finish = (line: string | null) => {
        if (settled) return
        settled = true
        stream.destroy()
        resolve(line)
      }

      stream.on('data', (chunk) => {
        buffered += chunk
        const newlineIndex = buffered.indexOf('\n')
        if (newlineIndex !== -1) {
          finish(buffered.slice(0, newlineIndex))
        }
      })
      stream.on('end', () => finish(buffered || null))
      stream.on('error', () => finish(null))
    })
  }

  async function scanDir(dir: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    await Promise.all(entries.map(async entry => {
      const fullPath = join(dir, entry)
      if (entry.endsWith('.jsonl')) {
        try {
          // Codex session files can be very large. Only the first line is needed
          // for session_meta, so avoid loading full JSONL files during polling.
          const firstLine = await readFirstLine(fullPath)
          if (!firstLine) return
          if (!firstLine.includes('session_meta')) return

          const idMatch = firstLine.match(/"id":"([0-9a-f-]+)"/)
          const cwdMatch = firstLine.match(/"cwd":"((?:[^"\\]|\\.)*)"/)
          if (!idMatch || !cwdMatch) return
          if (cwdMatch[1] !== projectPath) return

          const fileStat = await stat(fullPath)
          // Extract timestamp from filename for the slug
          const tsMatch = entry.match(/rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-/)
          const slug = tsMatch
            ? tsMatch[1].replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2').slice(0, 16)
            : idMatch[1].slice(0, 8)

          results.push({
            sessionId: idMatch[1],
            slug,
            lastModified: fileStat.mtimeMs,
            cwd: cwdMatch[1],
            fileSize: fileStat.size,
          })
        } catch {
          // Skip unparseable files
        }
      } else {
        await scanDir(fullPath)
      }
    }))
  }

  await scanDir(codexSessionsDir)
  results.sort((a, b) => b.lastModified - a.lastModified)
  return results
}

export async function discoverSessions(
  projectPath: string,
  backend: SessionBackend = 'claude',
  _exactSessionId?: string
): Promise<DiscoveredSession[]> {
  if (backend === 'opencode') {
    return await discoverOpenCodeSessions(projectPath)
  }
  if (backend === 'codex') {
    return await discoverCodexSessions(projectPath)
  }
  if (backend === 'droid') {
    return discoverDroidSessions(projectPath)
  }
  if (backend === 'hermes') {
    return []
  }
  if (backend === 'grok') {
    return []
  }
  return discoverClaudeSessions(projectPath)
}
