import { getAgentSessionSignalKey } from '../agent-session-signal-protocol'
import {
  ensureAiderConfig,
  readInstructionFile,
  type AIBackend,
  writeInstructionFile,
} from './instruction-files'

const AGENT_SESSION_SIGNALS_START = '<!-- AGENT_SESSION_SIGNALS_START -->'
const AGENT_SESSION_SIGNALS_END = '<!-- AGENT_SESSION_SIGNALS_END -->'

function getAgentSessionSignalInstructions(projectPath: string): string {
  const key = getAgentSessionSignalKey(projectPath)
  const splitIndex = Math.floor(key.length / 2)
  const firstKeyHalf = key.slice(0, splitIndex)
  const secondKeyHalf = key.slice(splitIndex)

  return `${AGENT_SESSION_SIGNALS_START}
## Agent Session Signals (DonutCode)

Signals are final-response metadata. Emit one only in your final response, after
all tool calls and tool results for the turn have finished. Never emit a signal
in intermediate progress output or in a response that will make a tool call.
Never use a tool or shell command to emit a signal. Do not quote or reproduce a
signal in a code block.

Build the signal key by joining these two parts without spaces:

Signal key first half: \`${firstKeyHalf}\`
Signal key second half: \`${secondKeyHalf}\`

Use this exact template on its own line, replacing {KEY} with the joined key and
{CODE} with c for complete or i for input-needed:

<ct-signal k="{KEY}" t="{CODE}" />

Use complete only when the requested work is finished. Put the complete signal
at the end of the final response. Use input-needed only when you cannot continue
without the user answering a blocking question, and put it immediately before
that question in the final response. Do not use input-needed for optional
follow-up questions. Emit only one signal for a given state.

These managed instructions are read by DonutCode. Keep all surrounding
user-authored instructions unchanged.
${AGENT_SESSION_SIGNALS_END}
`
}

export function installAgentSessionSignalInstructions(
  projectPath: string,
  aiBackend: AIBackend = 'claude',
): boolean {
  try {
    const managedInstructions = getAgentSessionSignalInstructions(projectPath)
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
        + managedInstructions
        + originalContent.slice(endExclusive)
    } else {
      const separator = originalContent.length === 0 ? '' : '\n\n'
      nextContent = originalContent + separator + managedInstructions
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
