import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getInstructionFilePath,
  type AIBackend,
} from '../ipc/instruction-files'
import { AgentSessionSignalDetector } from '../agent-session-signal-detector'
import { formatAgentSessionSignal } from '../agent-session-signal-protocol'
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
    expect(secondInstall).toContain('only in your final response')
    expect(secondInstall).toContain('Never use a tool or shell command to emit a signal')
    expect(secondInstall).toContain('Signal key first half:')
    expect(secondInstall).toContain('Signal key second half:')
    expect(secondInstall).toContain('<ct-signal k="{KEY}" t="{CODE}" />')
    expect(secondInstall).not.toContain(formatAgentSessionSignal(project, 'complete'))
    expect(secondInstall).not.toContain(formatAgentSessionSignal(project, 'input-needed'))
  })

  // AC: @agent-session-notifications ac-7
  it('does not turn a copied managed instruction block into a signal', () => {
    const project = mkdtempSync(join(tmpdir(), 'agent-signal-replay-'))
    projects.push(project)
    const instructionPath = getInstructionFilePath(project, 'claude')
    expect(installAgentSessionSignalInstructions(project, 'claude')).toBe(true)

    const detector = new AgentSessionSignalDetector(project)
    expect(detector.push(readFileSync(instructionPath, 'utf8'))).toEqual([])
    expect(detector.push(`\n${formatAgentSessionSignal(project, 'complete')}\n`)).toEqual(['complete'])
  })

  // AC: @agent-session-notifications ac-5
  it('replaces managed guidance without joining surrounding user content', () => {
    const project = mkdtempSync(join(tmpdir(), 'agent-signal-replace-'))
    projects.push(project)
    const instructionPath = getInstructionFilePath(project, 'claude')
    writeFileSync(instructionPath,
      'Before\n\n<!-- AGENT_SESSION_SIGNALS_START -->\n<claude-terminal-signal type="complete" />\n<!-- AGENT_SESSION_SIGNALS_END -->\nAfter\n')

    expect(installAgentSessionSignalInstructions(project, 'claude')).toBe(true)

    const content = readFileSync(instructionPath, 'utf8')
    expect(content.startsWith('Before\n\n<!-- AGENT_SESSION_SIGNALS_START -->')).toBe(true)
    expect(content.endsWith('<!-- AGENT_SESSION_SIGNALS_END -->\nAfter\n')).toBe(true)
    expect(content).not.toContain('<claude-terminal-signal type="complete" />')
  })
})
