import { useRef, useEffect, useCallback } from 'react'
import { useVoice } from '../../contexts/VoiceContext.js'
import { stripAnsi } from './utils.js'
import {
  TTS_TAG_REGEX,
  CODE_PATTERN_REGEX,
  MAX_TTS_BUFFER_SIZE,
  MAX_SPOKEN_SET_SIZE,
  MIN_SILENT_PERIOD_MS,
} from './constants.js'

interface UseTTSOptions {
  ptyId: string
  isActive: boolean
}

interface UseTTSReturn {
  processTTSChunk: (cleanChunk: string) => void
  handleUserInput: (data: string) => void
  resetTTSState: () => void
  prePopulateSpokenContent: (chunks: string[]) => void
}

/**
 * Hook for handling Text-to-Speech functionality in the terminal.
 * Extracts TTS tags from terminal output and speaks content when appropriate.
 */
export function useTTS({ ptyId, isActive }: UseTTSOptions): UseTTSReturn {
  const { voiceOutputEnabled, speakText } = useVoice()

  // Refs for TTS state
  const voiceOutputEnabledRef = useRef(voiceOutputEnabled)
  const isActiveRef = useRef(isActive)
  const spokenContentRef = useRef<Set<string>>(new Set())
  const silentModeRef = useRef(true)
  const sessionStartTimeRef = useRef(Date.now())
  const ttsBufferRef = useRef('')

  // Keep refs in sync with props
  useEffect(() => {
    voiceOutputEnabledRef.current = voiceOutputEnabled
  }, [voiceOutputEnabled])

  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  // Reset TTS state for new session
  const resetTTSState = useCallback(() => {
    silentModeRef.current = true
    spokenContentRef.current.clear()
    ttsBufferRef.current = ''
    sessionStartTimeRef.current = Date.now()
  }, [])

  // Pre-populate spoken content from buffered data (for HMR recovery)
  const prePopulateSpokenContent = useCallback((chunks: string[]) => {
    for (const chunk of chunks) {
      const cleanChunk = stripAnsi(chunk)
      const tagRegex = /(?:«tts»|<tts>)([\s\S]*?)(?:«\/tts»|<\/tts>)/g
      let match
      while ((match = tagRegex.exec(cleanChunk)) !== null) {
        const content = match[1].trim()
        if (content.length > 3) {
          spokenContentRef.current.add(content)
        }
      }
    }
  }, [])

  // Handle user input to exit silent mode
  const handleUserInput = useCallback((data: string) => {
    // Ignore terminal control sequences
    if (data.startsWith('\x1b[') && (data.endsWith('R') || data === '\x1b[I' || data === '\x1b[O')) {
      return
    }

    // Ignore Enter and arrow keys - these navigate TOS dialogs
    const isEnterKey = data === '\r' || data === '\n'
    const isArrowKey = data === '\x1b[A' || data === '\x1b[B' || data === '\x1b[C' || data === '\x1b[D'
    const timeSinceStart = Date.now() - sessionStartTimeRef.current

    if (silentModeRef.current && !isEnterKey && !isArrowKey && timeSinceStart >= MIN_SILENT_PERIOD_MS) {
      silentModeRef.current = false
      // Clear TTS buffer to discard partial tags from session restoration
      ttsBufferRef.current = ''
    }
  }, [])

  // Process a chunk of terminal data for TTS
  const processTTSChunk = useCallback((cleanChunk: string) => {
    ttsBufferRef.current += cleanChunk

    // Extract all complete TTS markers from buffer
    TTS_TAG_REGEX.lastIndex = 0
    let match
    let lastIndex = 0

    while ((match = TTS_TAG_REGEX.exec(ttsBufferRef.current)) !== null) {
      lastIndex = match.index + match[0].length
      const content = match[1].trim()

      // Skip if content looks like code
      const looksLikeCode = CODE_PATTERN_REGEX.test(content)
      const looksLikeProse = content.length > 5 && /^[a-zA-Z]/.test(content) && !looksLikeCode

      if (looksLikeProse && !spokenContentRef.current.has(content)) {
        spokenContentRef.current.add(content)
        // Only speak if: voice enabled, tab active, and not in silent mode
        if (voiceOutputEnabledRef.current && isActiveRef.current && !silentModeRef.current) {
          speakText(content)
        }
      }
    }

    // Keep only the part after the last complete tag
    if (lastIndex > 0) {
      ttsBufferRef.current = ttsBufferRef.current.substring(lastIndex)
    }

    // If buffer has no opening marker, clear it
    if (!ttsBufferRef.current.includes('«tts') && !ttsBufferRef.current.includes('<tts')) {
      ttsBufferRef.current = ''
    }

    // Limit buffer size
    if (ttsBufferRef.current.length > MAX_TTS_BUFFER_SIZE) {
      ttsBufferRef.current = ttsBufferRef.current.substring(ttsBufferRef.current.length - MAX_TTS_BUFFER_SIZE)
    }

    // Limit spoken set size
    if (spokenContentRef.current.size > MAX_SPOKEN_SET_SIZE) {
      const entries = Array.from(spokenContentRef.current)
      spokenContentRef.current = new Set(entries.slice(-500))
    }
  }, [speakText])

  return {
    processTTSChunk,
    handleUserInput,
    resetTTSState,
    prePopulateSpokenContent,
  }
}
