import { ipcRenderer } from 'electron'
import type { VoiceSettings } from '../types/voice.js'

export const voiceHandlers = {
  // STT/TTS
  voiceCheckWhisper: () => ipcRenderer.invoke('voice:checkWhisper'),
  voiceInstallWhisper: (model: string) => ipcRenderer.invoke('voice:installWhisper', model),
  voiceTranscribe: (pcmData: Float32Array) => ipcRenderer.invoke('voice:transcribe', pcmData),
  voiceSetWhisperModel: (model: string) => ipcRenderer.invoke('voice:setWhisperModel', model),
  voiceCheckTTS: () => ipcRenderer.invoke('voice:checkTTS'),
  voiceGetFullStatus: () => ipcRenderer.invoke('voice:getFullStatus'),
  voiceInstallPiper: () => ipcRenderer.invoke('voice:installPiper'),
  voiceInstallVoice: (voice: string) => ipcRenderer.invoke('voice:installVoice', voice),
  voiceSpeak: (text: string) => ipcRenderer.invoke('voice:speak', text),
  voiceStopSpeaking: () => ipcRenderer.invoke('voice:stopSpeaking'),
  voiceGetVoices: () => ipcRenderer.invoke('voice:getVoices'),
  voiceGetWhisperModels: () => ipcRenderer.invoke('voice:getWhisperModels'),
  voiceSetVoice: (voice: string | { voice: string; engine: 'piper' | 'xtts' }) => ipcRenderer.invoke('voice:setVoice', voice),
  voiceGetSettings: (): Promise<VoiceSettings> => ipcRenderer.invoke('voice:getSettings'),
  voiceApplySettings: (settings: Partial<VoiceSettings>) => ipcRenderer.invoke('voice:applySettings', settings),

  // Voice catalog
  voiceFetchCatalog: (forceRefresh?: boolean) => ipcRenderer.invoke('voice:fetchCatalog', forceRefresh),
  voiceDownloadFromCatalog: (voiceKey: string) => ipcRenderer.invoke('voice:downloadFromCatalog', voiceKey),
  voiceGetInstalled: () => ipcRenderer.invoke('voice:getInstalled'),
  voiceImportCustom: () => ipcRenderer.invoke('voice:importCustom'),
  voiceRemoveCustom: (voiceKey: string) => ipcRenderer.invoke('voice:removeCustom', voiceKey),
  voiceOpenCustomFolder: () => ipcRenderer.invoke('voice:openCustomFolder'),

  // XTTS (voice cloning)
  xttsCheck: () => ipcRenderer.invoke('xtts:check'),
  xttsInstall: () => ipcRenderer.invoke('xtts:install'),
  xttsCreateVoice: (audioPath: string, name: string, language: string) =>
    ipcRenderer.invoke('xtts:createVoice', { audioPath, name, language }),
  xttsGetVoices: () => ipcRenderer.invoke('xtts:getVoices'),
  xttsDeleteVoice: (voiceId: string) => ipcRenderer.invoke('xtts:deleteVoice', voiceId),
  xttsSpeak: (text: string, voiceId: string, language?: string) =>
    ipcRenderer.invoke('xtts:speak', { text, voiceId, language }),
  xttsSelectAudio: () => ipcRenderer.invoke('xtts:selectAudio'),
  xttsGetLanguages: () => ipcRenderer.invoke('xtts:getLanguages'),
  xttsGetSampleVoices: () => ipcRenderer.invoke('xtts:getSampleVoices'),
  xttsDownloadSampleVoice: (sampleId: string) => ipcRenderer.invoke('xtts:downloadSampleVoice', sampleId),
  xttsSelectMediaFile: () => ipcRenderer.invoke('xtts:selectMediaFile'),
  xttsGetMediaDuration: (filePath: string) => ipcRenderer.invoke('xtts:getMediaDuration', filePath),
  xttsExtractAudioClip: (inputPath: string, startTime: number, endTime: number) =>
    ipcRenderer.invoke('xtts:extractAudioClip', { inputPath, startTime, endTime }),

  // TTS instructions (CLAUDE.md)
  ttsInstallInstructions: (projectPath: string) => ipcRenderer.invoke('tts:installInstructions', projectPath),
  ttsRemoveInstructions: (projectPath: string) => ipcRenderer.invoke('tts:removeInstructions', projectPath)
}
