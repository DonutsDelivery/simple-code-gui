import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { getInstructionFilePath, type AIBackend } from '../ipc/instruction-files'
import { removeAllSelfCompactionInstructions } from '../ipc/self-compaction-instructions'

const BACKENDS: AIBackend[] = [
  'claude', 'gemini', 'codex', 'opencode', 'aider', 'droid', 'hermes', 'grok',
]
const projects: string[] = []
const retiredBlock = `

<!-- SELF_COMPACTION_START -->
## Self-Compaction (Claude Terminal)
Call the orchestrator MCP tool \`compact_session\`.
<!-- SELF_COMPACTION_END -->
`

afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true })
})

describe('retired self-compaction guidance', () => {
  it('removes the managed block from every backend instruction surface', () => {
    const project = mkdtempSync(join(tmpdir(), 'retired-self-compaction-'))
    projects.push(project)
    const paths = new Set(BACKENDS.map(backend => getInstructionFilePath(project, backend)))

    for (const path of paths) writeFileSync(path, `# User instructions\n\nKeep me.\n${retiredBlock}`)

    expect(removeAllSelfCompactionInstructions(project)).toBe(true)
    expect(removeAllSelfCompactionInstructions(project)).toBe(true)

    for (const path of paths) {
      const content = readFileSync(path, 'utf8')
      expect(content).toBe('# User instructions\n\nKeep me.\n')
      expect(content).not.toContain('SELF_COMPACTION')
      expect(content).not.toContain('compact_session')
    }
  })
})
