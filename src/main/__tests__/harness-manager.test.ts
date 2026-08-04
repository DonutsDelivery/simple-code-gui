import { describe, expect, it, vi } from 'vitest'
import {
  HarnessManager,
  type HarnessCommandRunner,
} from '../harness-manager'

function createManager(commandRunner: HarnessCommandRunner): HarnessManager {
  return new HarnessManager({
    commandRunner,
    npmPathProvider: () => null,
    pipPathProvider: () => null,
    binDirsProvider: () => [],
    additionalPathsProvider: () => [],
  })
}

describe('HarnessManager', () => {
  it('reports an installed harness and its version without using a shell', async () => {
    const runner: HarnessCommandRunner = vi.fn(async (command, args) => {
      expect(command).toBe('gemini')
      expect(args).toEqual(['--version'])
      return { stdout: 'gemini 1.2.3\n', stderr: '' }
    })
    const manager = createManager(runner)

    await expect(manager.getStatus('gemini')).resolves.toEqual({
      harnessId: 'gemini',
      installed: true,
      command: 'gemini',
      version: 'gemini 1.2.3',
      method: 'npm',
    })
  })

  it('installs an npm harness and verifies the resulting command', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    let installed = false
    const runner: HarnessCommandRunner = vi.fn(async (command, args) => {
      calls.push({ command, args })
      if (command === 'npm' && args[0] === '--version') return { stdout: '11.0.0', stderr: '' }
      if (command === 'npm' && args[0] === 'install') {
        installed = true
        return { stdout: '', stderr: '' }
      }
      if (command === 'codex' && args[0] === '--version') {
        if (installed) return { stdout: 'codex 1.0.0', stderr: '' }
        throw new Error('not installed')
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
    })
    const progress: string[] = []
    const manager = createManager(runner)

    const result = await manager.install('codex', event => progress.push(event.status))

    expect(result).toMatchObject({
      success: true,
      harnessId: 'codex',
      status: { installed: true, version: 'codex 1.0.0' },
    })
    expect(calls).toContainEqual({ command: 'npm', args: ['install', '--global', '@openai/codex'] })
    expect(progress).toEqual(['Installing Codex...', 'Verifying installation...', 'Installed'])
  })

  it('reports the missing npm prerequisite instead of attempting a shell install', async () => {
    const runner: HarnessCommandRunner = vi.fn(async () => {
      throw new Error('command not found')
    })
    const manager = createManager(runner)

    await expect(manager.install('opencode')).resolves.toMatchObject({
      success: false,
      harnessId: 'opencode',
      needsNode: true,
    })
  })

  it('returns external setup instructions for native harnesses', async () => {
    const runner: HarnessCommandRunner = vi.fn(async () => {
      throw new Error('command not found')
    })
    const manager = createManager(runner)

    await expect(manager.install('droid')).resolves.toMatchObject({
      success: false,
      harnessId: 'droid',
      instructions: expect.stringContaining('factory.ai'),
    })
  })
})
