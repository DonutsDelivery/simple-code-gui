import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import {
  xttsVoicesDir,
  ensureDir,
  XTTS_HF_BASE,
  XTTS_SAMPLE_VOICES,
  type XTTSVoice,
  type XTTSLanguage
} from './xtts-paths.js'

export interface CreateVoiceResult {
  success: boolean
  voiceId?: string
  error?: string
}

export interface DownloadVoiceResult {
  success: boolean
  voiceId?: string
  error?: string
}

export type ProgressCallback = (status: string, percent?: number) => void

export function createVoice(
  audioPath: string,
  name: string,
  language: XTTSLanguage
): CreateVoiceResult {
  try {
    if (!fs.existsSync(audioPath)) {
      return { success: false, error: 'Audio file not found' }
    }

    const voiceId = name.toLowerCase().replace(/[^a-z0-9]/g, '-')
    const voiceDir = path.join(xttsVoicesDir, voiceId)
    ensureDir(voiceDir)

    const referencePath = path.join(voiceDir, 'reference.wav')
    fs.copyFileSync(audioPath, referencePath)

    const metadata: XTTSVoice = {
      id: voiceId,
      name,
      language,
      referencePath,
      createdAt: Date.now()
    }
    fs.writeFileSync(
      path.join(voiceDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    )

    return { success: true, voiceId }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { success: false, error }
  }
}

export function getVoices(): XTTSVoice[] {
  const voices: XTTSVoice[] = []

  if (!fs.existsSync(xttsVoicesDir)) {
    return voices
  }

  const dirs = fs.readdirSync(xttsVoicesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())

  for (const dir of dirs) {
    const metadataPath = path.join(xttsVoicesDir, dir.name, 'metadata.json')
    if (fs.existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
        voices.push(metadata)
      } catch {
        // Skip invalid metadata
      }
    }
  }

  return voices.sort((a, b) => b.createdAt - a.createdAt)
}

export function getVoice(voiceId: string): XTTSVoice | null {
  const metadataPath = path.join(xttsVoicesDir, voiceId, 'metadata.json')
  if (fs.existsSync(metadataPath)) {
    try {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
    } catch {
      return null
    }
  }
  return null
}

export function deleteVoice(voiceId: string): { success: boolean; error?: string } {
  try {
    const voiceDir = path.join(xttsVoicesDir, voiceId)
    if (fs.existsSync(voiceDir)) {
      fs.rmSync(voiceDir, { recursive: true })
    }
    return { success: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { success: false, error }
  }
}

export function getSampleVoices(): typeof XTTS_SAMPLE_VOICES {
  return XTTS_SAMPLE_VOICES
}

export function isSampleVoiceInstalled(sampleId: string): boolean {
  const voiceDir = path.join(xttsVoicesDir, sampleId)
  return fs.existsSync(path.join(voiceDir, 'metadata.json'))
}

export function getVoicesDir(): string {
  return xttsVoicesDir
}

export async function downloadSampleVoice(
  sampleId: string,
  onProgress?: ProgressCallback
): Promise<DownloadVoiceResult> {
  const sample = XTTS_SAMPLE_VOICES.find(s => s.id === sampleId)
  if (!sample) {
    return { success: false, error: `Sample voice "${sampleId}" not found` }
  }

  try {
    ensureDir(xttsVoicesDir)

    const voiceDir = path.join(xttsVoicesDir, sample.id)
    ensureDir(voiceDir)

    const referencePath = path.join(voiceDir, 'reference.wav')
    const url = `${XTTS_HF_BASE}/${sample.file}`

    onProgress?.(`Downloading ${sample.name}...`, 0)

    await downloadFile(url, referencePath, sample.name, onProgress)

    const metadata: XTTSVoice = {
      id: sample.id,
      name: sample.name,
      language: sample.language as XTTSLanguage,
      referencePath,
      createdAt: Date.now()
    }
    fs.writeFileSync(
      path.join(voiceDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    )

    onProgress?.('Voice downloaded successfully', 100)
    return { success: true, voiceId: sample.id }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { success: false, error }
  }
}

function downloadFile(
  url: string,
  destPath: string,
  name: string,
  onProgress?: ProgressCallback
): Promise<void> {
  return new Promise((resolve, reject) => {
    const downloadWithRedirect = (downloadUrl: string) => {
      https.get(downloadUrl, (response) => {
        if (response.statusCode && [301, 302, 307, 308].includes(response.statusCode)) {
          const location = response.headers.location
          if (!location) {
            reject(new Error('Redirect with no location header'))
            return
          }
          const redirectUrl = location.startsWith('http')
            ? location
            : new URL(location, downloadUrl).toString()
          downloadWithRedirect(redirectUrl)
          return
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status ${response.statusCode}`))
          return
        }

        const file = fs.createWriteStream(destPath)
        const total = parseInt(response.headers['content-length'] || '0', 10)
        let downloaded = 0

        response.on('data', (chunk) => {
          downloaded += chunk.length
          if (total > 0) {
            onProgress?.(`Downloading ${name}...`, Math.round((downloaded / total) * 100))
          }
        })

        response.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
        file.on('error', (err) => {
          file.close()
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
          reject(err)
        })
      }).on('error', reject)
    }

    downloadWithRedirect(url)
  })
}
