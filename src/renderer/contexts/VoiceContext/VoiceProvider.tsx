import React, { createContext, useEffect, useState, useMemo, useCallback } from 'react'
import type { VoiceContextValue } from './types.js'
import { useTTSHandlers } from './ttsHandlers.js'
import { useSTTHandlers } from './sttHandlers.js'

export const VoiceContext = createContext<VoiceContextValue | null>(null)

export function VoiceProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  // Initialize TTS handlers
  const tts = useTTSHandlers({ settingsLoaded })

  // Create save function for STT handlers
  const saveVoiceSetting = useCallback(async (key: string, value: boolean | number | string) => {
    if (!settingsLoaded || !window.electronAPI) return
    const settings = await window.electronAPI?.getSettings()
    await window.electronAPI?.saveSettings({ ...settings, [key]: value })
  }, [settingsLoaded])

  // Initialize STT handlers
  const stt = useSTTHandlers({ saveVoiceSetting })

  // Load settings on mount
  useEffect(() => {
    if (!window.electronAPI) {
      setSettingsLoaded(true)
      return
    }
    window.electronAPI?.getSettings().then((settings) => {
      if (settings.voiceOutputEnabled !== undefined) tts.setVoiceOutputEnabledState(settings.voiceOutputEnabled)
      if (settings.voiceVolume !== undefined) tts.setVolumeState(settings.voiceVolume)
      if (settings.voiceSpeed !== undefined) {
        tts.setSpeedState(settings.voiceSpeed)
        window.electronAPI?.voiceApplySettings?.({ ttsSpeed: settings.voiceSpeed })
      }
      if (settings.voiceSkipOnNew !== undefined) tts.setSkipOnNewState(settings.voiceSkipOnNew)
      setSettingsLoaded(true)
    }).catch(() => setSettingsLoaded(true))

    // Load global voice settings for project override feature
    window.electronAPI?.voiceGetSettings?.()?.then((voiceSettings) => {
      if (voiceSettings) {
        tts.refs.globalVoiceRef.current = {
          voice: voiceSettings.ttsVoice || '',
          engine: voiceSettings.ttsEngine || 'piper'
        }
      }
    })?.catch(e => console.error('Failed to load global voice settings:', e))
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel any running processQueue
      tts.refs.processingGenerationRef.current++
      // Unblock any hung audio promise
      if (tts.refs.audioResolveRef.current) {
        tts.refs.audioResolveRef.current()
        tts.refs.audioResolveRef.current = null
      }
      // Clean up audio element and blob URL
      if (tts.refs.audioRef.current) {
        tts.refs.audioRef.current.pause()
        tts.refs.audioRef.current = null
      }
      if (tts.refs.audioUrlRef.current) {
        URL.revokeObjectURL(tts.refs.audioUrlRef.current)
        tts.refs.audioUrlRef.current = null
      }
      if (stt.refs.silenceTimerRef.current) {
        clearTimeout(stt.refs.silenceTimerRef.current)
      }
      if (stt.refs.whisperRef.current) {
        stt.refs.whisperRef.current.destroy()
        stt.refs.whisperRef.current = null
      }
    }
  }, [])

  const value = useMemo((): VoiceContextValue => ({
    // Voice Output
    voiceOutputEnabled: tts.voiceOutputEnabled,
    setVoiceOutputEnabled: tts.setVoiceOutputEnabled,
    speakText: tts.speakText,
    stopSpeaking: tts.stopSpeaking,
    isSpeaking: tts.isSpeaking,
    volume: tts.volume,
    setVolume: tts.setVolume,
    speed: tts.speed,
    setSpeed: tts.setSpeed,
    skipOnNew: tts.skipOnNew,
    setSkipOnNew: tts.setSkipOnNew,
    setProjectVoice: tts.setProjectVoice,
    // Voice Input
    isRecording: stt.isRecording,
    isModelLoading: stt.isModelLoading,
    isModelLoaded: stt.isModelLoaded,
    modelLoadProgress: stt.modelLoadProgress,
    modelLoadStatus: stt.modelLoadStatus,
    currentTranscription: stt.currentTranscription,
    whisperModel: stt.whisperModel,
    setWhisperModel: stt.setWhisperModel,
    startRecording: stt.startRecording,
    stopRecording: stt.stopRecording
  }), [
    tts.voiceOutputEnabled,
    tts.setVoiceOutputEnabled,
    tts.speakText,
    tts.stopSpeaking,
    tts.isSpeaking,
    tts.volume,
    tts.setVolume,
    tts.speed,
    tts.setSpeed,
    tts.skipOnNew,
    tts.setSkipOnNew,
    tts.setProjectVoice,
    stt.isRecording,
    stt.isModelLoading,
    stt.isModelLoaded,
    stt.modelLoadProgress,
    stt.modelLoadStatus,
    stt.currentTranscription,
    stt.whisperModel,
    stt.setWhisperModel,
    stt.startRecording,
    stt.stopRecording
  ])

  return (
    <VoiceContext.Provider value={value}>
      {children}
    </VoiceContext.Provider>
  )
}
