// Whisper STT - speech-to-text with Whisper

import * as fs from 'fs'
import * as path from 'path'

import { whisperModelsDir } from './paths.js'
import { downloadFile, ensureDir } from './download.js'
import { WHISPER_MODELS, type WhisperModelName, type WhisperStatus, type ProgressCallback } from './types.js'

export function getWhisperModelPath(model: WhisperModelName): string {
  return path.join(whisperModelsDir, WHISPER_MODELS[model].file)
}

export function isWhisperModelInstalled(model: WhisperModelName): boolean {
  return fs.existsSync(getWhisperModelPath(model))
}

export function getInstalledWhisperModels(): WhisperModelName[] {
  if (!fs.existsSync(whisperModelsDir)) return []
  return (Object.keys(WHISPER_MODELS) as WhisperModelName[]).filter(model =>
    isWhisperModelInstalled(model)
  )
}

export async function checkWhisper(currentModel: WhisperModelName): Promise<WhisperStatus> {
  const models = getInstalledWhisperModels()
  return {
    installed: models.length > 0,
    models,
    currentModel: models.includes(currentModel) ? currentModel : models[0] || null
  }
}

export async function downloadWhisperModel(
  model: WhisperModelName,
  onProgress?: ProgressCallback
): Promise<{ success: boolean; error?: string }> {
  try {
    ensureDir(whisperModelsDir)

    const modelInfo = WHISPER_MODELS[model]
    const modelPath = getWhisperModelPath(model)

    onProgress?.(`Downloading Whisper ${model} model (${modelInfo.size}MB)...`, 0)

    await downloadFile(modelInfo.url, modelPath, (percent) => {
      onProgress?.(`Downloading Whisper ${model} model...`, percent)
    })

    onProgress?.('Whisper model installed successfully', 100)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function transcribe(
  pcmData: Float32Array,
  sampleRate: number,
  currentModel: WhisperModelName
): Promise<{ success: boolean; text?: string; error?: string }> {
  // Use current model, or fall back to any installed model
  let modelToUse = currentModel
  if (!isWhisperModelInstalled(modelToUse)) {
    const installed = getInstalledWhisperModels()
    if (installed.length === 0) {
      return { success: false, error: 'No Whisper model installed. Install one from Settings.' }
    }
    modelToUse = installed[0]
  }

  const modelPath = getWhisperModelPath(modelToUse)

  // Voice input transcription is not yet fully implemented
  // The model is downloaded, but we need whisper.cpp binary to run inference
  return {
    success: false,
    error: `Voice input coming soon! Model "${modelToUse}" is ready, but whisper.cpp binary integration is pending.`
  }
}
