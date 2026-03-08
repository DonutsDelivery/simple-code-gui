import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useVoice } from '../contexts/VoiceContext'

interface VoiceControlsProps {
  activeTabId: string | null
  onTranscription: (text: string) => void
}

export function VoiceControls({
  activeTabId,
  onTranscription
}: VoiceControlsProps) {
  const {
    // Voice Output
    voiceOutputEnabled, setVoiceOutputEnabled, isSpeaking, stopSpeaking, volume,
    // Voice Input
    isRecording, isModelLoading, isModelLoaded, modelLoadProgress, modelLoadStatus,
    currentTranscription, startRecording, stopRecording,
    audioLevel, silenceThreshold, setSilenceThreshold
  } = useVoice()

  const [ttsInstalled, setTtsInstalled] = useState(false)
  const [installingTTS, setInstallingTTS] = useState(false)
  const [showLevelMeter, setShowLevelMeter] = useState(false)

  // Use ref to always have latest activeTabId for transcription callback
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

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

  const handleVoiceInput = async () => {
    if (isModelLoading) return

    if (isRecording) {
      // Stop recording
      stopRecording()
    } else {
      // Start recording - model will auto-load if needed
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
        return `Recording: "${currentTranscription}" (auto-submits after silence)`
      }
      return 'Listening... (speak now)'
    }
    return 'Click to start voice input'
  }

  return (
    <>
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
        <button
          className={`action-icon-btn ${isRecording ? 'enabled recording' : ''} ${isModelLoading ? 'installing' : ''}`}
          onClick={handleVoiceInput}
          disabled={isModelLoading}
          tabIndex={-1}
          title={getVoiceInputTitle()}
        >
          {isModelLoading ? '\u23F3' : isRecording ? '\u23F9\uFE0F' : '\uD83C\uDFA4'}
        </button>

        {showLevelMeter && (
          <div className="voice-level-meter" title={`Level: ${audioLevel}% | Threshold: ${silenceThreshold}%`}>
            <div className="voice-level-bar-bg">
              <div
                className="voice-level-bar-fill"
                style={{
                  height: `${audioLevel}%`,
                  backgroundColor: audioLevel > silenceThreshold ? 'var(--accent, #58a6ff)' : 'var(--text-muted, #666)'
                }}
              />
              <div
                className="voice-level-threshold"
                style={{ bottom: `${silenceThreshold}%` }}
              />
            </div>
            <input
              type="range"
              className="voice-threshold-slider"
              min="0"
              max="50"
              value={silenceThreshold}
              onChange={(e) => setSilenceThreshold(Number(e.target.value))}
              title={`Silence threshold: ${silenceThreshold}%`}
            />
          </div>
        )}
      </div>

      <button
        className={`action-icon-btn ${voiceOutputEnabled ? 'enabled' : ''} ${installingTTS ? 'installing' : ''}`}
        onClick={handleVoiceOutput}
        disabled={installingTTS}
        tabIndex={-1}
        title={installingTTS ? 'Installing Piper...' : ttsInstalled ? (voiceOutputEnabled ? 'Disable voice output' : 'Enable voice output') : 'Click to install Piper'}
      >
        {installingTTS ? '\u23F3' : '\uD83D\uDD0A'}
      </button>
    </>
  )
}
