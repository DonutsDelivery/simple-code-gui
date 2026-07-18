import { describe, expect, it } from 'vitest'
import { AgentSessionSignalDetector } from '../agent-session-signal-detector'

const COMPLETE_TAG = '<claude-terminal-signal type="complete" />'
const INPUT_NEEDED_TAG = '<claude-terminal-signal type="input-needed" />'

describe('AgentSessionSignalDetector', () => {
  // AC: @agent-session-notifications ac-1
  it('detects a completion tag split across ANSI-decorated PTY chunks once', () => {
    const detector = new AgentSessionSignalDetector()

    expect(detector.push('\x1b[32m<claude-terminal-si')).toEqual([])
    expect(detector.push('\x1b[0mgnal type="complete" />\r\n')).toEqual(['complete'])
    expect(detector.push(`\x1b[2K\r${COMPLETE_TAG}\r\n`)).toEqual([])
  })

  // AC: @agent-session-notifications ac-2
  it('detects an input-needed tag split inside an ANSI sequence once', () => {
    const detector = new AgentSessionSignalDetector()

    expect(detector.push('\x1b[')).toEqual([])
    expect(detector.push(`31m${INPUT_NEEDED_TAG.slice(0, 20)}`)).toEqual([])
    expect(detector.push(`${INPUT_NEEDED_TAG.slice(20)}\x1b[0m\n`)).toEqual(['input-needed'])
    expect(detector.push(`\x1b[1A${INPUT_NEEDED_TAG}\n`)).toEqual([])
  })

  // AC: @agent-session-notifications ac-1
  // AC: @agent-session-notifications ac-2
  it('accepts Claude output decoration but rejects prompt echoes', () => {
    const detector = new AgentSessionSignalDetector()

    expect(detector.push(`❯ ${COMPLETE_TAG}\n`)).toEqual([])
    expect(detector.push(`stale screen text\x1b[2D\x1b[3B\r\x1b[6A\x1b[38;5;231m●\x1b[3G\x1b[39m<claude-terminal-signal\x1b[27Gtype="complete"\x1b[43G/>\r`)).toEqual(['complete'])

    detector.resetForUserInput()

    expect(detector.push(`● ${INPUT_NEEDED_TAG}\n`)).toEqual(['input-needed'])
  })

  // AC: @agent-session-notifications ac-1
  // AC: @agent-session-notifications ac-2
  it('ignores near matches and signal tags embedded in prose', () => {
    const detector = new AgentSessionSignalDetector()

    expect(detector.push(`quoted: ${COMPLETE_TAG}\n`)).toEqual([])
    expect(detector.push(`> ${INPUT_NEEDED_TAG}\n`)).toEqual([])
    expect(detector.push('<claude-terminal-signal type="complete" extra="true" />\n')).toEqual([])
    expect(detector.push('<claude-terminal-signal type="Complete" />\n')).toEqual([])
  })

  // AC: @agent-session-notifications ac-1
  it('does not emit a signal erased before the line is committed', () => {
    const detector = new AgentSessionSignalDetector()

    expect(detector.push(`${COMPLETE_TAG}\x1b[2K\r\n`)).toEqual([])
    expect(detector.push(`${COMPLETE_TAG}\x1b[1K\r\n`)).toEqual([])
  })

  // AC: @agent-session-notifications ac-1
  // AC: @agent-session-notifications ac-2
  it('latches the first stopping signal until explicit real user input reset', () => {
    const detector = new AgentSessionSignalDetector()

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
