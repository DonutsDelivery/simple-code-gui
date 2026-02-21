import { useCallback, useRef, useState } from 'react'
import type { WhisperModelSize, WhisperInstance, WhisperTranscriberConfig, STTRefs } from './types.js'
import { WHISPER_MODEL_URLS, WHISPER_MODEL_SIZES } from './constants.js'

// Dynamic import for whisper-web-transcriber - only loaded when voice input is actually used
// This saves ~4.5MB bundle size when voice features are disabled
let WhisperTranscriberClass: (new (config: WhisperTranscriberConfig) => WhisperInstance) | null = null

async function loadWhisperTranscriber(): Promise<new (config: WhisperTranscriberConfig) => WhisperInstance> {
  if (!WhisperTranscriberClass) {
    const module = await import('whisper-web-transcriber')
    WhisperTranscriberClass = module.WhisperTranscriber as new (config: WhisperTranscriberConfig) => WhisperInstance
  }
  return WhisperTranscriberClass
}

export interface UseSTTHandlersOptions {
  saveVoiceSetting: (key: string, value: boolean | number | string) => void
}

export interface UseSTTHandlersResult {
  // State
  isRecording: boolean
  isModelLoading: boolean
  isModelLoaded: boolean
  modelLoadProgress: number
  modelLoadStatus: string
  currentTranscription: string
  whisperModel: WhisperModelSize

  // Actions
  setWhisperModel: (model: WhisperModelSize) => void
  startRecording: (onTranscription: (text: string) => void) => Promise<void>
  stopRecording: () => void

  // Refs for cleanup
  refs: STTRefs

  // State setters for settings loading
  setWhisperModelState: (model: WhisperModelSize) => void
}

export function useSTTHandlers({ saveVoiceSetting }: UseSTTHandlersOptions): UseSTTHandlersResult {
  // Voice Input (STT) state
  const [isRecording, setIsRecording] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(false)
  const [isModelLoaded, setIsModelLoaded] = useState(false)
  const [modelLoadProgress, setModelLoadProgress] = useState(0)
  const [modelLoadStatus, setModelLoadStatus] = useState('')
  const [whisperModel, setWhisperModelState] = useState<WhisperModelSize>('base.en')
  const [currentTranscription, setCurrentTranscription] = useState('')

  // Refs
  const whisperRef = useRef<WhisperInstance | null>(null)
  const onTranscriptionRef = useRef<((text: string) => void) | null>(null)
  const finalTranscriptionRef = useRef<string>('')
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isRecordingRef = useRef(false)

  const refs: STTRefs = {
    whisperRef,
    onTranscriptionRef,
    finalTranscriptionRef,
    silenceTimerRef,
    isRecordingRef
  }

  // Initialize Whisper transcriber - dynamically loads the module only when needed
  const initWhisper = useCallback(async () => {
    if (whisperRef.current || isModelLoading) return

    setIsModelLoading(true)
    setModelLoadStatus('Loading Whisper module...')

    try {
      const WhisperTranscriber = await loadWhisperTranscriber()

      setModelLoadStatus('Initializing...')

      const modelUrl = WHISPER_MODEL_URLS[whisperModel]
      const modelSizeMB = WHISPER_MODEL_SIZES[whisperModel]

      const transcriber = new WhisperTranscriber({
        modelUrl,
        modelSize: whisperModel,
        onTranscription: (text: string) => {
          // ACCUMULATE transcriptions (library sends separate chunks)
          // Filter out Whisper's silence/noise markers and artifacts
          const cleaned = text.trim()
            .replace(/\[BLANK_AUDIO\]/gi, '')
            .replace(/\[Silence\]/gi, '')
            .replace(/\(silence\)/gi, '')
            .replace(/\[Pause\]/gi, '')
            .replace(/\(Pause\)/gi, '')
            .replace(/\[inaudible\]/gi, '')
            .replace(/\[Music\]/gi, '')
            .replace(/\(Music\)/gi, '')
            .replace(/\[Applause\]/gi, '')
            .replace(/\[Laughter\]/gi, '')
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .replace(/♪.*?♪/g, '')
            .replace(/\*.*?\*/g, '')
            .replace(/^[\s.,!?]+$/, '')
            .replace(/^\.*$/, '')
            .trim()

          // Skip if empty or just short punctuation/artifacts
          if (cleaned && cleaned.length > 1 && !/^[.,!?\-]+$/.test(cleaned)) {
            const newText = finalTranscriptionRef.current
              ? finalTranscriptionRef.current + ' ' + cleaned
              : cleaned
            finalTranscriptionRef.current = newText
            setCurrentTranscription(newText)

            // Reset silence timer - auto-submit after 3 seconds of no new speech
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current)
            }
            silenceTimerRef.current = setTimeout(async () => {
              if (isRecordingRef.current && whisperRef.current) {
                if (onTranscriptionRef.current && finalTranscriptionRef.current.trim()) {
                  const callback = onTranscriptionRef.current
                  const textToSend = finalTranscriptionRef.current.trim()

                  finalTranscriptionRef.current = ''
                  setCurrentTranscription('')

                  callback(textToSend)

                  whisperRef.current.stopRecording()
                  await whisperRef.current.startRecording()
                }
              }
            }, 3000)
          }
        },
        debug: true,
        onProgress: (progress: number) => {
          setModelLoadProgress(progress)
          setModelLoadStatus(`Downloading ${whisperModel} (${modelSizeMB}MB)... ${progress}%`)
        },
        onStatus: (status: string) => {
          setModelLoadStatus(status)
        }
      })

      await transcriber.loadModel()
      whisperRef.current = transcriber
      setIsModelLoaded(true)
      setModelLoadStatus('Model loaded')
    } catch (error: unknown) {
      console.error('Failed to initialize Whisper:', error)
      setModelLoadStatus(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsModelLoading(false)
    }
  }, [whisperModel, isModelLoading])

  // Set Whisper model (saves to settings)
  const setWhisperModel = useCallback((model: WhisperModelSize) => {
    setWhisperModelState(model)
    if (whisperRef.current) {
      whisperRef.current.destroy()
      whisperRef.current = null
      setIsModelLoaded(false)
    }
    saveVoiceSetting('whisperModel', model)
  }, [saveVoiceSetting])

  // Start recording and transcribing
  const startRecording = useCallback(async (onTranscription: (text: string) => void) => {
    if (isRecording) return

    onTranscriptionRef.current = onTranscription
    finalTranscriptionRef.current = ''
    setCurrentTranscription('')

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }

    if (!whisperRef.current) {
      await initWhisper()
    }

    if (!whisperRef.current) {
      console.error('Whisper not initialized')
      return
    }

    try {
      await whisperRef.current.startRecording()
      setIsRecording(true)
      isRecordingRef.current = true
    } catch (error: unknown) {
      console.error('Failed to start recording:', error)
      const errorMessage = error instanceof Error ? error.message : ''
      const errorName = error instanceof Error ? error.name : ''
      if (errorMessage.includes('Permission denied') || errorName === 'NotAllowedError') {
        alert('Microphone access denied. Please allow microphone access in your browser/system settings.')
      }
    }
  }, [isRecording, initWhisper])

  // Stop recording
  const stopRecording = useCallback(() => {
    if (!isRecording || !whisperRef.current) return

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }

    whisperRef.current.stopRecording()
    setIsRecording(false)
    isRecordingRef.current = false

    if (onTranscriptionRef.current && finalTranscriptionRef.current.trim()) {
      onTranscriptionRef.current(finalTranscriptionRef.current.trim())
    }

    onTranscriptionRef.current = null
    finalTranscriptionRef.current = ''
    setCurrentTranscription('')
  }, [isRecording])

  return {
    isRecording,
    isModelLoading,
    isModelLoaded,
    modelLoadProgress,
    modelLoadStatus,
    currentTranscription,
    whisperModel,
    setWhisperModel,
    startRecording,
    stopRecording,
    refs,
    setWhisperModelState
  }
}
