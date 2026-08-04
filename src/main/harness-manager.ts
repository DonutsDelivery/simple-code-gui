import { spawn } from 'child_process'
import * as path from 'path'
import {
  getPortableBinDirs,
  getPortableNpmPath,
  getPortablePipPath,
  installPortableNode,
  installPortablePython,
} from './portable-deps.js'
import { getAdditionalPaths } from './platform.js'

export type HarnessId =
  | 'claude'
  | 'gemini'
  | 'codex'
  | 'opencode'
  | 'aider'
  | 'droid'
  | 'hermes'
  | 'grok'
  | 'claude-codex'

type InstallMethod = 'npm' | 'pip' | 'external'

export interface HarnessInstallSpec {
  id: HarnessId
  label: string
  commands: string[]
  method: InstallMethod
  packageName?: string
  instructions?: string
}

export const HARNESS_INSTALL_SPECS: Readonly<Record<HarnessId, HarnessInstallSpec>> = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    commands: ['claude'],
    method: 'npm',
    packageName: '@anthropic-ai/claude-code',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    commands: ['gemini'],
    method: 'npm',
    packageName: '@google/gemini-cli',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    commands: ['codex'],
    method: 'npm',
    packageName: '@openai/codex',
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    commands: ['opencode'],
    method: 'npm',
    packageName: 'opencode-ai',
  },
  aider: {
    id: 'aider',
    label: 'Aider',
    commands: ['aider'],
    method: 'pip',
    packageName: 'aider-chat',
  },
  droid: {
    id: 'droid',
    label: 'Droid',
    commands: ['droid'],
    method: 'external',
    instructions: 'Install Droid from https://docs.factory.ai/cli/getting-started/overview, then restart the server.',
  },
  hermes: {
    id: 'hermes',
    label: 'Hermes',
    commands: ['hermes'],
    method: 'external',
    instructions: 'Install Hermes with the official installer: curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
  },
  grok: {
    id: 'grok',
    label: 'Grok Build',
    commands: ['grok', 'agent'],
    method: 'external',
    instructions: 'Install Grok Build so either `grok` or `agent` is available on the server PATH.',
  },
  'claude-codex': {
    id: 'claude-codex',
    label: 'Claude-Codex',
    commands: ['claude-codex'],
    method: 'external',
    instructions: 'Install Claude-Codex using its official distribution, then ensure `claude-codex` is available on the server PATH.',
  },
}

export interface HarnessStatus {
  harnessId: HarnessId
  installed: boolean
  command: string
  version?: string
  method: InstallMethod
}

export interface HarnessInstallProgress {
  harnessId: HarnessId
  status: string
  percent?: number
}

export interface HarnessInstallResult {
  success: boolean
  harnessId: HarnessId
  status: HarnessStatus
  error?: string
  instructions?: string
  needsNode?: boolean
  needsPython?: boolean
}

export interface HarnessCommandOutput {
  stdout: string
  stderr: string
}

export interface HarnessCommandOptions {
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

export type HarnessCommandRunner = (
  command: string,
  args: string[],
  options: HarnessCommandOptions,
) => Promise<HarnessCommandOutput>

export interface HarnessManagerOptions {
  commandRunner?: HarnessCommandRunner
  commandTimeoutMs?: number
  npmPathProvider?: () => string | null
  pipPathProvider?: () => string | null
  binDirsProvider?: () => string[]
  additionalPathsProvider?: () => string[]
}

function defaultCommandRunner(
  command: string,
  args: string[],
  options: HarnessCommandOptions,
): Promise<HarnessCommandOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }

    const timeout = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error(`${command} ${args.join(' ')} timed out after ${options.timeoutMs}ms`)))
    }, options.timeoutMs)

    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('error', error => finish(() => reject(error)))
    child.once('close', code => {
      finish(() => {
        if (code === 0) {
          resolve({ stdout, stderr })
        } else {
          const detail = stderr.trim() || stdout.trim() || `exit code ${code ?? 'unknown'}`
          reject(new Error(`${command} failed: ${detail}`))
        }
      })
    })
  })
}

function firstOutputLine(output: HarnessCommandOutput): string | undefined {
  return `${output.stdout}\n${output.stderr}`
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean)
}

export class HarnessManager {
  private readonly runCommand: HarnessCommandRunner
  private readonly timeoutMs: number
  private readonly getNpmPath: () => string | null
  private readonly getPipPath: () => string | null
  private readonly getBinDirs: () => string[]
  private readonly getAdditionalPathEntries: () => string[]

  constructor(options: HarnessManagerOptions = {}) {
    this.runCommand = options.commandRunner ?? defaultCommandRunner
    this.timeoutMs = options.commandTimeoutMs ?? 10000
    this.getNpmPath = options.npmPathProvider ?? getPortableNpmPath
    this.getPipPath = options.pipPathProvider ?? getPortablePipPath
    this.getBinDirs = options.binDirsProvider ?? getPortableBinDirs
    this.getAdditionalPathEntries = options.additionalPathsProvider ?? getAdditionalPaths
  }

  async getStatus(harnessId: HarnessId): Promise<HarnessStatus> {
    const spec = HARNESS_INSTALL_SPECS[harnessId]
    if (!spec) throw new Error(`Unknown harness: ${harnessId}`)

    for (const command of spec.commands) {
      try {
        const output = await this.runCommand(command, ['--version'], this.commandOptions())
        return {
          harnessId,
          installed: true,
          command,
          version: firstOutputLine(output),
          method: spec.method,
        }
      } catch {
        // Try the next command alias, such as Grok's `agent` command.
      }
    }

    return {
      harnessId,
      installed: false,
      command: spec.commands[0],
      method: spec.method,
    }
  }

  async getAllStatuses(): Promise<HarnessStatus[]> {
    return Promise.all(Object.keys(HARNESS_INSTALL_SPECS).map(harnessId => this.getStatus(harnessId as HarnessId)))
  }

  async install(
    harnessId: HarnessId,
    onProgress?: (progress: HarnessInstallProgress) => void,
  ): Promise<HarnessInstallResult> {
    const spec = HARNESS_INSTALL_SPECS[harnessId]
    if (!spec) throw new Error(`Unknown harness: ${harnessId}`)

    const progress = (status: string, percent?: number): void => onProgress?.({ harnessId, status, percent })
    const currentStatus = await this.getStatus(harnessId)

    if (currentStatus.installed) {
      return { success: true, harnessId, status: currentStatus }
    }

    if (spec.method === 'external') {
      return {
        success: false,
        harnessId,
        status: currentStatus,
        instructions: spec.instructions,
        error: `${spec.label} must be installed outside DonutCode Server.`,
      }
    }

    const command = spec.method === 'npm'
      ? await this.findWorkingCommand([this.getNpmPath() ?? 'npm'])
      : await this.findWorkingCommand([this.getPipPath() ?? '', 'pip3', 'pip'])

    if (!command) {
      return {
        success: false,
        harnessId,
        status: currentStatus,
        ...(spec.method === 'npm' ? { needsNode: true } : { needsPython: true }),
        error: spec.method === 'npm'
          ? 'npm is not available on this server. Install Node.js first.'
          : 'pip is not available on this server. Install Python first.',
      }
    }

    progress(`Installing ${spec.label}...`, 10)
    try {
      await this.runCommand(
        command,
        spec.method === 'npm'
          ? ['install', '--global', spec.packageName!]
          : ['install', spec.packageName!],
        { ...this.commandOptions(), timeoutMs: 300000 },
      )
      progress('Verifying installation...', 90)
      const installed = await this.getStatus(harnessId)
      progress(installed.installed ? 'Installed' : 'Installation could not be verified', 100)
      return {
        success: installed.installed,
        harnessId,
        status: installed,
        error: installed.installed ? undefined : `Installation completed but ${spec.commands[0]} was not found on PATH.`,
      }
    } catch (error) {
      return {
        success: false,
        harnessId,
        status: currentStatus,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  installNode(onProgress?: (status: string, percent?: number) => void): Promise<{ success: boolean; error?: string }> {
    return installPortableNode(onProgress)
  }

  installPython(onProgress?: (status: string, percent?: number) => void): Promise<{ success: boolean; error?: string }> {
    return installPortablePython(onProgress)
  }

  private commandOptions(): HarnessCommandOptions {
    const pathEntries = [
      ...this.getBinDirs(),
      ...this.getAdditionalPathEntries(),
      process.env.PATH,
    ].filter(Boolean)
    return {
      env: { ...process.env, PATH: pathEntries.join(path.delimiter) },
      timeoutMs: this.timeoutMs,
    }
  }

  private async findWorkingCommand(commands: string[]): Promise<string | null> {
    for (const command of commands.filter(Boolean)) {
      try {
        await this.runCommand(command, ['--version'], this.commandOptions())
        return command
      } catch {
        // Try the next command alias or system fallback.
      }
    }
    return null
  }
}
