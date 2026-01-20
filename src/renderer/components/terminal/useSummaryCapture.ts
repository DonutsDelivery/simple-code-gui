import { useRef, useState, useEffect, useCallback } from 'react'
import {
  SUMMARY_EXTRACT_REGEX,
  SUMMARY_MARKER_DISPLAY_REGEX,
  MIN_SUMMARY_LENGTH,
  MAX_SUMMARY_BUFFER_SIZE,
} from './constants.js'

interface UseSummaryCaptureOptions {
  ptyId: string
  sendBackendCommand: (commandId: string) => boolean
  autoWorkWithSummary: boolean
  buildAutoWorkPrompt: () => string
}

interface UseSummaryCaptureReturn {
  processSummaryChunk: (cleanChunk: string) => void
  triggerSummarize: () => void
  isCapturing: boolean
}

/**
 * Hook for handling summary capture and "Summarize & Clear" feature.
 * Captures summary markers from terminal output and triggers context recovery.
 */
export function useSummaryCapture({
  ptyId,
  sendBackendCommand,
  autoWorkWithSummary,
  buildAutoWorkPrompt,
}: UseSummaryCaptureOptions): UseSummaryCaptureReturn {
  const summaryBufferRef = useRef('')
  const capturingSummaryRef = useRef(false)
  const [pendingSummary, setPendingSummary] = useState<string | null>(null)

  // Trigger summary capture
  const triggerSummarize = useCallback(() => {
    summaryBufferRef.current = ''
    capturingSummaryRef.current = true
    console.log('[Summary] Capture enabled for ptyId:', ptyId)
    window.electronAPI?.writePty(ptyId, 'Summarize this session for context recovery. Wrap output in markers: three equals, SUMMARY_START, three equals at start. Three equals, SUMMARY_END, three equals at end.\r')
  }, [ptyId])

  // Process chunk for summary markers
  const processSummaryChunk = useCallback((cleanChunk: string) => {
    if (!capturingSummaryRef.current) return

    summaryBufferRef.current += cleanChunk

    // Check for complete summary markers
    const summaryMatch = summaryBufferRef.current.match(SUMMARY_EXTRACT_REGEX)
    if (summaryMatch) {
      let summary = summaryMatch[1].trim()
      summary = summary.replace(SUMMARY_MARKER_DISPLAY_REGEX, '')

      // Minimum length check
      if (summary.length >= MIN_SUMMARY_LENGTH) {
        capturingSummaryRef.current = false
        summaryBufferRef.current = ''
        setPendingSummary(summary)
      }
    }

    // Limit buffer size
    if (summaryBufferRef.current.length > MAX_SUMMARY_BUFFER_SIZE) {
      capturingSummaryRef.current = false
      summaryBufferRef.current = ''
    }
  }, [])

  // Handle pending summary - trigger /clear and paste
  useEffect(() => {
    if (!pendingSummary) return

    const summaryToSend = pendingSummary
    const shouldContinueAutoWork = autoWorkWithSummary
    console.log('[Summary] useEffect triggered, running /clear, summary length:', summaryToSend.length, 'autowork:', shouldContinueAutoWork)

    const didClear = sendBackendCommand('clear')
    const clearDelay = didClear ? 2000 : 100

    setTimeout(() => {
      console.log('[Summary] Pasting summary:', summaryToSend.substring(0, 50) + '...')
      window.electronAPI?.writePty(ptyId, summaryToSend + '\r')

      if (shouldContinueAutoWork) {
        setTimeout(() => {
          console.log('[AutoWork+Summary] Sending work prompt after summary')
          const autoworkPrompt = buildAutoWorkPrompt()
          window.electronAPI?.writePty(ptyId, autoworkPrompt + '\r')
        }, 2000)
      }
    }, clearDelay)

    setPendingSummary(null)
  }, [pendingSummary, ptyId, sendBackendCommand, autoWorkWithSummary, buildAutoWorkPrompt])

  return {
    processSummaryChunk,
    triggerSummarize,
    isCapturing: capturingSummaryRef.current,
  }
}
