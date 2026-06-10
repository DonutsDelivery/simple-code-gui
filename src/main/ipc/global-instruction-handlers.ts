/**
 * Global Instruction Injection IPC Handlers
 *
 * Adds a user-defined global instruction block to instruction files
 * (CLAUDE.md, AGENTS.md, GEMINI.md, etc.) across all loaded projects.
 * Content is stored in app settings and injected/removed on demand.
 *
 * Pattern mirrors the TTS instruction injection in voice-handlers.ts.
 */

import { ipcMain } from 'electron'
import { type AIBackend, readInstructionFile, writeInstructionFile, ensureAiderConfig } from './instruction-files'

const GLOBAL_INSTRUCTION_START = '<!-- GLOBAL_INSTRUCTION_START -->'
const GLOBAL_INSTRUCTION_END = '<!-- GLOBAL_INSTRUCTION_END -->'

function wrapGlobalInstruction(content: string): string {
  return `\n\n${GLOBAL_INSTRUCTION_START}
${content.trim()}
${GLOBAL_INSTRUCTION_END}\n`
}

/**
 * Inject global instructions into a single project for a single backend.
 * Removes any existing global instruction block first, then appends the new one.
 */
function injectGlobalInstruction(projectPath: string, aiBackend: AIBackend, instructionContent: string): boolean {
  try {
    if (!instructionContent.trim()) return false

    let content = readInstructionFile(projectPath, aiBackend)

    // Remove existing global instruction block if present
    if (content.includes(GLOBAL_INSTRUCTION_START)) {
      const startIdx = content.indexOf(GLOBAL_INSTRUCTION_START)
      const endIdx = content.indexOf(GLOBAL_INSTRUCTION_END)
      if (startIdx !== -1 && endIdx !== -1) {
        content = content.substring(0, startIdx) + content.substring(endIdx + GLOBAL_INSTRUCTION_END.length)
      }
    }

    content += wrapGlobalInstruction(instructionContent)
    writeInstructionFile(projectPath, aiBackend, content)

    if (aiBackend === 'aider') {
      ensureAiderConfig(projectPath)
    }

    return true
  } catch (e) {
    console.error(`[global-instruction] Failed to inject for ${aiBackend} in ${projectPath}:`, e)
    return false
  }
}

/**
 * Remove global instructions from a single project for a single backend.
 */
function removeGlobalInstruction(projectPath: string, aiBackend: AIBackend): boolean {
  try {
    let content = readInstructionFile(projectPath, aiBackend)
    if (!content) return true

    const startIdx = content.indexOf(GLOBAL_INSTRUCTION_START)
    const endIdx = content.indexOf(GLOBAL_INSTRUCTION_END)

    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + content.slice(endIdx + GLOBAL_INSTRUCTION_END.length)
      content = content.trimEnd() + '\n'
      writeInstructionFile(projectPath, aiBackend, content)
    }
    return true
  } catch (e) {
    console.error(`[global-instruction] Failed to remove for ${aiBackend} in ${projectPath}:`, e)
    return false
  }
}

/** All AI backends that can receive global instructions */
const ALL_BACKENDS: AIBackend[] = ['claude', 'gemini', 'codex', 'opencode', 'aider', 'droid', 'hermes', 'grok']

export function registerGlobalInstructionHandlers() {
  /**
   * Inject global instructions into a specific project for specified backends.
   * Defaults to all backends if none specified.
   */
  ipcMain.handle('globalInstruction:inject', (_event, projectPath: string, instructionContent: string, aiBackends?: AIBackend[]) => {
    const backends = aiBackends && aiBackends.length > 0 ? aiBackends : ALL_BACKENDS
    const results: Record<string, boolean> = {}

    for (const backend of backends) {
      results[backend] = injectGlobalInstruction(projectPath, backend, instructionContent)
    }

    return { success: Object.values(results).some(Boolean), results }
  })

  /**
   * Remove global instructions from a specific project for specified backends.
   */
  ipcMain.handle('globalInstruction:remove', (_event, projectPath: string, aiBackends?: AIBackend[]) => {
    const backends = aiBackends && aiBackends.length > 0 ? aiBackends : ALL_BACKENDS
    const results: Record<string, boolean> = {}

    for (const backend of backends) {
      results[backend] = removeGlobalInstruction(projectPath, backend)
    }

    return { success: true, results }
  })

  /**
   * Inject global instructions into ALL projects across ALL backends.
   * Returns counts of success/failure per project.
   */
  ipcMain.handle('globalInstruction:injectAll', (_event, projects: Array<{ path: string }>, instructionContent: string, aiBackends?: AIBackend[]) => {
    if (!instructionContent.trim()) {
      return { success: false, error: 'No instruction content provided', applied: 0, failed: 0 }
    }

    const backends = aiBackends && aiBackends.length > 0 ? aiBackends : ALL_BACKENDS
    let applied = 0
    let failed = 0

    for (const project of projects) {
      for (const backend of backends) {
        if (injectGlobalInstruction(project.path, backend, instructionContent)) {
          applied++
        } else {
          failed++
        }
      }
    }

    return { success: applied > 0, applied, failed }
  })

  /**
   * Remove global instructions from ALL projects across ALL backends.
   */
  ipcMain.handle('globalInstruction:removeAll', (_event, projects: Array<{ path: string }>, aiBackends?: AIBackend[]) => {
    const backends = aiBackends && aiBackends.length > 0 ? aiBackends : ALL_BACKENDS
    let removed = 0
    let failed = 0

    for (const project of projects) {
      for (const backend of backends) {
        if (removeGlobalInstruction(project.path, backend)) {
          removed++
        } else {
          failed++
        }
      }
    }

    return { success: true, removed, failed }
  })
}
