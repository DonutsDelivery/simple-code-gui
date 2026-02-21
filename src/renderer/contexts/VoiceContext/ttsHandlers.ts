import { useCallback, useMemo, useRef, useEffect, useState } from 'react'
import type { ProjectVoiceSettings, TTSRefs } from './types.js'

export interface UseTTSHandlersOptions {
  settingsLoaded: boolean
}

export interface UseTTSHandlersResult {
  // State
  voiceOutputEnabled: boolean
  isSpeaking: boolean
  volume: number
  speed: number
  skipOnNew: boolean

  // Setters
  setVoiceOutputEnabled: (enabled: boolean) => void
  setVolume: (volume: number) => void
  setSpeed: (speed: number) => void
  setSkipOnNew: (skip: boolean) => void
  setProjectVoice: (settings: ProjectVoiceSettings | null) => void

  // Actions
  speakText: (text: string) => void
  stopSpeaking: () => void

  // Refs for external use
  refs: TTSRefs

  // State setters for settings loading
  setVoiceOutputEnabledState: (enabled: boolean) => void
  setVolumeState: (volume: number) => void
  setSpeedState: (speed: number) => void
  setSkipOnNewState: (skip: boolean) => void
}

export function useTTSHandlers({ settingsLoaded }: UseTTSHandlersOptions): UseTTSHandlersResult {
  // Voice Output (TTS) state
  const [voiceOutputEnabled, setVoiceOutputEnabledState] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [volume, setVolumeState] = useState(1.0)
  const [speed, setSpeedState] = useState(1.0)
  const [skipOnNew, setSkipOnNewState] = useState(false)

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const speakQueueRef = useRef<string[]>([])
  const isProcessingRef = useRef(false)
  const voiceOutputEnabledRef = useRef(voiceOutputEnabled)
  const skipOnNewRef = useRef(skipOnNew)
  const volumeRef = useRef(volume)
  const processingGenerationRef = useRef(0)
  const audioResolveRef = useRef<(() => void) | null>(null)
  const projectVoiceRef = useRef<ProjectVoiceSettings | null>(null)
  const globalVoiceRef = useRef<{ voice: string; engine: string } | null>(null)

  const refs: TTSRefs = {
    audioRef,
    audioUrlRef,
    speakQueueRef,
    isProcessingRef,
    voiceOutputEnabledRef,
    skipOnNewRef,
    volumeRef,
    processingGenerationRef,
    audioResolveRef,
    projectVoiceRef,
    globalVoiceRef
  }

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
    if (!settingsLoaded || !window.electronAPI) return
    const settings = await window.electronAPI?.getSettings()
    await window.electronAPI?.saveSettings({ ...settings, [key]: value })
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
    window.electronAPI?.voiceApplySettings?.({ ttsSpeed: clamped })
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
    if (settings?.ttsVoice && settings?.ttsEngine) {
      window.electronAPI?.voiceApplySettings?.({
        ttsVoice: settings.ttsVoice,
        ttsEngine: settings.ttsEngine
      })
    } else if (globalVoiceRef.current) {
      window.electronAPI?.voiceApplySettings?.({
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
      if (processingGenerationRef.current !== myGeneration) {
        return
      }

      const text = speakQueueRef.current.shift()
      if (!text) continue

      try {
        if (!window.electronAPI?.voiceSpeak) {
          continue
        }
        const result = await window.electronAPI?.voiceSpeak?.(text)

        if (processingGenerationRef.current !== myGeneration) {
          return
        }

        if (result?.success && result.audioData) {
          const base64Audio = result.audioData
          await new Promise<void>((resolve) => {
            audioResolveRef.current = resolve

            const audioData = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0))
            const blob = new Blob([audioData], { type: 'audio/wav' })
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            audio.volume = volumeRef.current
            audioRef.current = audio
            audioUrlRef.current = url

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

    if (processingGenerationRef.current === myGeneration) {
      isProcessingRef.current = false
      setIsSpeaking(false)
    }
  }, [])

  const speakText = useCallback((text: string) => {
    if (!voiceOutputEnabledRef.current) return

    const cleanText = text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    console.log('[TTS Debug] speakText called:', {
      originalLength: text.length,
      cleanedLength: cleanText.length,
      original: text.substring(0, 100),
      cleaned: cleanText.substring(0, 100)
    })

    if (cleanText.length < 3) return

    if (skipOnNewRef.current) {
      speakQueueRef.current = []
      processingGenerationRef.current++
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
    processingGenerationRef.current++
    if (audioResolveRef.current) {
      audioResolveRef.current()
      audioResolveRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    window.electronAPI?.voiceStopSpeaking?.()
    setIsSpeaking(false)
    isProcessingRef.current = false
  }, [])

  // Stop speaking when disabled
  useEffect(() => {
    if (!voiceOutputEnabled) {
      stopSpeaking()
    }
  }, [voiceOutputEnabled, stopSpeaking])

  return {
    voiceOutputEnabled,
    isSpeaking,
    volume,
    speed,
    skipOnNew,
    setVoiceOutputEnabled,
    setVolume,
    setSpeed,
    setSkipOnNew,
    setProjectVoice,
    speakText,
    stopSpeaking,
    refs,
    setVoiceOutputEnabledState,
    setVolumeState,
    setSpeedState,
    setSkipOnNewState
  }
}
