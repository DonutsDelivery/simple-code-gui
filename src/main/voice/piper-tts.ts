// Piper TTS - speech synthesis with Piper

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { spawn, ChildProcess } from 'child_process'

import { isWindows } from '../platform.js'
import { piperDir, piperVoicesDir, PIPER_BINARY_URLS } from './paths.js'
import { downloadFile, extractArchive, ensureDir } from './download.js'
import { logTTS } from './debug.js'
import { getAnyVoicePath, getInstalledPiperVoices, getInstalledVoices } from './voice-discovery.js'
import { PIPER_VOICES, type PiperVoiceName, type ProgressCallback, type TTSStatus } from './types.js'

let speakingProcess: ChildProcess | null = null

export function getPiperBinaryPath(): string | null {
  const binaryName = isWindows ? 'piper.exe' : 'piper'
  // Piper extracts to a 'piper' subdirectory
  const binaryPath = path.join(piperDir, 'piper', binaryName)
  if (fs.existsSync(binaryPath)) return binaryPath
  // Also check direct path
  const directPath = path.join(piperDir, binaryName)
  if (fs.existsSync(directPath)) return directPath
  // Also check system PATH (e.g., /usr/bin/piper from package manager)
  if (!isWindows) {
    const systemPaths = ['/usr/bin/piper', '/usr/local/bin/piper']
    for (const sysPath of systemPaths) {
      if (fs.existsSync(sysPath)) return sysPath
    }
  }
  return null
}

export function isPiperInstalled(): boolean {
  return getPiperBinaryPath() !== null
}

export async function checkTTS(currentVoice: string): Promise<TTSStatus> {
  const piperInstalled = isPiperInstalled()
  const voices = getInstalledPiperVoices()

  return {
    installed: piperInstalled && voices.length > 0,
    engine: piperInstalled ? 'piper' : null,
    voices,
    currentVoice: voices.includes(currentVoice) ? currentVoice : voices[0] || null
  }
}

export async function installPiper(
  onProgress?: ProgressCallback
): Promise<{ success: boolean; error?: string }> {
  try {
    ensureDir(piperDir)

    const platform = process.platform as 'win32' | 'darwin' | 'linux'
    const url = PIPER_BINARY_URLS[platform]
    if (!url) {
      return { success: false, error: `Unsupported platform: ${platform}` }
    }

    const ext = isWindows ? '.zip' : '.tar.gz'
    const archivePath = path.join(piperDir, `piper${ext}`)

    onProgress?.('Downloading Piper TTS...', 0)
    await downloadFile(url, archivePath, (percent) => {
      onProgress?.('Downloading Piper TTS...', percent)
    })

    onProgress?.('Extracting Piper TTS...', undefined)
    await extractArchive(archivePath, piperDir)

    // Cleanup archive
    fs.unlinkSync(archivePath)

    // Make binary executable on Unix
    if (!isWindows) {
      const binaryPath = getPiperBinaryPath()
      if (binaryPath) {
        fs.chmodSync(binaryPath, 0o755)
      }
    }

    if (!isPiperInstalled()) {
      return { success: false, error: 'Piper extraction failed' }
    }

    onProgress?.('Piper TTS installed successfully', 100)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function downloadPiperVoice(
  voice: PiperVoiceName,
  onProgress?: ProgressCallback
): Promise<{ success: boolean; error?: string }> {
  try {
    ensureDir(piperVoicesDir)

    const voiceInfo = PIPER_VOICES[voice]
    const modelPath = path.join(piperVoicesDir, voiceInfo.file)
    const configPath = path.join(piperVoicesDir, voiceInfo.config)

    onProgress?.(`Downloading voice: ${voiceInfo.description}...`, 0)

    // Download model file
    await downloadFile(voiceInfo.url, modelPath, (percent) => {
      onProgress?.('Downloading voice model...', Math.round(percent * 0.9))
    })

    // Download config file
    await downloadFile(voiceInfo.configUrl, configPath, () => {
      onProgress?.('Downloading voice config...', 95)
    })

    onProgress?.('Voice installed successfully', 100)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function speak(
  text: string,
  currentVoice: string,
  ttsSpeed: number
): Promise<{ success: boolean; audioData?: string; error?: string }> {
  logTTS('piper speak() called', {
    textLength: text.length,
    text: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
    voice: currentVoice,
    speed: ttsSpeed
  })

  const piperPath = getPiperBinaryPath()
  if (!piperPath) {
    logTTS('ERROR: Piper not installed')
    return { success: false, error: 'Piper not installed' }
  }

  // Use getAnyVoicePath to support built-in, downloaded, and custom voices
  let voicePaths = getAnyVoicePath(currentVoice)
  let voiceToUse = currentVoice

  if (!voicePaths) {
    // Current voice not found - try to fall back to any available voice
    const availableVoices = getInstalledVoices()
    for (const voice of availableVoices) {
      voicePaths = getAnyVoicePath(voice.key)
      if (voicePaths) {
        voiceToUse = voice.key
        break
      }
    }
    if (!voicePaths) {
      return { success: false, error: 'No voices installed' }
    }
  }

  try {
    const tempDir = app.getPath('temp')
    const outputPath = path.join(tempDir, `tts_${Date.now()}.wav`)

    // Piper takes text from stdin and outputs WAV to file
    // length_scale: <1 = faster, >1 = slower. Convert from our speed (>1 = faster)
    const lengthScale = 1.0 / ttsSpeed
    const args = [
      '--model', voicePaths.model,
      '--output_file', outputPath,
      '--length_scale', lengthScale.toFixed(2)
    ]

    logTTS('Spawning Piper', {
      piperPath,
      args,
      lengthScale,
      model: voicePaths.model,
      outputPath
    })

    return new Promise((resolve) => {
      const proc = spawn(piperPath, args)
      speakingProcess = proc

      let stderrOutput = ''
      proc.stderr?.on('data', (data) => {
        stderrOutput += data.toString()
      })

      logTTS('Writing text to Piper stdin', { textBytes: Buffer.byteLength(text, 'utf8') })
      proc.stdin.write(text)
      proc.stdin.end()

      proc.on('close', (code) => {
        speakingProcess = null
        logTTS('Piper process closed', { code, stderrOutput: stderrOutput.substring(0, 500) })

        if (code === 0 && fs.existsSync(outputPath)) {
          // Read file and return as base64
          const audioBuffer = fs.readFileSync(outputPath)
          const audioData = audioBuffer.toString('base64')
          logTTS('Audio generated successfully', {
            audioSize: audioBuffer.length,
            base64Length: audioData.length
          })
          // Clean up temp file
          fs.unlinkSync(outputPath)
          resolve({ success: true, audioData })
        } else {
          logTTS('ERROR: Piper failed', { code, stderrOutput })
          resolve({ success: false, error: `Piper exited with code ${code}` })
        }
      })

      proc.on('error', (err) => {
        speakingProcess = null
        logTTS('ERROR: Piper spawn error', { error: err.message })
        resolve({ success: false, error: err.message })
      })
    })
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export function stopSpeaking(): void {
  if (speakingProcess) {
    speakingProcess.kill()
    speakingProcess = null
  }
}
