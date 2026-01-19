// Voice manager types

export const WHISPER_MODELS = {
  'tiny.en': { file: 'ggml-tiny.en.bin', size: 75, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin' },
  'base.en': { file: 'ggml-base.en.bin', size: 147, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin' },
  'small.en': { file: 'ggml-small.en.bin', size: 488, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin' },
  'medium.en': { file: 'ggml-medium.en.bin', size: 1500, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin' },
  'large-v3': { file: 'ggml-large-v3.bin', size: 3000, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin' }
} as const

export type WhisperModelName = keyof typeof WHISPER_MODELS

// Piper voices - only CC0/CC-BY licensed (commercially safe)
export const PIPER_VOICES = {
  'en_US-libritts_r-medium': {
    file: 'en_US-libritts_r-medium.onnx',
    config: 'en_US-libritts_r-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx.json',
    license: 'CC-BY-4.0',
    description: 'LibriTTS-R (US English)'
  },
  'en_GB-jenny_dioco-medium': {
    file: 'en_GB-jenny_dioco-medium.onnx',
    config: 'en_GB-jenny_dioco-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx.json',
    license: 'CC0',
    description: 'Jenny DioCo (British)'
  },
  'en_US-ryan-medium': {
    file: 'en_US-ryan-medium.onnx',
    config: 'en_US-ryan-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx.json',
    license: 'CC-BY-4.0',
    description: 'Ryan (US English male)'
  },
  'en_US-amy-medium': {
    file: 'en_US-amy-medium.onnx',
    config: 'en_US-amy-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json',
    license: 'CC-BY-4.0',
    description: 'Amy (US English female)'
  },
  'en_US-arctic-medium': {
    file: 'en_US-arctic-medium.onnx',
    config: 'en_US-arctic-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/arctic/medium/en_US-arctic-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/arctic/medium/en_US-arctic-medium.onnx.json',
    license: 'CC0',
    description: 'Arctic (US English, multi-speaker)'
  },
  'en_GB-alan-medium': {
    file: 'en_GB-alan-medium.onnx',
    config: 'en_GB-alan-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json',
    license: 'CC-BY-4.0',
    description: 'Alan (British male)'
  }
} as const

export type PiperVoiceName = keyof typeof PIPER_VOICES

export interface WhisperStatus {
  installed: boolean
  models: WhisperModelName[]
  currentModel: WhisperModelName | null
}

export interface TTSStatus {
  installed: boolean
  engine: 'piper' | 'xtts' | null
  voices: string[]
  currentVoice: string | null
}

export interface VoiceSettings {
  whisperModel: WhisperModelName
  ttsEngine: 'piper' | 'xtts'
  ttsVoice: string
  ttsSpeed: number
  microphoneId: string | null
  readBehavior: 'immediate' | 'pause' | 'manual'
  skipOnNew: boolean
  xttsTemperature: number
  xttsTopK: number
  xttsTopP: number
  xttsRepetitionPenalty: number
}

export interface VoiceCatalogEntry {
  key: string
  name: string
  language: {
    code: string
    family: string
    region: string
    name_native: string
    name_english: string
    country_english: string
  }
  quality: 'x_low' | 'low' | 'medium' | 'high'
  num_speakers: number
  speaker_id_map: Record<string, number>
  files: Record<string, { size_bytes: number; md5_digest: string }>
  aliases: string[]
}

export interface InstalledVoice {
  key: string
  displayName: string
  source: 'builtin' | 'downloaded' | 'custom'
  quality?: string
  language?: string
}

export interface CustomVoiceMetadata {
  voices: {
    [key: string]: {
      displayName: string
      addedAt: number
    }
  }
}

export interface VoicePaths {
  model: string
  config: string
}

export type ProgressCallback = (status: string, percent?: number) => void
