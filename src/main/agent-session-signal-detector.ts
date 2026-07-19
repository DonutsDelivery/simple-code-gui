import type { AgentSessionSignalType } from '../common/agent-session-signal'

const SIGNAL_LINES = new Map<string, AgentSessionSignalType>([
  ['<claude-terminal-signal type="complete" />', 'complete'],
  ['<claude-terminal-signal type="input-needed" />', 'input-needed'],
])
const MAX_PENDING_LINE = 2048

type AnsiState = 'text' | 'escape' | 'escape-intermediate' | 'csi' | 'string' | 'string-escape'

/**
 * Incrementally finds managed session signal lines in raw PTY output.
 * ANSI control strings are discarded by a state machine so both escape
 * sequences and signal lines may span arbitrary node-pty chunks.
 */
export class AgentSessionSignalDetector {
  private ansiState: AnsiState = 'text'
  private csiParameters = ''
  private textColumn = 1
  private pendingLine = ''
  private lineOverflowed = false
  private signalEmittedSinceUserInput = false
  private detectedSignals: AgentSessionSignalType[] = []

  push(chunk: string): AgentSessionSignalType[] {
    this.detectedSignals = []
    if (this.signalEmittedSinceUserInput) return this.detectedSignals

    for (const char of chunk) {
      this.consumeCharacter(char)
      if (this.signalEmittedSinceUserInput) break
    }
    return this.detectedSignals
  }

  resetForUserInput(): void {
    this.ansiState = 'text'
    this.csiParameters = ''
    this.textColumn = 1
    this.pendingLine = ''
    this.lineOverflowed = false
    this.signalEmittedSinceUserInput = false
    this.detectedSignals = []
  }

  private consumeCharacter(char: string): void {
    switch (this.ansiState) {
      case 'text':
        if (char === '\x1b') this.ansiState = 'escape'
        else this.consumeTextCharacter(char)
        return
      case 'escape':
        if (char === '[') {
          this.csiParameters = ''
          this.ansiState = 'csi'
        } else if (char === ']' || char === 'P' || char === '^' || char === '_') this.ansiState = 'string'
        else if (char >= ' ' && char <= '/') this.ansiState = 'escape-intermediate'
        else this.ansiState = 'text'
        return
      case 'escape-intermediate':
        if (char < ' ' || char > '/') this.ansiState = 'text'
        return
      case 'csi':
        if (char >= '@' && char <= '~') {
          this.finishCsi(char)
          this.ansiState = 'text'
        } else {
          this.csiParameters += char
        }
        return
      case 'string':
        if (char === '\x07') this.ansiState = 'text'
        else if (char === '\x1b') this.ansiState = 'string-escape'
        return
      case 'string-escape':
        if (char === '\\') this.ansiState = 'text'
        else if (char !== '\x1b') this.ansiState = 'string'
        return
    }
  }

  private finishCsi(finalCharacter: string): void {
    if (finalCharacter === 'm') return
    if (finalCharacter === 'K' || finalCharacter === 'J') {
      const eraseMode = Number.parseInt(this.csiParameters.split(';').at(-1) || '0', 10)
      if (eraseMode === 1 || eraseMode === 2 || eraseMode === 3) {
        this.pendingLine = ''
        this.lineOverflowed = false
      }
      return
    }
    if (finalCharacter === 'G') {
      const targetColumn = Number.parseInt(this.csiParameters.split(';').at(-1) || '1', 10)
      if (Number.isFinite(targetColumn) && targetColumn > this.textColumn) {
        for (let column = this.textColumn; column < targetColumn; column += 1) {
          this.consumeTextCharacter(' ')
        }
      }
      this.textColumn = Number.isFinite(targetColumn) ? Math.max(1, targetColumn) : 1
      return
    }
    this.finishLine()
  }

  private consumeTextCharacter(char: string): void {
    if (char === '\r' || char === '\n') {
      this.finishLine()
      return
    }
    if (this.lineOverflowed) return
    if (this.pendingLine.length >= MAX_PENDING_LINE) {
      this.pendingLine = ''
      this.lineOverflowed = true
      return
    }
    this.pendingLine += char
    this.textColumn += 1
  }

  private finishLine(): void {
    if (!this.lineOverflowed && !this.signalEmittedSinceUserInput) {
      const line = this.pendingLine.trim()
      const signalLine = line.startsWith('● ') ? line.slice(2).trimStart() : line
      const signal = SIGNAL_LINES.get(signalLine)
      if (signal) {
        this.signalEmittedSinceUserInput = true
        this.detectedSignals.push(signal)
      }
    }
    this.pendingLine = ''
    this.lineOverflowed = false
    this.textColumn = 1
  }
}
