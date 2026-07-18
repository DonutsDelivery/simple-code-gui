import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getInstructionFilePath,
  type AIBackend,
} from '../ipc/instruction-files'
import { installAgentSessionSignalInstructions } from '../ipc/agent-session-signal-instructions'

const BACKENDS: AIBackend[] = [
  'claude',
  'gemini',
  'codex',
  'opencode',
  'aider',
  'droid',
  'hermes',
  'grok',
]

const projects: string[] = []

afterEach(() => {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true })
  }
})

describe('agent session signal instructions', () => {
  // AC: @agent-session-notifications ac-5
  it.each(BACKENDS)('installs idempotent managed guidance for %s without changing user content', (backend) => {
    const project = mkdtempSync(join(tmpdir(), `agent-signal-${backend}-`))
    projects.push(project)
    const instructionPath = getInstructionFilePath(project, backend)
    const userContent = '# User instructions\n\nKeep this text byte-for-byte.\n'
    writeFileSync(instructionPath, userContent)

    expect(installAgentSessionSignalInstructions(project, backend)).toBe(true)
    const firstInstall = readFileSync(instructionPath, 'utf8')
    const firstMtime = statSync(instructionPath, { bigint: true }).mtimeNs
    expect(installAgentSessionSignalInstructions(project, backend)).toBe(true)
    const secondInstall = readFileSync(instructionPath, 'utf8')

    expect(secondInstall).toBe(firstInstall)
    expect(statSync(instructionPath, { bigint: true }).mtimeNs).toBe(firstMtime)
    expect(secondInstall.startsWith(userContent)).toBe(true)
    expect(secondInstall.match(/<!-- AGENT_SESSION_SIGNALS_START -->/g)).toHaveLength(1)
    expect(secondInstall.match(/<!-- AGENT_SESSION_SIGNALS_END -->/g)).toHaveLength(1)
    expect(secondInstall).toContain('<claude-terminal-signal type="complete" />')
    expect(secondInstall).toContain('<claude-terminal-signal type="input-needed" />')
  })

  // AC: @agent-session-notifications ac-5
  it('replaces managed guidance without joining surrounding user content', () => {
    const project = mkdtempSync(join(tmpdir(), 'agent-signal-replace-'))
    projects.push(project)
    const instructionPath = getInstructionFilePath(project, 'claude')
    writeFileSync(instructionPath,
      'Before\n\n<!-- AGENT_SESSION_SIGNALS_START -->\nold\n<!-- AGENT_SESSION_SIGNALS_END -->\nAfter\n')

    expect(installAgentSessionSignalInstructions(project, 'claude')).toBe(true)

    const content = readFileSync(instructionPath, 'utf8')
    expect(content.startsWith('Before\n\n<!-- AGENT_SESSION_SIGNALS_START -->')).toBe(true)
    expect(content.endsWith('<!-- AGENT_SESSION_SIGNALS_END -->\nAfter\n')).toBe(true)
    expect(content).not.toContain('\nold\n')
  })
})
