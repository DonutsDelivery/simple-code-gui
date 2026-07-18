import {
  ensureAiderConfig,
  readInstructionFile,
  type AIBackend,
  writeInstructionFile,
} from './instruction-files'

const AGENT_SESSION_SIGNALS_START = '<!-- AGENT_SESSION_SIGNALS_START -->'
const AGENT_SESSION_SIGNALS_END = '<!-- AGENT_SESSION_SIGNALS_END -->'

const AGENT_SESSION_SIGNAL_INSTRUCTIONS = `${AGENT_SESSION_SIGNALS_START}
## Agent Session Signals (Claude Terminal)

When you finish the work the user requested, emit this exact tag on its own line:

<claude-terminal-signal type="complete" />

When you cannot continue without the user answering a question, emit this exact
tag on its own line immediately before asking the blocking question:

<claude-terminal-signal type="input-needed" />

Emit only one signal for a given state. Do not repeat it in a code block or quote,
and do not emit the input-needed signal for optional follow-up questions. These
managed tags are read by Claude Terminal; keep all surrounding user-authored
instructions unchanged.
${AGENT_SESSION_SIGNALS_END}
`

export function installAgentSessionSignalInstructions(
  projectPath: string,
  aiBackend: AIBackend = 'claude',
): boolean {
  try {
    const originalContent = readInstructionFile(projectPath, aiBackend)
    let nextContent: string
    const startIndex = originalContent.indexOf(AGENT_SESSION_SIGNALS_START)
    const endIndex = startIndex === -1
      ? -1
      : originalContent.indexOf(AGENT_SESSION_SIGNALS_END, startIndex)

    if (startIndex !== -1 && endIndex !== -1) {
      let endExclusive = endIndex + AGENT_SESSION_SIGNALS_END.length
      if (originalContent.slice(endExclusive, endExclusive + 2) === '\r\n') {
        endExclusive += 2
      } else if (originalContent[endExclusive] === '\n') {
        endExclusive += 1
      }
      nextContent = originalContent.slice(0, startIndex)
        + AGENT_SESSION_SIGNAL_INSTRUCTIONS
        + originalContent.slice(endExclusive)
    } else {
      const separator = originalContent.length === 0 ? '' : '\n\n'
      nextContent = originalContent + separator + AGENT_SESSION_SIGNAL_INSTRUCTIONS
    }

    if (nextContent !== originalContent) {
      writeInstructionFile(projectPath, aiBackend, nextContent)
    }
    if (aiBackend === 'aider') ensureAiderConfig(projectPath)
    return true
  } catch (error) {
    console.error('Failed to install agent session signal instructions:', error)
    return false
  }
}
