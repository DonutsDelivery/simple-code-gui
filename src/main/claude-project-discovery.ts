import { createReadStream, existsSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, join, normalize } from 'path'
import { createInterface } from 'readline'

export interface DiscoveredClaudeProject {
  path: string
  name: string
  lastModified: number
}

function projectKey(projectPath: string): string {
  const normalized = normalize(projectPath).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function readSessionCwd(filePath: string): Promise<string | null> {
  const input = createReadStream(filePath, { encoding: 'utf-8' })
  const lines = createInterface({ input, crlfDelay: Infinity })

  try {
    for await (const line of lines) {
      if (!line.includes('"cwd"')) continue
      try {
        const data = JSON.parse(line)
        if (typeof data.cwd === 'string' && data.cwd.trim()) {
          return data.cwd
        }
      } catch {
        // Ignore a truncated/corrupt JSONL line and keep looking.
      }
    }
  } catch {
    return null
  } finally {
    lines.close()
    input.destroy()
  }

  return null
}

async function collectJsonlFiles(dir: string, files: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  await Promise.all(entries.map(async entry => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectJsonlFiles(fullPath, files)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl') && !entry.name.startsWith('agent-')) {
      files.push(fullPath)
    }
  }))
}

/**
 * Discover Claude Code projects from cwd values embedded in JSONL files under
 * ~/.claude/projects/ (all *.jsonl files are scanned recursively).
 * Existing sidebar/workspace state is deliberately not touched here; callers decide how
 * to merge discovered projects with manually configured ones.
 */
export async function discoverClaudeProjects(): Promise<DiscoveredClaudeProject[]> {
  const projectsDir = join(homedir(), '.claude', 'projects')
  if (!existsSync(projectsDir)) return []

  const files: string[] = []
  await collectJsonlFiles(projectsDir, files)

  const projects = new Map<string, DiscoveredClaudeProject>()

  // Keep file IO bounded so a large Claude history does not exhaust file descriptors.
  const concurrency = 16
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency)
    const results = await Promise.all(batch.map(async filePath => {
      const cwd = await readSessionCwd(filePath)
      if (!cwd || !existsSync(cwd)) return null

      try {
        const [cwdStat, fileStat] = await Promise.all([stat(cwd), stat(filePath)])
        if (!cwdStat.isDirectory()) return null
        return { cwd, lastModified: fileStat.mtimeMs }
      } catch {
        return null
      }
    }))

    for (const result of results) {
      if (!result) continue
      const key = projectKey(result.cwd)
      const existing = projects.get(key)
      if (!existing || result.lastModified > existing.lastModified) {
        const cleanPath = normalize(result.cwd).replace(/[\\/]+$/, '')
        projects.set(key, {
          path: cleanPath,
          name: basename(cleanPath) || cleanPath,
          lastModified: result.lastModified,
        })
      }
    }
  }

  return [...projects.values()].sort((a, b) => b.lastModified - a.lastModified)
}

export function normalizeProjectKey(projectPath: string): string {
  return projectKey(projectPath)
}
