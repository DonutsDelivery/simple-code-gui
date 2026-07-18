import type { AgentAttentionKind } from '../stores/workspace'

interface NotificationAudioContext {
  currentTime: number
  destination: AudioDestinationNode
  state: AudioContextState
  createOscillator: () => OscillatorNode
  createGain: () => GainNode
  resume: () => Promise<void>
}

let sharedContext: NotificationAudioContext | null = null

function getAudioContext(): NotificationAudioContext | null {
  if (sharedContext) return sharedContext
  const Context = globalThis.AudioContext
  if (!Context) return null
  sharedContext = new Context()
  return sharedContext
}

export function playAgentNotificationSound(
  kind: AgentAttentionKind,
  volume: number,
  context?: NotificationAudioContext | null,
): void {
  const level = Math.max(0, Math.min(1, volume))
  if (level === 0) return
  try {
    const audioContext = context === undefined ? getAudioContext() : context
    if (!audioContext) return
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {})

    const notes = kind === 'completed'
      ? [{ frequency: 523.25, offset: 0, duration: 0.16 }, { frequency: 659.25, offset: 0.14, duration: 0.24 }]
      : [{ frequency: 659.25, offset: 0, duration: 0.12 }, { frequency: 659.25, offset: 0.2, duration: 0.16 }]

    for (const note of notes) {
      const start = audioContext.currentTime + note.offset
      const stop = start + note.duration
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(note.frequency, start)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level * 0.18), start + 0.018)
      gain.gain.exponentialRampToValueAtTime(0.0001, stop)
      oscillator.connect(gain)
      gain.connect(audioContext.destination)
      oscillator.start(start)
      oscillator.stop(stop + 0.01)
    }
  } catch {
    // Notification highlights remain authoritative when audio is unavailable.
  }
}
