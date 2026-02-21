// WhisperTranscriber instance interface for type safety
export interface WhisperInstance {
  loadModel(): Promise<void>
  startRecording(): Promise<void>
  stopRecording(): void
  destroy(): void
}

// WhisperTranscriber config - modelSize accepts string (library has loose typing)
export interface WhisperTranscriberConfig {
  modelUrl: string
  modelSize: string  // Library accepts any string, we pass our WhisperModelSize
  onTranscription: (text: string) => void
  onProgress?: (progress: number) => void
  onStatus?: (status: string) => void
  maxRecordingTime?: number
  debug?: boolean
}

// Map to HuggingFace URLs for all Whisper model sizes
export type WhisperModelSize = 'tiny.en' | 'base.en' | 'small.en' | 'medium.en' | 'large-v3'

export interface ProjectVoiceSettings {
  ttsVoice?: string
  ttsEngine?: 'piper' | 'xtts'
}

export interface VoiceContextValue {
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

// TTS refs interface for handler functions
export interface TTSRefs {
  audioRef: React.MutableRefObject<HTMLAudioElement | null>
  audioUrlRef: React.MutableRefObject<string | null>
  speakQueueRef: React.MutableRefObject<string[]>
  isProcessingRef: React.MutableRefObject<boolean>
  voiceOutputEnabledRef: React.MutableRefObject<boolean>
  skipOnNewRef: React.MutableRefObject<boolean>
  volumeRef: React.MutableRefObject<number>
  processingGenerationRef: React.MutableRefObject<number>
  audioResolveRef: React.MutableRefObject<(() => void) | null>
  projectVoiceRef: React.MutableRefObject<ProjectVoiceSettings | null>
  globalVoiceRef: React.MutableRefObject<{ voice: string; engine: string } | null>
}

// STT refs interface for handler functions
export interface STTRefs {
  whisperRef: React.MutableRefObject<WhisperInstance | null>
  onTranscriptionRef: React.MutableRefObject<((text: string) => void) | null>
  finalTranscriptionRef: React.MutableRefObject<string>
  silenceTimerRef: React.MutableRefObject<NodeJS.Timeout | null>
  isRecordingRef: React.MutableRefObject<boolean>
}
