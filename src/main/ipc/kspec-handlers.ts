/**
 * Kspec IPC Handlers
 *
 * Minimal handlers for operations that need main process access:
 * - Filesystem checks (.kspec/ existence)
 * - Project initialization (runs kspec CLI)
 * - Daemon lifecycle (start/stop)
 *
 * Most kspec operations go directly to the daemon HTTP API from the renderer.
 * These handlers only cover what can't be done from the browser context.
 */

import { ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { getEnhancedPathWithPortable } from '../platform'

const TASK_INSTRUCTIONS_START = '<!-- TASK_MANAGEMENT_START -->'
const TASK_INSTRUCTIONS_END = '<!-- TASK_MANAGEMENT_END -->'

function getTaskInstructions(backend: 'beads' | 'kspec'): string {
  const beadsCommands = `### CLI Commands (beads)
- \`bd list\` — List tasks (add \`--status=open\` to filter)
- \`bd show <id>\` — Show task details
- \`bd create --title="..." --type=task|bug|feature --priority=2\` — Create a task
- \`bd update <id> --status=in_progress\` — Start a task
- \`bd close <id>\` — Complete a task
- \`bd ready\` — Show tasks ready to work on

### Workflow
1. Check the task panel in the GUI sidebar for available work
2. Click a task to start it, or use the CLI commands above
3. Mark tasks complete from the GUI or CLI when done`

  const kspecInstructions = `@kspec-agents.md

This project uses **kspec** for spec-driven task management and autonomous agent dispatch.
The full agent instructions are in \`kspec-agents.md\` (referenced above).

### Quick Reference
- \`kspec task list\` — List tasks
- \`kspec task create --title "..." --type task|bug|epic|spike|infra --priority 3\` — Create a task
- \`kspec task start <ref>\` — Start a task
- \`kspec inbox add "..."\` — Add idea for later triage
- Use \`/kspec:help\` for full command reference
- Use \`/kspec:writing-specs\` to create spec items (features, requirements, AC)
- Use \`/kspec:plan\` to translate plans into specs and tasks
- Use \`/kspec:triage\` to triage inbox and assess automation eligibility`

  return `${TASK_INSTRUCTIONS_START}
## Task Management

${backend === 'beads' ? beadsCommands : kspecInstructions}
${TASK_INSTRUCTIONS_END}
`
}

export function installTaskInstructions(projectPath: string, backend: 'beads' | 'kspec'): boolean {
  try {
    const claudeDir = join(projectPath, '.claude')
    const claudeMdPath = join(claudeDir, 'CLAUDE.md')

    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true })
    }

    let content = ''
    if (existsSync(claudeMdPath)) {
      content = readFileSync(claudeMdPath, 'utf8')
      // Remove existing task section if present
      if (content.includes(TASK_INSTRUCTIONS_START)) {
        const startIdx = content.indexOf(TASK_INSTRUCTIONS_START)
        const endIdx = content.indexOf(TASK_INSTRUCTIONS_END)
        if (startIdx !== -1 && endIdx !== -1) {
          content = content.substring(0, startIdx) + content.substring(endIdx + TASK_INSTRUCTIONS_END.length)
        }
      }
    }

    content += getTaskInstructions(backend)
    writeFileSync(claudeMdPath, content)
    return true
  } catch (e) {
    console.error('Failed to install task instructions:', e)
    return false
  }
}

function getExecOptions() {
  return {
    env: { ...process.env, PATH: getEnhancedPathWithPortable() }
  }
}

function spawnCommand(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: getExecOptions().env,
      shell: false
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 })
    })

    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, code: 1 })
    })
  })
}

async function migrateBeadsToKspec(cwd: string): Promise<{ success: boolean; migrated: number; error?: string }> {
  try {
    // 1. Read all beads tasks via bd list --json
    const listResult = await spawnCommand('bd', ['list', '--json'], cwd)
    if (listResult.code !== 0) {
      return { success: false, migrated: 0, error: `Failed to read beads tasks: ${listResult.stderr}` }
    }

    let beadsTasks: Array<Record<string, unknown>> = []
    try {
      const parsed = JSON.parse(listResult.stdout)
      beadsTasks = Array.isArray(parsed) ? parsed : (parsed.issues ?? parsed.tasks ?? [])
    } catch {
      // No tasks to migrate, or empty output — that's fine
      beadsTasks = []
    }

    // 2. Initialize kspec
    const gitDir = join(cwd, '.git')
    if (!existsSync(gitDir)) {
      const gitResult = await spawnCommand('git', ['init'], cwd)
      if (gitResult.code !== 0) {
        return { success: false, migrated: 0, error: `Failed to init git: ${gitResult.stderr}` }
      }
      await spawnCommand('git', ['config', 'user.name', 'kspec'], cwd)
      await spawnCommand('git', ['config', 'user.email', 'kspec@local'], cwd)
      await spawnCommand('git', ['commit', '--allow-empty', '-m', 'init'], cwd)
    }

    const initResult = await spawnCommand('kspec', ['init', '.', '--name', 'Project'], cwd)
    if (initResult.code !== 0) {
      return { success: false, migrated: 0, error: `kspec init failed: ${initResult.stderr}` }
    }

    // Run setup + generate agents instructions
    await spawnCommand('kspec', ['setup'], cwd)
    await spawnCommand('kspec', ['agents', 'generate'], cwd)

    // 3. Ensure daemon is running for task creation
    let daemonReady = false
    const healthCheck = await fetch('http://localhost:3456/api/health').catch(() => null)
    if (healthCheck?.ok) {
      daemonReady = true
    } else {
      const proc = spawn('kspec', ['serve', 'start', '--daemon'], {
        cwd,
        env: getExecOptions().env,
        detached: true,
        stdio: 'ignore'
      })
      proc.unref()
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500))
        const check = await fetch('http://localhost:3456/api/health').catch(() => null)
        if (check?.ok) { daemonReady = true; break }
      }
    }

    // 4. Migrate each task to kspec
    let migrated = 0
    if (daemonReady && beadsTasks.length > 0) {
      // Register project with daemon
      await fetch('http://localhost:3456/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: cwd })
      }).catch(() => {})

      for (const task of beadsTasks) {
        try {
          // Map beads priority (0-4, 0=critical) to kspec priority (1-5, 1=highest)
          const beadsPriority = typeof task.priority === 'number' ? task.priority : 2
          const kspecPriority = Math.min(5, Math.max(1, beadsPriority + 1))

          // Map beads type to kspec type
          const beadsType = String(task.issue_type ?? task.type ?? 'task')
          const kspecType = beadsType === 'feature' ? 'task' : (['bug', 'task', 'epic'].includes(beadsType) ? beadsType : 'task')

          const res = await fetch('http://localhost:3456/api/tasks', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Kspec-Dir': cwd
            },
            body: JSON.stringify({
              title: String(task.title ?? ''),
              description: String(task.description ?? ''),
              priority: kspecPriority,
              type: kspecType,
              tags: [`migrated-from:${String(task.id ?? '')}`]
            })
          })
          if (res.ok) migrated++
        } catch {
          // Skip individual task failures
        }
      }
    }

    // 5. Stop beads daemon and remove .beads/ directory
    const beadsDir = join(cwd, '.beads')
    if (existsSync(beadsDir)) {
      // Stop beads daemon first (releases lock files)
      await spawnCommand('bd', ['daemon', '--stop'], cwd).catch(() => {})
      // Small delay for daemon to release files
      await new Promise(r => setTimeout(r, 500))
      const { rmSync } = await import('fs')
      rmSync(beadsDir, { recursive: true, force: true })
    }

    // 6. Update CLAUDE.md to kspec instructions
    installTaskInstructions(cwd, 'kspec')

    return { success: true, migrated }
  } catch (e) {
    return { success: false, migrated: 0, error: String(e) }
  }
}

async function checkAndUpdateKspec(): Promise<void> {
  try {
    const localResult = await spawnCommand('kspec', ['--version'], process.cwd())
    if (localResult.code !== 0) return
    const localVersion = localResult.stdout.trim().replace(/^v/, '')

    const npmResult = await spawnCommand('npm', ['view', '@kynetic-ai/spec', 'version'], process.cwd())
    if (npmResult.code !== 0) return
    const latestVersion = npmResult.stdout.trim()

    if (localVersion !== latestVersion) {
      console.log(`[kspec] Updating from ${localVersion} to ${latestVersion}...`)
      await spawnCommand('npm', ['install', '-g', '@kynetic-ai/spec@latest'], process.cwd())
      console.log(`[kspec] Updated to ${latestVersion}`)
    }
  } catch { /* silent */ }
}

export function registerKspecHandlers() {
  // Check if .kspec/ directory exists in a project
  ipcMain.handle('kspec:check', async (_event, cwd: string) => {
    const kspecPath = join(cwd, '.kspec')
    const exists = existsSync(kspecPath)
    return { exists }
  })

  // Initialize kspec in a project directory
  // Requires: git repo, kspec CLI available
  ipcMain.handle('kspec:init', async (_event, cwd: string) => {
    try {
      // Check if it's a git repo first
      const gitDir = join(cwd, '.git')
      if (!existsSync(gitDir)) {
        // Init git first
        const gitResult = await spawnCommand('git', ['init'], cwd)
        if (gitResult.code !== 0) {
          return { success: false, error: `Failed to init git: ${gitResult.stderr}` }
        }
        // Set default git config for the repo
        await spawnCommand('git', ['config', 'user.name', 'kspec'], cwd)
        await spawnCommand('git', ['config', 'user.email', 'kspec@local'], cwd)
        await spawnCommand('git', ['commit', '--allow-empty', '-m', 'init'], cwd)
      }

      // Run kspec init
      const result = await spawnCommand('kspec', ['init', '.', '--name', 'Project'], cwd)
      if (result.code !== 0) {
        return { success: false, error: result.stderr || 'kspec init failed' }
      }

      // Run kspec setup — sets up agent definitions, skills, .agents/ directory
      await spawnCommand('kspec', ['setup'], cwd)

      // Generate kspec-agents.md — full agent instructions with workflows, conventions, skills
      await spawnCommand('kspec', ['agents', 'generate'], cwd)

      // Add task instructions to CLAUDE.md pointing at kspec-agents.md
      installTaskInstructions(cwd, 'kspec')

      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Start kspec daemon if not running
  let updateCheckDone = false
  ipcMain.handle('kspec:ensure-daemon', async (_event, cwd: string) => {
    try {
      // Check if daemon is already running
      const res = await fetch('http://localhost:3456/api/health').catch(() => null)
      if (res?.ok) {
        // Register this project with the running daemon
        await fetch('http://localhost:3456/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: cwd })
        }).catch(() => {})

        // Background update check (once per app session, non-blocking)
        if (!updateCheckDone) {
          updateCheckDone = true
          checkAndUpdateKspec().catch(() => {})
        }

        return { success: true, alreadyRunning: true }
      }

      // Start daemon in background
      const proc = spawn('kspec', ['serve', 'start', '--daemon'], {
        cwd,
        env: getExecOptions().env,
        detached: true,
        stdio: 'ignore'
      })
      proc.unref()

      // Wait for daemon to be ready (up to 5 seconds)
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500))
        const check = await fetch('http://localhost:3456/api/health').catch(() => null)
        if (check?.ok) {
          return { success: true, alreadyRunning: false }
        }
      }

      return { success: false, error: 'Daemon did not start in time' }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Check if kspec CLI is installed
  ipcMain.handle('kspec:check-cli', async () => {
    try {
      const result = await spawnCommand('kspec', ['--version'], process.cwd())
      return { installed: result.code === 0, version: result.stdout.trim() }
    } catch {
      return { installed: false }
    }
  })

  // Install kspec CLI via npm
  ipcMain.handle('kspec:install-cli', async () => {
    try {
      const result = await spawnCommand('npm', ['install', '-g', '@kynetic-ai/spec'], process.cwd())
      if (result.code !== 0) {
        return { success: false, error: result.stderr || 'npm install failed' }
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Migrate beads tasks to kspec (upgrade path)
  ipcMain.handle('kspec:migrate-from-beads', async (_event, cwd: string) => {
    return migrateBeadsToKspec(cwd)
  })

  // Check for kspec updates and install if available
  ipcMain.handle('kspec:update', async () => {
    try {
      // Get installed version
      const localResult = await spawnCommand('kspec', ['--version'], process.cwd())
      if (localResult.code !== 0) return { updated: false, error: 'kspec not installed' }
      const localVersion = localResult.stdout.trim().replace(/^v/, '')

      // Get latest version from npm
      const npmResult = await spawnCommand('npm', ['view', '@kynetic-ai/spec', 'version'], process.cwd())
      if (npmResult.code !== 0) return { updated: false, error: 'Could not check npm' }
      const latestVersion = npmResult.stdout.trim()

      if (localVersion === latestVersion) {
        return { updated: false, current: localVersion, latest: latestVersion }
      }

      // Update
      const updateResult = await spawnCommand('npm', ['install', '-g', '@kynetic-ai/spec@latest'], process.cwd())
      if (updateResult.code !== 0) {
        return { updated: false, error: updateResult.stderr || 'Update failed', current: localVersion, latest: latestVersion }
      }

      return { updated: true, previous: localVersion, current: latestVersion }
    } catch (e) {
      return { updated: false, error: String(e) }
    }
  })

  // Start agent dispatch
  ipcMain.handle('kspec:dispatch-start', async (_event, cwd: string) => {
    try {
      const result = await spawnCommand('kspec', ['agent', 'dispatch', 'start'], cwd)
      if (result.code !== 0) {
        return { success: false, error: result.stderr || 'Failed to start dispatch' }
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Stop agent dispatch
  ipcMain.handle('kspec:dispatch-stop', async (_event, cwd: string) => {
    try {
      const result = await spawnCommand('kspec', ['agent', 'dispatch', 'stop'], cwd)
      if (result.code !== 0) {
        return { success: false, error: result.stderr || 'Failed to stop dispatch' }
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Check agent dispatch status
  ipcMain.handle('kspec:dispatch-status', async (_event, cwd: string) => {
    try {
      const result = await spawnCommand('kspec', ['agent', 'dispatch', 'status', '--json'], cwd)
      if (result.code !== 0) {
        return { running: false }
      }
      try {
        const data = JSON.parse(result.stdout)
        return { running: true, ...data }
      } catch {
        return { running: result.stdout.toLowerCase().includes('running') }
      }
    } catch {
      return { running: false }
    }
  })
}
