import { useContext } from 'react'
import { VoiceContext, VoiceProvider } from './VoiceProvider.js'
import type { VoiceContextValue, WhisperModelSize, ProjectVoiceSettings } from './types.js'

export { VoiceProvider }
export type { VoiceContextValue, WhisperModelSize, ProjectVoiceSettings }

export function useVoice(): VoiceContextValue {
  const context = useContext(VoiceContext)
  if (!context) {
    throw new Error('useVoice must be used within a VoiceProvider')
  }
  return context
}
