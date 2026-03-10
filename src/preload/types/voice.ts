export interface VoiceSettings {
  whisperModel?: string
  ttsEngine?: 'piper' | 'xtts'
  ttsVoice?: string
  ttsSpeed?: number
  microphoneId?: string | null
  readBehavior?: 'immediate' | 'pause' | 'manual'
  skipOnNew?: boolean
  xttsTemperature?: number
  xttsTopK?: number
  xttsTopP?: number
  xttsRepetitionPenalty?: number
}
