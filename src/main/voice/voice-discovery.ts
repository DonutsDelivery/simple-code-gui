// Voice discovery - finding and managing installed voices

import * as fs from 'fs'
import * as path from 'path'

import { piperVoicesDir, customVoicesDir } from './paths.js'
import { PIPER_VOICES, type PiperVoiceName, type InstalledVoice, type VoicePaths, type CustomVoiceMetadata } from './types.js'
import { ensureDir } from './download.js'

export function getPiperVoicePath(voice: string): VoicePaths | null {
  const voiceInfo = PIPER_VOICES[voice as PiperVoiceName]
  if (!voiceInfo) return null

  const modelPath = path.join(piperVoicesDir, voiceInfo.file)
  const configPath = path.join(piperVoicesDir, voiceInfo.config)

  if (fs.existsSync(modelPath) && fs.existsSync(configPath)) {
    return { model: modelPath, config: configPath }
  }
  return null
}

export function getInstalledPiperVoices(): string[] {
  if (!fs.existsSync(piperVoicesDir)) return []
  return (Object.keys(PIPER_VOICES) as PiperVoiceName[]).filter(voice =>
    getPiperVoicePath(voice) !== null
  )
}

export function getAnyVoicePath(voiceKey: string): VoicePaths | null {
  // Check if it's a custom voice
  if (voiceKey.startsWith('custom:')) {
    const baseKey = voiceKey.replace('custom:', '')
    const modelPath = path.join(customVoicesDir, `${baseKey}.onnx`)
    const configPath = path.join(customVoicesDir, `${baseKey}.onnx.json`)
    if (fs.existsSync(modelPath) && fs.existsSync(configPath)) {
      return { model: modelPath, config: configPath }
    }
    return null
  }

  // Check built-in voices first
  const builtinPath = getPiperVoicePath(voiceKey)
  if (builtinPath) return builtinPath

  // Check downloaded voices
  const modelPath = path.join(piperVoicesDir, `${voiceKey}.onnx`)
  const configPath = path.join(piperVoicesDir, `${voiceKey}.onnx.json`)
  if (fs.existsSync(modelPath) && fs.existsSync(configPath)) {
    return { model: modelPath, config: configPath }
  }

  return null
}

export function getInstalledVoices(): InstalledVoice[] {
  const installed: InstalledVoice[] = []

  // Get built-in voices (from PIPER_VOICES constant)
  for (const [key, info] of Object.entries(PIPER_VOICES)) {
    const voicePath = getPiperVoicePath(key)
    if (voicePath) {
      installed.push({
        key,
        displayName: info.description,
        source: 'builtin',
        quality: 'medium',
        language: key.startsWith('en_US') ? 'English (US)' : 'English (UK)'
      })
    }
  }

  // Scan voices directory for downloaded voices not in PIPER_VOICES
  if (fs.existsSync(piperVoicesDir)) {
    const files = fs.readdirSync(piperVoicesDir)
    const onnxFiles = files.filter(f => f.endsWith('.onnx') && !f.endsWith('.onnx.json'))

    for (const onnxFile of onnxFiles) {
      const key = onnxFile.replace('.onnx', '')
      // Skip if already in built-in
      if (key in PIPER_VOICES) continue

      const configFile = `${key}.onnx.json`
      if (files.includes(configFile)) {
        // Parse language from key (e.g., "de_DE-thorsten-medium" -> "German")
        const langCode = key.split('-')[0]
        const quality = key.split('-').pop() || 'medium'

        installed.push({
          key,
          displayName: key.replace(/-/g, ' ').replace(/_/g, ' '),
          source: 'downloaded',
          quality,
          language: langCode
        })
      }
    }
  }

  // Scan custom voices directory
  if (fs.existsSync(customVoicesDir)) {
    const metadataPath = path.join(customVoicesDir, 'custom-voices.json')
    let metadata: CustomVoiceMetadata = { voices: {} }
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
      } catch { /* ignore */ }
    }

    const files = fs.readdirSync(customVoicesDir)
    const onnxFiles = files.filter(f => f.endsWith('.onnx') && !f.endsWith('.onnx.json'))

    for (const onnxFile of onnxFiles) {
      const key = `custom:${onnxFile.replace('.onnx', '')}`
      const configFile = onnxFile.replace('.onnx', '.onnx.json')
      if (files.includes(configFile)) {
        const baseKey = onnxFile.replace('.onnx', '')
        installed.push({
          key,
          displayName: metadata.voices[baseKey]?.displayName || baseKey,
          source: 'custom'
        })
      }
    }
  }

  return installed
}

export function getCustomVoicesDir(): string {
  return customVoicesDir
}

export async function importCustomVoiceFiles(
  onnxPath: string,
  configPath: string,
  displayName?: string
): Promise<{ success: boolean; voiceKey?: string; error?: string }> {
  try {
    ensureDir(customVoicesDir)

    // Validate files exist
    if (!fs.existsSync(onnxPath)) {
      return { success: false, error: 'ONNX model file not found' }
    }
    if (!fs.existsSync(configPath)) {
      return { success: false, error: 'Config file not found' }
    }

    // Get base name from onnx file
    const baseName = path.basename(onnxPath, '.onnx')
    const destOnnx = path.join(customVoicesDir, `${baseName}.onnx`)
    const destConfig = path.join(customVoicesDir, `${baseName}.onnx.json`)

    // Copy files
    fs.copyFileSync(onnxPath, destOnnx)
    fs.copyFileSync(configPath, destConfig)

    // Update metadata
    const metadataPath = path.join(customVoicesDir, 'custom-voices.json')
    let metadata: CustomVoiceMetadata = { voices: {} }
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
      } catch { /* ignore */ }
    }

    metadata.voices[baseName] = {
      displayName: displayName || baseName,
      addedAt: Date.now()
    }

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))

    return { success: true, voiceKey: `custom:${baseName}` }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export function removeCustomVoice(voiceKey: string): { success: boolean; error?: string } {
  try {
    if (!voiceKey.startsWith('custom:')) {
      return { success: false, error: 'Can only remove custom voices' }
    }

    const baseName = voiceKey.replace('custom:', '')
    const onnxPath = path.join(customVoicesDir, `${baseName}.onnx`)
    const configFilePath = path.join(customVoicesDir, `${baseName}.onnx.json`)

    if (fs.existsSync(onnxPath)) fs.unlinkSync(onnxPath)
    if (fs.existsSync(configFilePath)) fs.unlinkSync(configFilePath)

    // Update metadata
    const metadataPath = path.join(customVoicesDir, 'custom-voices.json')
    if (fs.existsSync(metadataPath)) {
      try {
        const metadata: CustomVoiceMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
        delete metadata.voices[baseName]
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
      } catch { /* ignore */ }
    }

    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
