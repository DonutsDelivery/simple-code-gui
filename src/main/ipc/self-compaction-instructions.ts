/** Remove the retired self-compaction instruction block from project guidance. */

import { type AIBackend, readInstructionFile, writeInstructionFile } from './instruction-files'

const SELF_COMPACTION_START = '\n\n<!-- SELF_COMPACTION_START -->'
const SELF_COMPACTION_END = '<!-- SELF_COMPACTION_END -->\n'
const ALL_BACKENDS: AIBackend[] = [
  'claude', 'gemini', 'codex', 'opencode', 'aider', 'droid', 'hermes', 'grok',
]

/** Remove the retired block from one backend-specific instruction file. */
export function removeSelfCompactionInstructions(projectPath: string, aiBackend: AIBackend = 'claude'): boolean {
  try {
    let content = readInstructionFile(projectPath, aiBackend)
    if (!content) return true

    const startIdx = content.indexOf(SELF_COMPACTION_START)
    const endIdx = content.indexOf(SELF_COMPACTION_END)

    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + content.slice(endIdx + SELF_COMPACTION_END.length)
      content = content.trimEnd() + '\n'
      writeInstructionFile(projectPath, aiBackend, content)
    }
    return true
  } catch (e) {
    console.error('Failed to remove retired self-compaction instructions:', e)
    return false
  }
}

/** Remove stale managed blocks from every backend-specific instruction surface. */
export function removeAllSelfCompactionInstructions(projectPath: string): boolean {
  return ALL_BACKENDS.every(backend => removeSelfCompactionInstructions(projectPath, backend))
}
