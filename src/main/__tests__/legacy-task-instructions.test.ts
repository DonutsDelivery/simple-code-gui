import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeLegacyTaskPanelInstructions } from '../ipc/legacy-task-instructions'

const created: string[] = []

function createProject(): string {
  const projectPath = mkdtempSync(join(tmpdir(), 'donutcode-task-cleanup-'))
  created.push(projectPath)
  return projectPath
}

const legacyPanelBlock = `<!-- TASK_MANAGEMENT_START -->
## Task Management

### CLI Commands (beads)
- \`bd ready\` — Show tasks ready to work on

### Workflow
1. Check the task panel in the GUI sidebar
<!-- TASK_MANAGEMENT_END -->`

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('removeLegacyTaskPanelInstructions', () => {
  it('removes only instruction blocks written by the retired task panel', () => {
    const projectPath = createProject()
    mkdirSync(join(projectPath, '.claude'))
    const instructionPath = join(projectPath, '.claude', 'CLAUDE.md')
    writeFileSync(instructionPath, `# Project\n\n${legacyPanelBlock}\n\n## Local rules\nKeep this.\n`)

    expect(removeLegacyTaskPanelInstructions(projectPath)).toBe(1)
    expect(readFileSync(instructionPath, 'utf8')).toBe('# Project\n\n## Local rules\nKeep this.\n')
    expect(removeLegacyTaskPanelInstructions(projectPath)).toBe(0)
  })

  it('preserves repository-owned task-management sections', () => {
    const projectPath = createProject()
    const instructionPath = join(projectPath, 'AGENTS.md')
    const repositorySection = `<!-- TASK_MANAGEMENT_START -->
## Task Management

@kspec-agents.md
<!-- TASK_MANAGEMENT_END -->
`
    writeFileSync(instructionPath, repositorySection)

    expect(removeLegacyTaskPanelInstructions(projectPath)).toBe(0)
    expect(readFileSync(instructionPath, 'utf8')).toBe(repositorySection)
  })
})
