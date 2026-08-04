import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useVoice } from '../contexts/VoiceContext'

interface VoiceControlsProps {
  activeTabId: string | null
  onTranscription: (text: string) => void
  children: (controls: VoiceControlState) => React.ReactNode
}

export interface VoiceControlState {
  isRecording: boolean
  isModelLoading: boolean
  voiceInputTitle: string
  handleVoiceInput: () => Promise<void>
  showLevelMeter: boolean
  audioLevel: number
  silenceThreshold: number
  setSilenceThreshold: (value: number) => void
  pushToTalkEnabled: boolean
  togglePushToTalk: () => void
  voiceOutputEnabled: boolean
  installingTTS: boolean
  ttsInstalled: boolean
  handleVoiceOutput: () => Promise<void>
}

export function VoiceControls({
  activeTabId,
  onTranscription,
  children,
}: VoiceControlsProps) {
  const {
    // Voice Output
    voiceOutputEnabled, setVoiceOutputEnabled, isSpeaking, stopSpeaking, volume,
    // Voice Input
    isRecording, isModelLoading, isModelLoaded, modelLoadProgress, modelLoadStatus,
    currentTranscription, startRecording, stopRecording,
    audioLevel, silenceThreshold, setSilenceThreshold,
    // Push-to-Talk
    pushToTalkEnabled, setPushToTalkEnabled
  } = useVoice()

  const [ttsInstalled, setTtsInstalled] = useState(false)
  const [installingTTS, setInstallingTTS] = useState(false)
  const [showLevelMeter, setShowLevelMeter] = useState(false)

  // Use ref to always have latest activeTabId for transcription callback
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  // Refs for PTT state to avoid stale closures in event listeners
  const pttEnabledRef = useRef(pushToTalkEnabled)
  const isRecordingRef = useRef(isRecording)
  const isModelLoadingRef = useRef(isModelLoading)
  const pttActiveRef = useRef(false) // true while PTT key is held

  useEffect(() => { pttEnabledRef.current = pushToTalkEnabled }, [pushToTalkEnabled])
  useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])
  useEffect(() => { isModelLoadingRef.current = isModelLoading }, [isModelLoading])

  useEffect(() => {
    checkInstallation()

    const cleanup = window.electronAPI?.onInstallProgress?.((data) => {
      if ((data.type === 'piper' || data.type === 'piper-voice') && data.percent === 100) {
        setInstallingTTS(false)
        checkInstallation()
      }
    })
    return cleanup
  }, [])

  // Show level meter while recording
  useEffect(() => {
    if (isRecording) {
      setShowLevelMeter(true)
    } else {
      // Delay hiding to avoid flicker
      const timer = setTimeout(() => setShowLevelMeter(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isRecording])

  const checkInstallation = async () => {
    try {
      const ttsStatus = await window.electronAPI?.voiceCheckTTS?.()
      setTtsInstalled(ttsStatus?.installed ?? false)
    } catch (e) {
      // Voice features not available
    }
  }

  // Handle transcription callback - accumulate text while recording
  const handleTranscription = useCallback((text: string) => {
    onTranscription(text)
  }, [onTranscription])

  // Stable ref for transcription callback used by PTT
  const handleTranscriptionRef = useRef(handleTranscription)
  useEffect(() => { handleTranscriptionRef.current = handleTranscription }, [handleTranscription])

  // Push-to-Talk keyboard handler (Ctrl+Space)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!pttEnabledRef.current) return
      if (e.code !== 'Space' || !e.ctrlKey) return
      if (e.repeat) return // Ignore key repeat
      if (isModelLoadingRef.current) return

      e.preventDefault()
      e.stopPropagation()

      if (!isRecordingRef.current && !pttActiveRef.current) {
        pttActiveRef.current = true
        startRecording(handleTranscriptionRef.current)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!pttEnabledRef.current) return
      if (e.code !== 'Space') return
      if (!pttActiveRef.current) return

      e.preventDefault()
      e.stopPropagation()

      pttActiveRef.current = false
      if (isRecordingRef.current) {
        stopRecording()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [startRecording, stopRecording])

  const handleVoiceInput = async () => {
    if (isModelLoading) return

    if (isRecording) {
      stopRecording()
    } else {
      await startRecording(handleTranscription)
    }
  }

  const handleVoiceOutput = async () => {
    if (installingTTS) return

    if (!ttsInstalled) {
      setInstallingTTS(true)
      try {
        const result = await window.electronAPI?.voiceInstallPiper?.()
        if (result?.success) {
          await window.electronAPI?.voiceInstallVoice?.('en_US-libritts_r-medium')
        }
        await checkInstallation()
      } catch (e) {
        console.error('Failed to install Piper:', e)
      }
      setInstallingTTS(false)
    } else {
      // If currently speaking, stop; otherwise toggle
      if (isSpeaking) {
        stopSpeaking()
      }
      const newState = !voiceOutputEnabled
      setVoiceOutputEnabled(newState)

      // Test TTS when enabling
      if (newState) {
        console.log('Testing TTS...')
        window.electronAPI?.voiceSpeak?.('Voice output enabled. Hello!')
          .then(result => {
            console.log('TTS result:', result)
            if (result?.success && result.audioData) {
              const audioData = Uint8Array.from(atob(result.audioData), c => c.charCodeAt(0))
              const blob = new Blob([audioData], { type: 'audio/wav' })
              const url = URL.createObjectURL(blob)
              const audio = new Audio(url)
              audio.volume = volume
              audio.play().catch(e => console.error('Play failed:', e))
            }
          })
          .catch(e => console.error('TTS failed:', e))
      }
    }
  }

  // Determine voice input button state and title
  const getVoiceInputTitle = () => {
    if (isModelLoading) return `Loading Whisper model... ${modelLoadProgress}%`
    if (isRecording) {
      if (currentTranscription) {
        return `Recording: "${currentTranscription}" ${pushToTalkEnabled ? '(release Ctrl+Space to send)' : '(auto-submits after silence)'}`
      }
      return pushToTalkEnabled ? 'Listening... (release Ctrl+Space to send)' : 'Listening... (speak now)'
    }
    return pushToTalkEnabled ? 'Push-to-Talk: Hold Ctrl+Space to record' : 'Click to start voice input'
  }

  return children({
    isRecording,
    isModelLoading,
    voiceInputTitle: getVoiceInputTitle(),
    handleVoiceInput,
    showLevelMeter,
    audioLevel,
    silenceThreshold,
    setSilenceThreshold,
    pushToTalkEnabled,
    togglePushToTalk: () => setPushToTalkEnabled(!pushToTalkEnabled),
    voiceOutputEnabled,
    installingTTS,
    ttsInstalled,
    handleVoiceOutput,
  }) as React.ReactElement
}
