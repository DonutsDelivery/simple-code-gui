import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const TASK_INSTRUCTIONS_START = '<!-- TASK_MANAGEMENT_START -->'
const TASK_INSTRUCTIONS_END = '<!-- TASK_MANAGEMENT_END -->'
const LEGACY_TASK_PANEL_SIGNATURE = '### CLI Commands (beads)'

const INSTRUCTION_FILES = [
  '.claude/CLAUDE.md',
  'GEMINI.md',
  'AGENTS.md',
  'CONVENTIONS.md',
  'HERMES.md',
] as const

function removeManagedSection(content: string): string | null {
  const startIndex = content.indexOf(TASK_INSTRUCTIONS_START)
  const endIndex = content.indexOf(TASK_INSTRUCTIONS_END, Math.max(0, startIndex))
  if (startIndex === -1 || endIndex === -1) return null

  const sectionEnd = endIndex + TASK_INSTRUCTIONS_END.length
  const section = content.slice(startIndex, sectionEnd)
  if (!section.includes(LEGACY_TASK_PANEL_SIGNATURE)) return null

  const before = content.slice(0, startIndex).trimEnd()
  const after = content.slice(sectionEnd).trimStart()
  if (before && after) return `${before}\n\n${after}`
  if (before) return `${before}\n`
  if (after) return after
  return ''
}

/**
 * Removes instruction blocks written by the retired in-app task panel. Sections
 * without the panel signature are user/repository-owned and remain untouched.
 */
export function removeLegacyTaskPanelInstructions(projectPath: string): number {
  let removed = 0

  for (const relativePath of INSTRUCTION_FILES) {
    const filePath = join(projectPath, relativePath)
    if (!existsSync(filePath)) continue

    const content = readFileSync(filePath, 'utf8')
    const updated = removeManagedSection(content)
    if (updated === null || updated === content) continue

    writeFileSync(filePath, updated)
    removed += 1
  }

  return removed
}
