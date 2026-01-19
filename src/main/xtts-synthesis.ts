import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { XTTSLanguage, XTTSVoice } from './xtts-paths.js'
import type { XTTSServer } from './xtts-server.js'

const execAsync = promisify(exec)

export interface SpeakOptions {
  temperature?: number
  speed?: number
  topK?: number
  topP?: number
  repetitionPenalty?: number
}

export interface SpeakResult {
  success: boolean
  audioData?: string
  error?: string
}

export interface ExtractClipResult {
  success: boolean
  outputPath?: string
  dataUrl?: string
  error?: string
}

export interface MediaDurationResult {
  success: boolean
  duration?: number
  error?: string
}

export async function synthesizeSpeech(
  server: XTTSServer,
  text: string,
  voice: XTTSVoice,
  language?: XTTSLanguage,
  options?: SpeakOptions
): Promise<SpeakResult> {
  try {
    const tempDir = app.getPath('temp')
    const outputPath = path.join(tempDir, `xtts_${Date.now()}.wav`)
    const lang = language || voice.language

    const result = await server.sendCommand({
      action: 'speak',
      text,
      reference_audio: voice.referencePath,
      language: lang,
      output_path: outputPath,
      temperature: options?.temperature ?? 0.65,
      speed: options?.speed ?? 1.0,
      top_k: options?.topK ?? 50,
      top_p: options?.topP ?? 0.85,
      repetition_penalty: options?.repetitionPenalty ?? 2.0
    }) as { success: boolean; error?: string }

    if (result.success && fs.existsSync(outputPath)) {
      const audioBuffer = fs.readFileSync(outputPath)
      const audioData = audioBuffer.toString('base64')
      fs.unlinkSync(outputPath)
      return { success: true, audioData }
    }

    return { success: false, error: result.error || 'TTS generation failed' }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { success: false, error }
  }
}

export async function getMediaDuration(filePath: string): Promise<MediaDurationResult> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { timeout: 30000 }
    )
    const duration = parseFloat(stdout.trim())
    if (isNaN(duration)) {
      return { success: false, error: 'Could not determine duration' }
    }
    return { success: true, duration }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (error.includes('not found') || error.includes('ENOENT')) {
      return { success: false, error: 'ffmpeg not found. Please install ffmpeg to use this feature.' }
    }
    return { success: false, error }
  }
}

export async function extractAudioClip(
  inputPath: string,
  startTime: number,
  endTime: number,
  outputPath?: string
): Promise<ExtractClipResult> {
  try {
    const duration = endTime - startTime
    if (duration <= 0) {
      return { success: false, error: 'End time must be greater than start time' }
    }
    if (duration < 3) {
      return { success: false, error: 'Clip must be at least 3 seconds long' }
    }
    if (duration > 30) {
      return { success: false, error: 'Clip should be 30 seconds or less for best results' }
    }

    const outPath = outputPath || path.join(app.getPath('temp'), `xtts_clip_${Date.now()}.wav`)

    await execAsync(
      `ffmpeg -y -ss ${startTime} -t ${duration} -i "${inputPath}" -vn -acodec pcm_s16le -ar 22050 -ac 1 "${outPath}"`,
      { timeout: 60000 }
    )

    if (!fs.existsSync(outPath)) {
      return { success: false, error: 'Failed to extract audio' }
    }

    const audioData = fs.readFileSync(outPath)
    const dataUrl = `data:audio/wav;base64,${audioData.toString('base64')}`

    return { success: true, outputPath: outPath, dataUrl }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (error.includes('not found') || error.includes('ENOENT')) {
      return { success: false, error: 'ffmpeg not found. Please install ffmpeg to use this feature.' }
    }
    return { success: false, error }
  }
}

export function getTempDir(): string {
  return app.getPath('temp')
}
