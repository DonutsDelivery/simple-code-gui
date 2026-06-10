import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { addToOpenCodeMcpConfig } from './extension-manager/validation.js'

const SERVER_NAME = 'orchestrator'

function execFileQuiet(command: string, args: string[], callback: (err: NodeJS.ErrnoException | null, stdout: string) => void): void {
  execFile(command, args, (err, stdout) => callback(err, stdout))
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeJson(path: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2))
}

function registerClaude(orchestratorScript: string): void {
  execFileQuiet('claude', ['mcp', 'list'], (err, stdout) => {
    if (err || stdout.includes(SERVER_NAME)) return

    execFileQuiet('claude', ['mcp', 'add', '--scope', 'user', SERVER_NAME, '--', 'node', orchestratorScript], (addErr) => {
      if (!addErr) console.log('[Startup] Registered orchestrator MCP server with Claude')
      else console.warn('[Startup] Could not register orchestrator MCP with Claude:', addErr.message)
    })
  })
}

function registerCodex(orchestratorScript: string): void {
  execFileQuiet('codex', ['mcp', 'list'], (err, stdout) => {
    if (err || stdout.includes(SERVER_NAME)) return

    execFileQuiet('codex', ['mcp', 'add', SERVER_NAME, '--', 'node', orchestratorScript], (addErr) => {
      if (!addErr) console.log('[Startup] Registered orchestrator MCP server with Codex')
      else console.warn('[Startup] Could not register orchestrator MCP with Codex:', addErr.message)
    })
  })
}

function registerHermes(orchestratorScript: string): void {
  execFileQuiet('hermes', ['mcp', 'list'], (err, stdout) => {
    if (err || stdout.includes(SERVER_NAME)) return

    // `hermes mcp add` is interactive: after probing the server it prompts
    // "Enable all N tools? [Y/n/select]". Without a TTY it cancels, so feed "Y"
    // on stdin to accept all tools and persist the server to ~/.hermes/config.yaml.
    const child = execFile('hermes', ['mcp', 'add', SERVER_NAME, '--command', 'node', '--args', orchestratorScript], (addErr) => {
      if (!addErr) console.log('[Startup] Registered orchestrator MCP server with Hermes')
      else console.warn('[Startup] Could not register orchestrator MCP with Hermes:', addErr.message)
    })
    child.stdin?.end('Y\n')
  })
}

function registerGemini(orchestratorScript: string): void {
  try {
    const settingsPath = join(homedir(), '.gemini', 'settings.json')
    const settings = readJson(settingsPath)
    const mcpServers = (settings.mcpServers || {}) as Record<string, unknown>

    mcpServers[SERVER_NAME] = {
      command: 'node',
      args: [orchestratorScript],
    }
    settings.mcpServers = mcpServers
    writeJson(settingsPath, settings)
    console.log('[Startup] Registered orchestrator MCP server with Gemini')
  } catch (e) {
    console.warn('[Startup] Could not register orchestrator MCP with Gemini:', e instanceof Error ? e.message : e)
  }
}

function registerOpenCode(orchestratorScript: string): void {
  try {
    addToOpenCodeMcpConfig(SERVER_NAME, 'node', [orchestratorScript])
    console.log('[Startup] Registered orchestrator MCP server with OpenCode')
  } catch (e) {
    console.warn('[Startup] Could not register orchestrator MCP with OpenCode:', e instanceof Error ? e.message : e)
  }
}

export function registerOrchestratorMcp(orchestratorScript: string): void {
  registerClaude(orchestratorScript)
  registerCodex(orchestratorScript)
  registerHermes(orchestratorScript)
  registerGemini(orchestratorScript)
  registerOpenCode(orchestratorScript)
}
