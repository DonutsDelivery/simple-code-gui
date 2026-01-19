// TTS debug logging

import * as fs from 'fs'

import { ttsDebugLogPath } from './paths.js'

export function logTTS(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString()
  const logLine = data
    ? `[${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}\n`
    : `[${timestamp}] ${message}\n`
  fs.appendFileSync(ttsDebugLogPath, logLine)
}
