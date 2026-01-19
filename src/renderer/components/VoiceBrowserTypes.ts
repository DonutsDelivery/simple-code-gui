// Voice Browser shared types and interfaces

export interface VoiceCatalogEntry {
  key: string
  name: string
  language: {
    code: string
    name_english: string
    country_english: string
  }
  quality: string
  num_speakers: number
  files: Record<string, { size_bytes: number }>
}

export interface InstalledVoice {
  key: string
  displayName: string
  source: 'builtin' | 'downloaded' | 'custom'
  quality?: string
  language?: string
}

export interface XTTSVoice {
  id: string
  name: string
  language: string
  createdAt: number
}

export interface XTTSSampleVoice {
  id: string
  name: string
  language: string
  file: string
  installed: boolean
}

export interface XTTSLanguage {
  code: string
  name: string
}

// Extended HTMLAudioElement with custom stop function for clean cleanup
export interface ExtendedAudioElement extends HTMLAudioElement {
  _stop?: () => void
}

// Combined voice representation for the voice list
export interface CombinedVoice {
  key: string
  name: string
  language: string
  quality: string
  size: number
  engine: 'piper' | 'xtts'
  installed: boolean
  isDownloading: boolean
  createdAt?: number
}

export type ModelFilter = 'all' | 'piper' | 'xtts'
