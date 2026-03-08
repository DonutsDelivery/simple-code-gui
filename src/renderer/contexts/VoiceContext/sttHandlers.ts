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
  audioLevel: number
  silenceThreshold: number

  // Actions
  setWhisperModel: (model: WhisperModelSize) => void
  setSilenceThreshold: (threshold: number) => void
  startRecording: (onTranscription: (text: string) => void) => Promise<void>
  stopRecording: () => void

  // Refs for cleanup
  refs: STTRefs

  // State setters for settings loading
  setWhisperModelState: (model: WhisperModelSize) => void
  setSilenceThresholdState: (threshold: number) => void
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
  const [audioLevel, setAudioLevel] = useState(0)
  const [silenceThreshold, setSilenceThresholdState] = useState(5)

  // Refs
  const whisperRef = useRef<WhisperInstance | null>(null)
  const onTranscriptionRef = useRef<((text: string) => void) | null>(null)
  const finalTranscriptionRef = useRef<string>('')
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isRecordingRef = useRef(false)

  // Audio monitoring refs
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const levelIntervalRef = useRef<number | null>(null)
  const silenceStartRef = useRef<number | null>(null)
  const silenceThresholdRef = useRef(silenceThreshold)
  const speechDetectedRef = useRef(false) // true if audio went above threshold since last chunk
  const processingUtteranceRef = useRef(false) // guard against re-entry during stop/submit/restart

  const refs: STTRefs = {
    whisperRef,
    onTranscriptionRef,
    finalTranscriptionRef,
    silenceTimerRef,
    isRecordingRef
  }

  // Start audio level monitoring
  const startAudioMonitoring = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioStreamRef.current = stream
      const audioCtx = new AudioContext()
      audioContextRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      levelIntervalRef.current = window.setInterval(() => {
        if (!analyserRef.current || !isRecordingRef.current) return
        analyserRef.current.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length
        const level = Math.round((avg / 255) * 100)
        setAudioLevel(level)

        const threshold = silenceThresholdRef.current
        if (level < threshold) {
          // Audio is below threshold (silence)
          if (!silenceStartRef.current) {
            silenceStartRef.current = Date.now()
          } else if (!processingUtteranceRef.current) {
            const silenceDuration = Date.now() - silenceStartRef.current
            // After 2s of silence with speech detected: submit transcription,
            // then stop/restart Whisper to clear the audio buffer
            if (silenceDuration > 2000 && speechDetectedRef.current &&
                finalTranscriptionRef.current.trim() &&
                isRecordingRef.current && whisperRef.current) {
              processingUtteranceRef.current = true

              const callback = onTranscriptionRef.current
              const textToSend = finalTranscriptionRef.current.trim()
              finalTranscriptionRef.current = ''
              setCurrentTranscription('')
              silenceStartRef.current = null
              speechDetectedRef.current = false

              if (callback && textToSend) {
                callback(textToSend)
              }

              // Stop and restart to clear Whisper's accumulated audio buffer
              whisperRef.current.stopRecording()
              if (isRecordingRef.current && whisperRef.current) {
                whisperRef.current.startRecording().catch((error) => {
                  console.error('Failed to restart recording after silence:', error)
                  setIsRecording(false)
                  isRecordingRef.current = false
                })
              }
              processingUtteranceRef.current = false
            }
          }
        } else {
          // Audio is above threshold (speaking)
          silenceStartRef.current = null
          speechDetectedRef.current = true
        }
      }, 100)
    } catch (error) {
      console.error('Failed to start audio monitoring:', error)
    }
  }, [])

  // Stop audio level monitoring
  const stopAudioMonitoring = useCallback(() => {
    if (levelIntervalRef.current !== null) {
      clearInterval(levelIntervalRef.current)
      levelIntervalRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop())
      audioStreamRef.current = null
    }
    analyserRef.current = null
    silenceStartRef.current = null
    setAudioLevel(0)
  }, [])

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
        audioIntervalMs: 3000, // Feed audio to Whisper every 3s for near-realtime processing
        onTranscription: (text: string) => {
          // Library returns CUMULATIVE transcription of all audio since startRecording()
          // So we REPLACE (not append) the current transcription text
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
          // Also skip if no speech was detected (audio never exceeded threshold)
          if (cleaned && cleaned.length > 1 && !/^[.,!?\-]+$/.test(cleaned) && speechDetectedRef.current) {
            finalTranscriptionRef.current = cleaned
            setCurrentTranscription(cleaned)
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

      // Override confirm() to auto-accept the model download prompt from helpers.js
      const originalConfirm = window.confirm
      window.confirm = () => true
      try {
        await transcriber.loadModel()
      } finally {
        window.confirm = originalConfirm
      }
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

  // Set silence threshold (saves to settings)
  const setSilenceThreshold = useCallback((threshold: number) => {
    setSilenceThresholdState(threshold)
    silenceThresholdRef.current = threshold
    saveVoiceSetting('voiceSilenceThreshold', threshold)
  }, [saveVoiceSetting])

  // Start recording and transcribing
  const startRecording = useCallback(async (onTranscription: (text: string) => void) => {
    if (isRecording) return

    onTranscriptionRef.current = onTranscription
    finalTranscriptionRef.current = ''
    setCurrentTranscription('')
    silenceStartRef.current = null
    speechDetectedRef.current = false

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
      await startAudioMonitoring()
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
  }, [isRecording, initWhisper, startAudioMonitoring])

  // Stop recording
  const stopRecording = useCallback(() => {
    if (!isRecording || !whisperRef.current) return

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }

    whisperRef.current.stopRecording()
    stopAudioMonitoring()
    setIsRecording(false)
    isRecordingRef.current = false

    if (onTranscriptionRef.current && finalTranscriptionRef.current.trim()) {
      onTranscriptionRef.current(finalTranscriptionRef.current.trim())
    }

    onTranscriptionRef.current = null
    finalTranscriptionRef.current = ''
    setCurrentTranscription('')
  }, [isRecording, stopAudioMonitoring])

  return {
    isRecording,
    isModelLoading,
    isModelLoaded,
    modelLoadProgress,
    modelLoadStatus,
    currentTranscription,
    whisperModel,
    audioLevel,
    silenceThreshold,
    setWhisperModel,
    setSilenceThreshold,
    startRecording,
    stopRecording,
    refs,
    setWhisperModelState,
    setSilenceThresholdState
  }
}
