import { existsSync, readFileSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { join, isAbsolute } from 'path'
import { homedir } from 'os'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('better-sqlite3')

export interface DiscoveredSession {
  sessionId: string
  slug: string
  lastModified: number
  cwd: string
  fileSize: number
}

export type SessionBackend = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider'

// Message types that indicate actual conversation content (not just summaries)
const CONVERSATION_TYPES = ['user', 'assistant']
const OPENCODE_CONFIG_NAME = '.opencode.json'

function encodeProjectPath(projectPath: string): string {
  // Claude encodes paths by:
  // 1. Removing trailing slashes/backslashes
  // 2. Replacing / and \ with -
  // 3. Replacing _ with -
  // 4. Replacing spaces with -
  // 5. Replacing : with - (Windows drive letters)
  // /home/user/my_project/ becomes -home-user-my-project
  // C:\Users\bob\project becomes -C-Users-bob-project
  return projectPath
    .replace(/[/\\]+$/, '')  // Remove trailing slashes/backslashes
    .replace(/[/\\]/g, '-')  // Replace / and \ with -
    .replace(/:/g, '-')      // Replace : with - (Windows drive letters)
    .replace(/_/g, '-')      // Replace _ with -
    .replace(/ /g, '-')      // Replace spaces with -
}

function expandHomePath(targetPath: string): string {
  if (targetPath === '~') {
    return homedir()
  }
  if (targetPath.startsWith('~/') || targetPath.startsWith('~\\')) {
    return join(homedir(), targetPath.slice(2))
  }
  return targetPath
}

function loadOpenCodeConfig(projectPath: string): { data?: { directory?: string } } | null {
  const home = homedir()
  const xdgConfig = process.env.XDG_CONFIG_HOME
  const candidatePaths = [
    join(projectPath, OPENCODE_CONFIG_NAME),
    ...(xdgConfig ? [join(xdgConfig, 'opencode', OPENCODE_CONFIG_NAME)] : []),
    join(home, '.config', 'opencode', OPENCODE_CONFIG_NAME),
    join(home, OPENCODE_CONFIG_NAME)
  ]

  for (const configPath of candidatePaths) {
    if (!existsSync(configPath)) continue
    try {
      const content = readFileSync(configPath, 'utf-8')
      return JSON.parse(content)
    } catch (e) {
      console.error('Failed to parse OpenCode config:', e)
    }
  }

  return null
}

function resolveOpenCodeDataDir(projectPath: string): string {
  const config = loadOpenCodeConfig(projectPath)
  const configured = config?.data?.directory?.trim()
  const dataDir = configured && configured.length > 0 ? configured : '.opencode'
  const expanded = expandHomePath(dataDir)
  return isAbsolute(expanded) ? expanded : join(projectPath, expanded)
}

async function discoverClaudeSessions(projectPath: string): Promise<DiscoveredSession[]> {
  const claudeDir = join(homedir(), '.claude', 'projects')
  const encodedPath = encodeProjectPath(projectPath)
  const projectSessionsDir = join(claudeDir, encodedPath)

  if (!existsSync(projectSessionsDir)) {
    return []
  }

  const sessions: DiscoveredSession[] = []

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
            const fileStat = await stat(filePath)
            const content = await readFile(filePath, 'utf-8')
            const lines = content.split('\n').filter(line => line.trim())

            // Look for slug and check if session has actual conversation
            let slug = sessionId.slice(0, 8)
            let cwd = projectPath
            let hasConversation = false

            for (const line of lines) {
              try {
                const data = JSON.parse(line)
                if (data.slug) slug = data.slug
                if (data.cwd) cwd = data.cwd
                if (data.type && CONVERSATION_TYPES.includes(data.type)) {
                  hasConversation = true
                }
              } catch {
                // Skip non-JSON lines
              }
            }

            if (!hasConversation) {
              return null
            }

            return {
              sessionId,
              slug,
              lastModified: fileStat.mtimeMs,
              cwd,
              fileSize: fileStat.size
            }
          } catch (e) {
            console.error(`Failed to parse session ${file}:`, e)
            return null
          }
        })
    )

    // Filter out nulls and add to sessions
    for (const result of results) {
      if (result) sessions.push(result)
    }
  } catch (e) {
    console.error('Failed to read sessions directory:', e)
  }

  // Sort by most recent first
  sessions.sort((a, b) => b.lastModified - a.lastModified)

  return sessions
}

function discoverOpenCodeSessions(projectPath: string): DiscoveredSession[] {
  const dataDir = resolveOpenCodeDataDir(projectPath)
  const dbPath = join(dataDir, 'opencode.db')

  if (!existsSync(dbPath)) {
    return []
  }

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const rows = db.prepare(`
      SELECT id, title, updated_at, created_at, message_count
      FROM sessions
      WHERE parent_session_id IS NULL
      ORDER BY updated_at DESC
    `).all() as Array<{ id: string; title: string | null; updated_at: number; created_at: number; message_count: number }>
    db.close()

    return rows
      .filter(row => (row.message_count ?? 0) > 0)
      .map(row => {
        const lastModifiedSeconds = row.updated_at || row.created_at || 0
        return {
          sessionId: row.id,
          slug: (row.title && row.title.trim()) || row.id.slice(0, 8),
          lastModified: Number(lastModifiedSeconds) * 1000,
          cwd: projectPath,
          fileSize: 0
        }
      })
  } catch (e) {
    console.error('Failed to read OpenCode sessions:', e)
    return []
  }
}

export async function discoverSessions(projectPath: string, backend: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' = 'claude'): Promise<DiscoveredSession[]> {
  if (backend === 'opencode') {
    return discoverOpenCodeSessions(projectPath)
  }
  return discoverClaudeSessions(projectPath)
}
