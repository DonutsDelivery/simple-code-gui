/**
 * Backend instruction file mapping.
 *
 * Each AI backend reads project-level instructions from a specific file.
 * This module provides a unified way to resolve the correct file for any backend.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type AIBackend = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok'

interface InstructionFileConfig {
  /** Subdirectory under project root (null = project root) */
  dir: string | null
  /** Filename */
  file: string
}

/**
 * Maps each backend to its instruction file location.
 *
 * - claude:   .claude/CLAUDE.md  (auto-discovered by Claude Code)
 * - gemini:   GEMINI.md          (auto-discovered by Gemini CLI)
 * - codex:    AGENTS.md          (auto-discovered by Codex CLI)
 * - opencode: AGENTS.md          (primary; CLAUDE.md is fallback if AGENTS.md missing)
 * - aider:    CONVENTIONS.md     (needs `read: CONVENTIONS.md` in .aider.conf.yml)
 * - droid:    AGENTS.md          (auto-discovered by Factory Droid, same as Codex)
 * - hermes:   HERMES.md          (auto-discovered by Hermes Agent)
 * - grok:     AGENTS.md          (auto-discovered by Grok Build)
 */
const BACKEND_INSTRUCTION_FILES: Record<AIBackend, InstructionFileConfig> = {
  claude:   { dir: '.claude', file: 'CLAUDE.md' },
  gemini:   { dir: null, file: 'GEMINI.md' },
  codex:    { dir: null, file: 'AGENTS.md' },
  opencode: { dir: null, file: 'AGENTS.md' },
  aider:    { dir: null, file: 'CONVENTIONS.md' },
  droid:    { dir: null, file: 'AGENTS.md' },
  hermes:   { dir: null, file: 'HERMES.md' },
  grok:     { dir: null, file: 'AGENTS.md' },
}

/** Human-readable label for the instruction file (used in UI) */
const BACKEND_FILE_LABELS: Record<AIBackend, string> = {
  claude:   'CLAUDE.md',
  gemini:   'GEMINI.md',
  codex:    'AGENTS.md',
  opencode: 'AGENTS.md',
  aider:    'CONVENTIONS.md',
  droid:    'AGENTS.md',
  hermes:   'HERMES.md',
  grok:     'AGENTS.md',
}

/**
 * Returns the absolute path to the instruction file for a given backend.
 * Ensures the parent directory exists.
 */
export function getInstructionFilePath(projectPath: string, backend: AIBackend): string {
  const config = BACKEND_INSTRUCTION_FILES[backend]
  if (config.dir) {
    const dir = join(projectPath, config.dir)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    return join(dir, config.file)
  }
  return join(projectPath, config.file)
}

/**
 * Returns the relative path shown to the user (e.g. ".claude/CLAUDE.md", "GEMINI.md").
 */
export function getInstructionFileRelativePath(backend: AIBackend): string {
  const config = BACKEND_INSTRUCTION_FILES[backend]
  return config.dir ? `${config.dir}/${config.file}` : config.file
}

/**
 * Returns a human-readable label for the instruction file.
 */
export function getInstructionFileLabel(backend: AIBackend): string {
  return BACKEND_FILE_LABELS[backend]
}

/**
 * Reads the instruction file content for a backend. Returns empty string if not found.
 */
export function readInstructionFile(projectPath: string, backend: AIBackend): string {
  const filePath = getInstructionFilePath(projectPath, backend)
  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf8')
  }
  return ''
}

/**
 * Writes content to the instruction file for a backend.
 */
export function writeInstructionFile(projectPath: string, backend: AIBackend, content: string): void {
  const filePath = getInstructionFilePath(projectPath, backend)
  writeFileSync(filePath, content)
}

/**
 * For aider, ensure .aider.conf.yml includes `read: CONVENTIONS.md` so the file is
 * automatically loaded. This is a no-op for other backends.
 */
export function ensureAiderConfig(projectPath: string): void {
  const confPath = join(projectPath, '.aider.conf.yml')
  const conventionsEntry = 'CONVENTIONS.md'

  if (existsSync(confPath)) {
    const content = readFileSync(confPath, 'utf8')
    // Check if read directive already includes CONVENTIONS.md
    if (content.includes(conventionsEntry)) return

    // Append read directive
    const addition = content.endsWith('\n') ? '' : '\n'
    writeFileSync(confPath, content + addition + `read: ${conventionsEntry}\n`)
  } else {
    // Create minimal config with read directive
    writeFileSync(confPath, `read: ${conventionsEntry}\n`)
  }
}
