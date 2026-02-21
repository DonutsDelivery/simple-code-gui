import type { WhisperModelSize } from './types.js'

// HuggingFace URLs for all Whisper model sizes
export const WHISPER_MODEL_URLS: Record<WhisperModelSize, string> = {
  'tiny.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  'base.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  'small.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  'medium.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
  'large-v3': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin'
}

// Model sizes in MB
export const WHISPER_MODEL_SIZES: Record<WhisperModelSize, number> = {
  'tiny.en': 75,
  'base.en': 147,
  'small.en': 488,
  'medium.en': 1500,
  'large-v3': 3000
}
