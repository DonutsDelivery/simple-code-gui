// Voice Manager - coordinates TTS and STT functionality

import * as fs from 'fs'

import { xttsManager } from './xtts-manager.js'
import { voiceSettingsPath } from './voice/paths.js'
import { logTTS } from './voice/debug.js'
import {
  getAnyVoicePath,
  getInstalledVoices,
  getCustomVoicesDir,
  importCustomVoiceFiles,
  removeCustomVoice,
  getInstalledPiperVoices
} from './voice/voice-discovery.js'
import { fetchVoicesCatalog, downloadVoiceFromCatalog } from './voice/voice-catalog.js'
import {
  checkTTS,
  installPiper,
  downloadPiperVoice,
  speak as piperSpeak,
  stopSpeaking as piperStopSpeaking,
  isPiperInstalled
} from './voice/piper-tts.js'
import {
  checkWhisper,
  downloadWhisperModel,
  transcribe,
  isWhisperModelInstalled,
  getInstalledWhisperModels
} from './voice/whisper-stt.js'
import type {
  WhisperModelName,
  PiperVoiceName,
  WhisperStatus,
  TTSStatus,
  VoiceSettings,
  VoiceCatalogEntry,
  InstalledVoice,
  ProgressCallback
} from './voice/types.js'

// Re-export types and constants for backwards compatibility
export { WHISPER_MODELS, PIPER_VOICES } from './voice/types.js'
export type {
  WhisperModelName,
  PiperVoiceName,
  WhisperStatus,
  TTSStatus,
  VoiceSettings,
  VoiceCatalogEntry,
  InstalledVoice,
  CustomVoiceMetadata
} from './voice/types.js'

class VoiceManager {
  private currentWhisperModel: WhisperModelName = 'base.en'
  private currentTTSVoice: string = 'en_US-libritts_r-medium'
  private currentTTSEngine: 'piper' | 'xtts' = 'piper'
  private currentXTTSVoice: string | null = null
  private currentTTSSpeed: number = 1.0
  // XTTS quality settings
  private xttsTemperature: number = 0.65
  private xttsTopK: number = 50
  private xttsTopP: number = 0.85
  private xttsRepetitionPenalty: number = 2.0

  constructor() {
    this.loadPersistedSettings()
  }

  private loadPersistedSettings(): void {
    try {
      if (fs.existsSync(voiceSettingsPath)) {
        const data = JSON.parse(fs.readFileSync(voiceSettingsPath, 'utf-8'))
        if (data.whisperModel) this.currentWhisperModel = data.whisperModel
        if (data.ttsVoice) this.currentTTSVoice = data.ttsVoice
        if (data.ttsEngine) this.currentTTSEngine = data.ttsEngine
        if (data.xttsVoice) this.currentXTTSVoice = data.xttsVoice
        if (data.ttsSpeed !== undefined) this.currentTTSSpeed = data.ttsSpeed
        if (data.xttsTemperature !== undefined) this.xttsTemperature = data.xttsTemperature
        if (data.xttsTopK !== undefined) this.xttsTopK = data.xttsTopK
        if (data.xttsTopP !== undefined) this.xttsTopP = data.xttsTopP
        if (data.xttsRepetitionPenalty !== undefined) this.xttsRepetitionPenalty = data.xttsRepetitionPenalty
      }
    } catch (e) {
      console.error('Failed to load voice settings:', e)
    }
  }

  private savePersistedSettings(): void {
    try {
      const data = {
        whisperModel: this.currentWhisperModel,
        ttsVoice: this.currentTTSVoice,
        ttsEngine: this.currentTTSEngine,
        xttsVoice: this.currentXTTSVoice,
        ttsSpeed: this.currentTTSSpeed,
        xttsTemperature: this.xttsTemperature,
        xttsTopK: this.xttsTopK,
        xttsTopP: this.xttsTopP,
        xttsRepetitionPenalty: this.xttsRepetitionPenalty
      }
      fs.writeFileSync(voiceSettingsPath, JSON.stringify(data, null, 2))
    } catch (e) {
      console.error('Failed to save voice settings:', e)
    }
  }

  // ==================== WHISPER (STT) ====================

  async checkWhisper(): Promise<WhisperStatus> {
    const status = await checkWhisper(this.currentWhisperModel)
    if (status.currentModel && status.currentModel !== this.currentWhisperModel) {
      this.currentWhisperModel = status.currentModel
    }
    return status
  }

  async downloadWhisperModel(
    model: WhisperModelName,
    onProgress?: ProgressCallback
  ): Promise<{ success: boolean; error?: string }> {
    const result = await downloadWhisperModel(model, onProgress)
    if (result.success) {
      this.currentWhisperModel = model
    }
    return result
  }

  setWhisperModel(model: WhisperModelName): void {
    if (isWhisperModelInstalled(model)) {
      this.currentWhisperModel = model
    }
  }

  async transcribe(
    pcmData: Float32Array,
    sampleRate: number = 16000
  ): Promise<{ success: boolean; text?: string; error?: string }> {
    const result = await transcribe(pcmData, sampleRate, this.currentWhisperModel)
    // Update current model if it changed
    const installed = getInstalledWhisperModels()
    if (installed.length > 0 && !isWhisperModelInstalled(this.currentWhisperModel)) {
      this.currentWhisperModel = installed[0]
    }
    return result
  }

  // ==================== PIPER (TTS) ====================

  async checkTTS(): Promise<TTSStatus> {
    return checkTTS(this.currentTTSVoice)
  }

  async getFullVoiceStatus(): Promise<{ whisper: WhisperStatus; tts: TTSStatus }> {
    const [whisper, tts] = await Promise.all([
      this.checkWhisper(),
      this.checkTTS()
    ])
    return { whisper, tts }
  }

  async installPiper(onProgress?: ProgressCallback): Promise<{ success: boolean; error?: string }> {
    return installPiper(onProgress)
  }

  async downloadPiperVoice(
    voice: PiperVoiceName,
    onProgress?: ProgressCallback
  ): Promise<{ success: boolean; error?: string }> {
    const result = await downloadPiperVoice(voice, onProgress)
    if (result.success) {
      this.currentTTSVoice = voice
    }
    return result
  }

  setTTSVoice(voice: string, engine?: 'piper' | 'xtts'): void {
    if (engine === 'xtts') {
      this.currentXTTSVoice = voice
      this.currentTTSEngine = 'xtts'
      this.savePersistedSettings()
    } else if (getAnyVoicePath(voice)) {
      this.currentTTSVoice = voice
      this.currentTTSEngine = 'piper'
      this.savePersistedSettings()
    }
  }

  setTTSEngine(engine: 'piper' | 'xtts'): void {
    this.currentTTSEngine = engine
  }

  getCurrentEngine(): 'piper' | 'xtts' {
    return this.currentTTSEngine
  }

  setTTSSpeed(speed: number): void {
    this.currentTTSSpeed = Math.max(0.5, Math.min(2.0, speed))
  }

  async speak(text: string): Promise<{ success: boolean; audioData?: string; error?: string }> {
    logTTS('speak() called', {
      textLength: text.length,
      text: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
      engine: this.currentTTSEngine,
      voice: this.currentTTSVoice,
      speed: this.currentTTSSpeed
    })

    // Route to XTTS if that's the current engine AND we have an XTTS voice selected
    if (this.currentTTSEngine === 'xtts' && this.currentXTTSVoice) {
      logTTS('Routing to XTTS')
      return xttsManager.speak(text, this.currentXTTSVoice, undefined, {
        temperature: this.xttsTemperature,
        speed: this.currentTTSSpeed,
        topK: this.xttsTopK,
        topP: this.xttsTopP,
        repetitionPenalty: this.xttsRepetitionPenalty
      })
    }

    // Use Piper TTS
    return piperSpeak(text, this.currentTTSVoice, this.currentTTSSpeed)
  }

  stopSpeaking(): void {
    piperStopSpeaking()
    xttsManager.stopSpeaking()
  }

  // ==================== VOICE CATALOG ====================

  async fetchVoicesCatalog(forceRefresh: boolean = false): Promise<VoiceCatalogEntry[]> {
    return fetchVoicesCatalog(forceRefresh)
  }

  async downloadVoiceFromCatalog(
    voiceKey: string,
    onProgress?: ProgressCallback
  ): Promise<{ success: boolean; error?: string }> {
    return downloadVoiceFromCatalog(voiceKey, onProgress)
  }

  getInstalledVoices(): InstalledVoice[] {
    return getInstalledVoices()
  }

  getAnyVoicePath(voiceKey: string): { model: string; config: string } | null {
    return getAnyVoicePath(voiceKey)
  }

  // ==================== CUSTOM VOICE IMPORT ====================

  getCustomVoicesDir(): string {
    return getCustomVoicesDir()
  }

  async importCustomVoiceFiles(
    onnxPath: string,
    configPath: string,
    displayName?: string
  ): Promise<{ success: boolean; voiceKey?: string; error?: string }> {
    return importCustomVoiceFiles(onnxPath, configPath, displayName)
  }

  removeCustomVoice(voiceKey: string): { success: boolean; error?: string } {
    return removeCustomVoice(voiceKey)
  }

  // ==================== SETTINGS ====================

  getSettings(): VoiceSettings {
    const activeVoice = this.currentTTSEngine === 'xtts' && this.currentXTTSVoice
      ? this.currentXTTSVoice
      : this.currentTTSVoice

    return {
      whisperModel: this.currentWhisperModel,
      ttsEngine: this.currentTTSEngine,
      ttsVoice: activeVoice,
      ttsSpeed: this.currentTTSSpeed,
      microphoneId: null,
      readBehavior: 'immediate',
      skipOnNew: false,
      xttsTemperature: this.xttsTemperature,
      xttsTopK: this.xttsTopK,
      xttsTopP: this.xttsTopP,
      xttsRepetitionPenalty: this.xttsRepetitionPenalty
    }
  }

  applySettings(settings: Partial<VoiceSettings>): void {
    if (settings.whisperModel) {
      this.setWhisperModel(settings.whisperModel)
    }
    if (settings.ttsEngine) {
      this.setTTSEngine(settings.ttsEngine)
    }
    if (settings.ttsVoice) {
      this.setTTSVoice(settings.ttsVoice, settings.ttsEngine)
    }
    if (settings.ttsSpeed !== undefined) {
      this.setTTSSpeed(settings.ttsSpeed)
    }
    if (settings.xttsTemperature !== undefined) {
      this.xttsTemperature = Math.max(0.1, Math.min(1.0, settings.xttsTemperature))
    }
    if (settings.xttsTopK !== undefined) {
      this.xttsTopK = Math.max(1, Math.min(100, Math.round(settings.xttsTopK)))
    }
    if (settings.xttsTopP !== undefined) {
      this.xttsTopP = Math.max(0.1, Math.min(1.0, settings.xttsTopP))
    }
    if (settings.xttsRepetitionPenalty !== undefined) {
      this.xttsRepetitionPenalty = Math.max(1.0, Math.min(10.0, settings.xttsRepetitionPenalty))
    }
    this.savePersistedSettings()
  }

  // ==================== LEGACY API COMPATIBILITY ====================
  // These methods delegate to the discovery module but are kept for API compatibility

  getWhisperModelPath(model: WhisperModelName): string {
    const { getWhisperModelPath } = require('./voice/whisper-stt.js')
    return getWhisperModelPath(model)
  }

  isWhisperModelInstalled(model: WhisperModelName): boolean {
    return isWhisperModelInstalled(model)
  }

  getInstalledWhisperModels(): WhisperModelName[] {
    return getInstalledWhisperModels()
  }

  getPiperBinaryPath(): string | null {
    const { getPiperBinaryPath } = require('./voice/piper-tts.js')
    return getPiperBinaryPath()
  }

  isPiperInstalled(): boolean {
    return isPiperInstalled()
  }

  getPiperVoicePath(voice: string): { model: string; config: string } | null {
    const { getPiperVoicePath } = require('./voice/voice-discovery.js')
    return getPiperVoicePath(voice)
  }

  getInstalledPiperVoices(): string[] {
    return getInstalledPiperVoices()
  }
}

export const voiceManager = new VoiceManager()
