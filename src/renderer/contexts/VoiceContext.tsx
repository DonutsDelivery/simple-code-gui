import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react'

// Dynamic import for whisper-web-transcriber - only loaded when voice input is actually used
// This saves ~4.5MB bundle size when voice features are disabled
let WhisperTranscriberClass: (new (config: WhisperTranscriberConfig) => WhisperInstance) | null = null

const loadWhisperTranscriber = async (): Promise<new (config: WhisperTranscriberConfig) => WhisperInstance> => {
  if (!WhisperTranscriberClass) {
    const module = await import('whisper-web-transcriber')
    WhisperTranscriberClass = module.WhisperTranscriber as new (config: WhisperTranscriberConfig) => WhisperInstance
  }
  return WhisperTranscriberClass
}

// WhisperTranscriber instance interface for type safety
interface WhisperInstance {
  loadModel(): Promise<void>
  startRecording(): Promise<void>
  stopRecording(): void
  destroy(): void
}

// WhisperTranscriber config - modelSize accepts string (library has loose typing)
interface WhisperTranscriberConfig {
  modelUrl: string
  modelSize: string  // Library accepts any string, we pass our WhisperModelSize
  onTranscription: (text: string) => void
  onProgress?: (progress: number) => void
  onStatus?: (status: string) => void
  maxRecordingTime?: number
}

// Map to HuggingFace URLs for all Whisper model sizes
type WhisperModelSize = 'tiny.en' | 'base.en' | 'small.en' | 'medium.en' | 'large-v3'

const WHISPER_MODEL_URLS: Record<WhisperModelSize, string> = {
  'tiny.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  'base.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  'small.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  'medium.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
  'large-v3': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin'
}

const WHISPER_MODEL_SIZES: Record<WhisperModelSize, number> = {
  'tiny.en': 75,
  'base.en': 147,
  'small.en': 488,
  'medium.en': 1500,
  'large-v3': 3000
}

interface ProjectVoiceSettings {
  ttsVoice?: string
  ttsEngine?: 'piper' | 'xtts'
}

interface VoiceContextValue {
  // Voice Output (TTS)
  voiceOutputEnabled: boolean
  setVoiceOutputEnabled: (enabled: boolean) => void
  speakText: (text: string) => void
  stopSpeaking: () => void
  isSpeaking: boolean
  volume: number
  setVolume: (volume: number) => void
  speed: number
  setSpeed: (speed: number) => void
  skipOnNew: boolean
  setSkipOnNew: (skip: boolean) => void
  setProjectVoice: (settings: ProjectVoiceSettings | null) => void  // Per-project voice override

  // Voice Input (STT)
  isRecording: boolean
  isModelLoading: boolean
  isModelLoaded: boolean
  modelLoadProgress: number
  modelLoadStatus: string
  currentTranscription: string  // Live transcription while recording
  whisperModel: WhisperModelSize
  setWhisperModel: (model: WhisperModelSize) => void
  startRecording: (onTranscription: (text: string) => void) => Promise<void>
  stopRecording: () => void
}

const VoiceContext = createContext<VoiceContextValue | null>(null)

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  // Voice Output (TTS) state
  const [voiceOutputEnabled, setVoiceOutputEnabledState] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [volume, setVolumeState] = useState(1.0)
  const [speed, setSpeedState] = useState(1.0)
  const [skipOnNew, setSkipOnNewState] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)  // Track blob URL for cleanup on unmount
  const speakQueueRef = useRef<string[]>([])
  const isProcessingRef = useRef(false)
  const voiceOutputEnabledRef = useRef(voiceOutputEnabled)
  const skipOnNewRef = useRef(skipOnNew)
  const volumeRef = useRef(volume)  // Track volume for processQueue closure
  // Generation ID to cancel stale processQueue instances when skipOnNew triggers
  const processingGenerationRef = useRef(0)
  // Resolve function to unblock hung audio promises when cancelled
  const audioResolveRef = useRef<(() => void) | null>(null)
  // Per-project voice override
  const projectVoiceRef = useRef<ProjectVoiceSettings | null>(null)
  const globalVoiceRef = useRef<{ voice: string; engine: string } | null>(null)

  // Voice Input (STT) state
  const [isRecording, setIsRecording] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(false)
  const [isModelLoaded, setIsModelLoaded] = useState(false)
  const [modelLoadProgress, setModelLoadProgress] = useState(0)
  const [modelLoadStatus, setModelLoadStatus] = useState('')
  const [whisperModel, setWhisperModelState] = useState<WhisperModelSize>('base.en')
  const [currentTranscription, setCurrentTranscription] = useState('')
  const whisperRef = useRef<WhisperInstance | null>(null)
  const onTranscriptionRef = useRef<((text: string) => void) | null>(null)
  const finalTranscriptionRef = useRef<string>('')
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isRecordingRef = useRef(false)  // Ref version for callbacks

  // Load settings on mount
  useEffect(() => {
    window.electronAPI.getSettings().then((settings) => {
      if (settings.voiceOutputEnabled !== undefined) setVoiceOutputEnabledState(settings.voiceOutputEnabled)
      if (settings.voiceVolume !== undefined) setVolumeState(settings.voiceVolume)
      if (settings.voiceSpeed !== undefined) {
        setSpeedState(settings.voiceSpeed)
        window.electronAPI.voiceApplySettings?.({ ttsSpeed: settings.voiceSpeed })
      }
      if (settings.voiceSkipOnNew !== undefined) setSkipOnNewState(settings.voiceSkipOnNew)
      setSettingsLoaded(true)
    })
    // Load global voice settings for project override feature
    window.electronAPI.voiceGetSettings?.().then((voiceSettings) => {
      if (voiceSettings) {
        globalVoiceRef.current = {
          voice: voiceSettings.ttsVoice || '',
          engine: voiceSettings.ttsEngine || 'piper'
        }
      }
    }).catch(e => console.error('Failed to load global voice settings:', e))
  }, [])

  // Keep refs in sync to avoid stale closures
  useEffect(() => {
    voiceOutputEnabledRef.current = voiceOutputEnabled
  }, [voiceOutputEnabled])

  useEffect(() => {
    skipOnNewRef.current = skipOnNew
  }, [skipOnNew])

  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  // Save a single voice setting
  const saveVoiceSetting = useCallback(async (key: string, value: boolean | number) => {
    if (!settingsLoaded) return
    const settings = await window.electronAPI.getSettings()
    await window.electronAPI.saveSettings({ ...settings, [key]: value })
  }, [settingsLoaded])

  // Debounced save for slider-based settings (volume, speed) to avoid excessive IPC calls
  const debouncedSaveRef = useRef<{ timer: NodeJS.Timeout | null; pending: Map<string, boolean | number> }>({
    timer: null,
    pending: new Map()
  })

  const debouncedSaveVoiceSetting = useMemo(() => {
    return (key: string, value: boolean | number) => {
      debouncedSaveRef.current.pending.set(key, value)
      if (debouncedSaveRef.current.timer) {
        clearTimeout(debouncedSaveRef.current.timer)
      }
      debouncedSaveRef.current.timer = setTimeout(() => {
        // Save all pending settings
        debouncedSaveRef.current.pending.forEach((val, k) => {
          saveVoiceSetting(k, val)
        })
        debouncedSaveRef.current.pending.clear()
        debouncedSaveRef.current.timer = null
      }, 500)
    }
  }, [saveVoiceSetting])

  // Wrapper for setVoiceOutputEnabled that saves setting
  const setVoiceOutputEnabled = useCallback((enabled: boolean) => {
    setVoiceOutputEnabledState(enabled)
    saveVoiceSetting('voiceOutputEnabled', enabled)
  }, [saveVoiceSetting])

  // Update volume on current audio
  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    setVolumeState(clamped)
    if (audioRef.current) {
      audioRef.current.volume = clamped
    }
    debouncedSaveVoiceSetting('voiceVolume', clamped)
  }, [debouncedSaveVoiceSetting])

  // Update speed and notify backend
  const setSpeed = useCallback((s: number) => {
    const clamped = Math.max(0.5, Math.min(2.0, s))
    setSpeedState(clamped)
    window.electronAPI.voiceApplySettings?.({ ttsSpeed: clamped })
    debouncedSaveVoiceSetting('voiceSpeed', clamped)
  }, [debouncedSaveVoiceSetting])

  // Update skipOnNew and save
  const setSkipOnNew = useCallback((skip: boolean) => {
    setSkipOnNewState(skip)
    saveVoiceSetting('voiceSkipOnNew', skip)
  }, [saveVoiceSetting])

  // Set per-project voice override
  const setProjectVoice = useCallback((settings: ProjectVoiceSettings | null) => {
    projectVoiceRef.current = settings
    // Apply project voice or restore global
    if (settings?.ttsVoice && settings?.ttsEngine) {
      window.electronAPI.voiceApplySettings?.({
        ttsVoice: settings.ttsVoice,
        ttsEngine: settings.ttsEngine
      })
    } else if (globalVoiceRef.current) {
      // Restore global voice
      window.electronAPI.voiceApplySettings?.({
        ttsVoice: globalVoiceRef.current.voice,
        ttsEngine: globalVoiceRef.current.engine as 'piper' | 'xtts'
      })
    }
  }, [])

  // Process the speak queue
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || speakQueueRef.current.length === 0) return

    isProcessingRef.current = true
    setIsSpeaking(true)
    const myGeneration = processingGenerationRef.current

    while (speakQueueRef.current.length > 0) {
      // Check if this processQueue instance was cancelled
      if (processingGenerationRef.current !== myGeneration) {
        return  // Exit without clearing isProcessingRef - new instance handles it
      }

      const text = speakQueueRef.current.shift()
      if (!text) continue

      try {
        // Call Piper TTS via IPC - returns audio as base64
        const result = await window.electronAPI.voiceSpeak?.(text)

        // Check again after async operation
        if (processingGenerationRef.current !== myGeneration) {
          return
        }

        if (result?.success && result.audioData) {
          // Play the audio from base64 data
          await new Promise<void>((resolve) => {
            // Store resolve so skipOnNew can unblock us
            audioResolveRef.current = resolve

            const audioData = Uint8Array.from(atob(result.audioData), c => c.charCodeAt(0))
            const blob = new Blob([audioData], { type: 'audio/wav' })
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            audio.volume = volumeRef.current
            audioRef.current = audio
            audioUrlRef.current = url  // Track URL for cleanup on unmount

            const cleanup = () => {
              URL.revokeObjectURL(url)
              if (audioRef.current === audio) {
                audioRef.current = null
              }
              if (audioUrlRef.current === url) {
                audioUrlRef.current = null
              }
              audioResolveRef.current = null
              resolve()
            }

            audio.onended = cleanup
            audio.onerror = (e) => {
              console.error('Audio playback error:', e)
              cleanup()
            }

            audio.play().catch(e => {
              console.error('Failed to play audio:', e)
              cleanup()
            })
          })
        } else if (result?.error) {
          console.error('TTS error:', result.error)
        }
      } catch (e) {
        console.error('TTS error:', e)
      }
    }

    // Only clear if we're still the active generation
    if (processingGenerationRef.current === myGeneration) {
      isProcessingRef.current = false
      setIsSpeaking(false)
    }
  }, [])

  const speakText = useCallback((text: string) => {
    if (!voiceOutputEnabledRef.current) return  // Use ref to avoid stale closure

    // Clean up the text - remove ANSI codes, excessive whitespace
    const cleanText = text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // Remove ANSI escape codes
      .replace(/[\r\n]+/g, ' ') // Replace newlines with spaces
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim()

    // Debug logging
    console.log('[TTS Debug] speakText called:', {
      originalLength: text.length,
      cleanedLength: cleanText.length,
      original: text.substring(0, 100),
      cleaned: cleanText.substring(0, 100)
    })

    if (cleanText.length < 3) return // Skip very short text

    // If skipOnNew is enabled, cancel current playback and start fresh
    if (skipOnNewRef.current) {
      speakQueueRef.current = []
      // Increment generation to cancel any running processQueue
      processingGenerationRef.current++
      // Unblock any hung audio promise
      if (audioResolveRef.current) {
        audioResolveRef.current()
        audioResolveRef.current = null
      }
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      isProcessingRef.current = false
    }

    speakQueueRef.current.push(cleanText)
    processQueue()
  }, [processQueue])

  const stopSpeaking = useCallback(() => {
    speakQueueRef.current = []
    // Increment generation to cancel any running processQueue
    processingGenerationRef.current++
    // Unblock any hung audio promise
    if (audioResolveRef.current) {
      audioResolveRef.current()
      audioResolveRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    window.electronAPI.voiceStopSpeaking?.()
    setIsSpeaking(false)
    isProcessingRef.current = false
  }, [])

  // Stop speaking when disabled
  useEffect(() => {
    if (!voiceOutputEnabled) {
      stopSpeaking()
    }
  }, [voiceOutputEnabled, stopSpeaking])

  // ==================== Voice Input (STT) ====================

  // Initialize Whisper transcriber - dynamically loads the module only when needed
  const initWhisper = useCallback(async () => {
    if (whisperRef.current || isModelLoading) return

    setIsModelLoading(true)
    setModelLoadStatus('Loading Whisper module...')

    try {
      // Dynamically load the whisper-web-transcriber module
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
            .replace(/\[.*?\]/g, '')  // Any remaining [bracketed] markers
            .replace(/\(.*?\)/g, '')  // Any remaining (parenthetical) markers
            .replace(/♪.*?♪/g, '')  // Music notes
            .replace(/\*.*?\*/g, '')  // Asterisk markers
            .replace(/^[\s.,!?]+$/, '')  // Only punctuation
            .replace(/^\.*$/, '')  // Only periods
            .trim()

          // Skip if empty or just short punctuation/artifacts
          if (cleaned && cleaned.length > 1 && !/^[.,!?\-]+$/.test(cleaned)) {
            // Append new text to existing transcription
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
              // Auto-submit if still recording, but keep recording for continuous mode
              if (isRecordingRef.current && whisperRef.current) {
                // Submit the final transcription
                if (onTranscriptionRef.current && finalTranscriptionRef.current.trim()) {
                  const callback = onTranscriptionRef.current
                  const textToSend = finalTranscriptionRef.current.trim()

                  // Clear transcription for next input
                  finalTranscriptionRef.current = ''
                  setCurrentTranscription('')

                  // Send the transcription
                  callback(textToSend)

                  // Restart recording for continuous mode
                  // Stop and restart to reset the audio buffer
                  whisperRef.current.stopRecording()
                  await whisperRef.current.startRecording()
                }
              }
            }, 3000)  // 3 seconds of silence
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
    // Destroy existing transcriber so it reloads with new model
    if (whisperRef.current) {
      whisperRef.current.destroy()
      whisperRef.current = null
      setIsModelLoaded(false)
    }
    saveVoiceSetting('whisperModel', model as unknown as number) // Cast for now
  }, [saveVoiceSetting])

  // Start recording and transcribing
  const startRecording = useCallback(async (onTranscription: (text: string) => void) => {
    if (isRecording) return

    // Store the callback and clear previous transcription
    onTranscriptionRef.current = onTranscription
    finalTranscriptionRef.current = ''
    setCurrentTranscription('')

    // Clear any existing silence timer
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }

    // Initialize Whisper if needed
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
    } catch (error: any) {
      console.error('Failed to start recording:', error)
      // If microphone permission denied, show alert
      if (error.message?.includes('Permission denied') || error.name === 'NotAllowedError') {
        alert('Microphone access denied. Please allow microphone access in your browser/system settings.')
      }
    }
  }, [isRecording, initWhisper])

  // Stop recording
  const stopRecording = useCallback(() => {
    if (!isRecording || !whisperRef.current) return

    // Clear silence timer
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }

    whisperRef.current.stopRecording()
    setIsRecording(false)
    isRecordingRef.current = false

    // Call the callback with the final accumulated transcription
    if (onTranscriptionRef.current && finalTranscriptionRef.current.trim()) {
      onTranscriptionRef.current(finalTranscriptionRef.current.trim())
    }

    // Clear refs
    onTranscriptionRef.current = null
    finalTranscriptionRef.current = ''
    setCurrentTranscription('')
  }, [isRecording])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel any running processQueue
      processingGenerationRef.current++
      // Unblock any hung audio promise
      if (audioResolveRef.current) {
        audioResolveRef.current()
        audioResolveRef.current = null
      }
      // Clean up audio element and blob URL
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current)
        audioUrlRef.current = null
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
      }
      if (whisperRef.current) {
        whisperRef.current.destroy()
        whisperRef.current = null
      }
    }
  }, [])

  const value = useMemo(() => ({
    // Voice Output
    voiceOutputEnabled,
    setVoiceOutputEnabled,
    speakText,
    stopSpeaking,
    isSpeaking,
    volume,
    setVolume,
    speed,
    setSpeed,
    skipOnNew,
    setSkipOnNew,
    setProjectVoice,
    // Voice Input
    isRecording,
    isModelLoading,
    isModelLoaded,
    modelLoadProgress,
    modelLoadStatus,
    currentTranscription,
    whisperModel,
    setWhisperModel,
    startRecording,
    stopRecording
  }), [
    voiceOutputEnabled,
    setVoiceOutputEnabled,
    speakText,
    stopSpeaking,
    isSpeaking,
    volume,
    setVolume,
    speed,
    setSpeed,
    skipOnNew,
    setSkipOnNew,
    setProjectVoice,
    isRecording,
    isModelLoading,
    isModelLoaded,
    modelLoadProgress,
    modelLoadStatus,
    currentTranscription,
    whisperModel,
    setWhisperModel,
    startRecording,
    stopRecording
  ])

  return (
    <VoiceContext.Provider value={value}>
      {children}
    </VoiceContext.Provider>
  )
}

export function useVoice() {
  const context = useContext(VoiceContext)
  if (!context) {
    throw new Error('useVoice must be used within a VoiceProvider')
  }
  return context
}
