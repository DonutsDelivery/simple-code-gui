import { describe, expect, it } from 'vitest'
import { AgentSessionSignalDetector, AgentSessionSignalOutputFilter } from '../agent-session-signal-detector'
import { formatAgentSessionSignal } from '../agent-session-signal-protocol'

const PROJECT_PATH = '/test/project'
const OTHER_PROJECT_PATH = '/test/other-project'
const COMPLETE_TAG = formatAgentSessionSignal(PROJECT_PATH, 'complete')
const INPUT_NEEDED_TAG = formatAgentSessionSignal(PROJECT_PATH, 'input-needed')
const LEGACY_COMPLETE_TAG = '<claude-terminal-signal type="complete" />'

describe('AgentSessionSignalDetector', () => {
  // AC: @agent-session-notifications ac-1
  it('detects a completion tag split across ANSI-decorated PTY chunks once', () => {
    const detector = new AgentSessionSignalDetector(PROJECT_PATH)

    const splitIndex = Math.floor(COMPLETE_TAG.length / 2)
    expect(detector.push(`\x1b[32m${COMPLETE_TAG.slice(0, splitIndex)}`)).toEqual([])
    expect(detector.push(`\x1b[0m${COMPLETE_TAG.slice(splitIndex)}\r\n`)).toEqual(['complete'])
    expect(detector.push(`\x1b[2K\r${COMPLETE_TAG}\r\n`)).toEqual([])
  })

  // AC: @agent-session-notifications ac-2
  it('detects an input-needed tag split inside an ANSI sequence once', () => {
    const detector = new AgentSessionSignalDetector(PROJECT_PATH)

    expect(detector.push('\x1b[')).toEqual([])
    expect(detector.push(`31m${INPUT_NEEDED_TAG.slice(0, 20)}`)).toEqual([])
    expect(detector.push(`${INPUT_NEEDED_TAG.slice(20)}\x1b[0m\n`)).toEqual(['input-needed'])
    expect(detector.push(`\x1b[1A${INPUT_NEEDED_TAG}\n`)).toEqual([])
  })

  // AC: @agent-session-notifications ac-1
  // AC: @agent-session-notifications ac-2
  it('accepts Claude output decoration but rejects prompt echoes', () => {
    const detector = new AgentSessionSignalDetector(PROJECT_PATH)

    expect(detector.push(`❯ ${COMPLETE_TAG}\n`)).toEqual([])
    expect(detector.push(`stale screen text\x1b[2K\r\x1b[38;5;231m●\x1b[0m ${COMPLETE_TAG}\r`)).toEqual(['complete'])

    detector.resetForUserInput()

    expect(detector.push(`● ${INPUT_NEEDED_TAG}\n`)).toEqual(['input-needed'])
  })

  // AC: @agent-session-notifications ac-1
  // AC: @agent-session-notifications ac-2
  it('ignores near matches and signal tags embedded in prose', () => {
    const detector = new AgentSessionSignalDetector(PROJECT_PATH)

    expect(detector.push(`quoted: ${COMPLETE_TAG}\n`)).toEqual([])
    expect(detector.push(`> ${INPUT_NEEDED_TAG}\n`)).toEqual([])
    expect(detector.push(`${COMPLETE_TAG.replace(' />', ' extra="true" />')}\n`)).toEqual([])
    expect(detector.push(`${COMPLETE_TAG.replace('t="c"', 't="x"')}\n`)).toEqual([])
  })

  // AC: @agent-session-notifications ac-7
  it('keeps project-scoped signals shorter than the legacy terminal-safe signal', () => {
    expect(COMPLETE_TAG.length).toBeLessThanOrEqual(LEGACY_COMPLETE_TAG.length)
    expect(INPUT_NEEDED_TAG.length).toBeLessThanOrEqual(LEGACY_COMPLETE_TAG.length)
  })

  // AC: @agent-session-notifications ac-7
  it('ignores tool-output candidates without consuming the later final-response signal', () => {
    const detector = new AgentSessionSignalDetector(PROJECT_PATH)
    const otherProjectTag = formatAgentSessionSignal(OTHER_PROJECT_PATH, 'complete')

    expect(detector.push(`tool result:\n  ${LEGACY_COMPLETE_TAG}\n`)).toEqual([])
    expect(detector.push(`${otherProjectTag}\n`)).toEqual([])
    expect(detector.push('<ct-signal k="{KEY}" t="{CODE}" />\n')).toEqual([])
    expect(detector.push(`${COMPLETE_TAG}\n`)).toEqual(['complete'])
  })

  // AC: @agent-session-notifications ac-7
  it('keeps project-scoped signals isolated between detectors', () => {
    const detector = new AgentSessionSignalDetector(PROJECT_PATH)
    const otherDetector = new AgentSessionSignalDetector(OTHER_PROJECT_PATH)

    expect(detector.push(`${formatAgentSessionSignal(OTHER_PROJECT_PATH, 'complete')}\n`)).toEqual([])
    expect(otherDetector.push(`${COMPLETE_TAG}\n`)).toEqual([])
  })

  // AC: @agent-session-notifications ac-1
  it('does not emit a signal erased before the line is committed', () => {
    const detector = new AgentSessionSignalDetector(PROJECT_PATH)

    expect(detector.push(`${COMPLETE_TAG}\x1b[2K\r\n`)).toEqual([])
    expect(detector.push(`${COMPLETE_TAG}\x1b[1K\r\n`)).toEqual([])
  })

  // AC: @agent-session-notifications ac-1
  it('accepts terminal cursor padding within an otherwise exact signal line', () => {
    const detector = new AgentSessionSignalDetector(PROJECT_PATH)
    const paddedTag = COMPLETE_TAG.replace(' />', '   />')

    expect(detector.push(`${paddedTag}\n`)).toEqual(['complete'])
  })

  // AC: @agent-session-notifications ac-1
  // AC: @agent-session-notifications ac-2
  it('ignores split multi-byte ESC decorations around exact signal lines', () => {
    const detector = new AgentSessionSignalDetector(PROJECT_PATH)

    expect(detector.push('\x1b(')).toEqual([])
    expect(detector.push(`B${COMPLETE_TAG}\n`)).toEqual(['complete'])

    detector.resetForUserInput()

    expect(detector.push('\x1b#')).toEqual([])
    expect(detector.push(`8${INPUT_NEEDED_TAG}\n`)).toEqual(['input-needed'])
  })

  // AC: @agent-session-notifications ac-1
  // AC: @agent-session-notifications ac-2
  it('latches the first stopping signal until explicit real user input reset', () => {
    const detector = new AgentSessionSignalDetector(PROJECT_PATH)

    expect(detector.push(`${COMPLETE_TAG}\n${INPUT_NEEDED_TAG}\n`)).toEqual([
      'complete',
    ])
    expect(detector.push(`${INPUT_NEEDED_TAG}\n${COMPLETE_TAG}\n`)).toEqual([])

    detector.resetForUserInput()

    expect(detector.push(`${INPUT_NEEDED_TAG}\n${COMPLETE_TAG}\n`)).toEqual([
      'input-needed',
    ])
  })
})

describe('AgentSessionSignalOutputFilter', () => {
  it('hides managed tags even when they span PTY chunks', () => {
    const filter = new AgentSessionSignalOutputFilter(PROJECT_PATH)
    const splitIndex = Math.floor(COMPLETE_TAG.length / 2)

    expect(filter.push(`before\n${COMPLETE_TAG.slice(0, splitIndex)}`)).toBe('before\n')
    expect(filter.push(`${COMPLETE_TAG.slice(splitIndex)}\nafter`)).toBe('\nafter')
  })

  it('preserves ordinary angle-bracket output', () => {
    const filter = new AgentSessionSignalOutputFilter(PROJECT_PATH)

    expect(filter.push('<div>hello</div>')).toBe('<div>hello</div>')
  })
})
