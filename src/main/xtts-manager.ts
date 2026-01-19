import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as https from 'https'
import { isWindows } from './platform.js'
import {
  xttsDir,
  xttsVenvDir,
  xttsPythonDir,
  xttsScriptPath,
  getStandalonePython,
  getVenvPython,
  ensureDir,
  STANDALONE_PYTHON_URL,
  XTTS_LANGUAGES,
  XTTS_SAMPLE_VOICES,
  type XTTSLanguage,
  type XTTSVoice,
  type XTTSStatus
} from './xtts-paths.js'
import { XTTSServer } from './xtts-server.js'
import {
  synthesizeSpeech,
  getMediaDuration,
  extractAudioClip,
  getTempDir,
  type SpeakOptions
} from './xtts-synthesis.js'
import {
  createVoice,
  getVoices,
  getVoice,
  deleteVoice,
  getSampleVoices,
  isSampleVoiceInstalled,
  getVoicesDir,
  downloadSampleVoice
} from './xtts-speakers.js'

const execAsync = promisify(exec)

// Re-export types and constants for backward compatibility
export { XTTS_SAMPLE_VOICES, XTTS_LANGUAGES }
export type { XTTSLanguage, XTTSVoice, XTTSStatus }

type ProgressCallback = (status: string, percent?: number) => void

class XTTSManager {
  private pythonPath: string | null = null
  private server: XTTSServer

  constructor() {
    this.server = new XTTSServer(null)
    this.initPythonPath()
  }

  private async initPythonPath(): Promise<void> {
    const pythonCommands = isWindows
      ? ['python3.12', 'python3.11', 'python3.10', 'python', 'python3', 'py']
      : ['python3.12', 'python3.11', 'python3.10', 'python3', 'python']

    for (const cmd of pythonCommands) {
      try {
        const { stdout } = await execAsync(`${cmd} --version`)
        const match = stdout.match(/Python 3\.(\d+)/)
        if (match) {
          const minorVersion = parseInt(match[1], 10)
          if (minorVersion >= 10 && minorVersion <= 12) {
            this.pythonPath = cmd
            this.server.setPythonPath(cmd)
            break
          }
        }
      } catch {
        // Try next
      }
    }

    if (!this.pythonPath) {
      for (const cmd of ['python3', 'python']) {
        try {
          const { stdout } = await execAsync(`${cmd} --version`)
          if (stdout.includes('Python 3')) {
            this.pythonPath = cmd
            this.server.setPythonPath(cmd)
            break
          }
        } catch {
          // Try next
        }
      }
    }
  }

  private async getPythonVersion(): Promise<string | null> {
    if (!this.pythonPath) return null
    try {
      const { stdout } = await execAsync(`${this.pythonPath} --version`)
      const match = stdout.match(/Python (3\.\d+\.\d+)/)
      return match ? match[1] : null
    } catch {
      return null
    }
  }

  async checkInstallation(): Promise<XTTSStatus> {
    const venvPython = getVenvPython()
    if (fs.existsSync(venvPython)) {
      this.ensureHelperScript()
      try {
        const { stdout } = await execAsync(`"${venvPython}" "${xttsScriptPath}" check`, {
          timeout: 30000
        })
        const result = JSON.parse(stdout.trim())
        return {
          installed: result.installed,
          pythonPath: venvPython,
          modelDownloaded: false,
          error: result.error
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        return {
          installed: false,
          pythonPath: venvPython,
          modelDownloaded: false,
          error
        }
      }
    }

    if (!this.pythonPath) {
      await this.initPythonPath()
    }

    if (!this.pythonPath) {
      return {
        installed: false,
        pythonPath: null,
        modelDownloaded: false,
        error: 'Python 3 not found. Please install Python 3.8+ to use XTTS.'
      }
    }

    return {
      installed: false,
      pythonPath: this.pythonPath,
      modelDownloaded: false,
      error: "No module named 'TTS'"
    }
  }

  private ensureHelperScript(): void {
    ensureDir(xttsDir)
    const { XTTS_HELPER_SCRIPT } = require('./xtts-paths.js')
    fs.writeFileSync(xttsScriptPath, XTTS_HELPER_SCRIPT)
    if (!isWindows) {
      fs.chmodSync(xttsScriptPath, 0o755)
    }
  }

  private async downloadStandalonePython(
    onProgress?: ProgressCallback
  ): Promise<{ success: boolean; error?: string }> {
    const standalonePython = getStandalonePython()
    if (fs.existsSync(standalonePython)) {
      return { success: true }
    }

    onProgress?.('Downloading Python 3.12...', 0)
    ensureDir(xttsPythonDir)

    const tarPath = path.join(xttsPythonDir, 'python.tar.gz')

    try {
      await this.downloadWithProgress(STANDALONE_PYTHON_URL, tarPath, onProgress)

      onProgress?.('Extracting Python 3.12...', 35)
      await execAsync(`tar -xzf "${tarPath}" -C "${xttsPythonDir}"`, { timeout: 120000 })

      fs.unlinkSync(tarPath)

      if (!fs.existsSync(standalonePython)) {
        return { success: false, error: 'Python extraction failed' }
      }

      return { success: true }
    } catch (e) {
      if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath)
      const error = e instanceof Error ? e.message : String(e)
      return { success: false, error }
    }
  }

  private downloadWithProgress(
    url: string,
    destPath: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const downloadWithRedirect = (downloadUrl: string) => {
        https.get(downloadUrl, (response) => {
          if (response.statusCode && [301, 302, 307, 308].includes(response.statusCode)) {
            const location = response.headers.location
            if (!location) {
              reject(new Error('Redirect with no location'))
              return
            }
            downloadWithRedirect(location)
            return
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${response.statusCode}`))
            return
          }

          const file = fs.createWriteStream(destPath)
          const total = parseInt(response.headers['content-length'] || '0', 10)
          let downloaded = 0

          response.on('data', (chunk) => {
            downloaded += chunk.length
            if (total > 0) {
              const pct = Math.round((downloaded / total) * 30)
              onProgress?.(`Downloading Python 3.12 (${Math.round(downloaded / 1024 / 1024)}MB)...`, pct)
            }
          })

          response.pipe(file)
          file.on('finish', () => {
            file.close()
            resolve()
          })
          file.on('error', (err) => {
            file.close()
            fs.unlinkSync(destPath)
            reject(err)
          })
        }).on('error', reject)
      }

      downloadWithRedirect(url)
    })
  }

  async install(onProgress?: ProgressCallback): Promise<{ success: boolean; error?: string }> {
    try {
      ensureDir(xttsDir)

      const standalonePython = getStandalonePython()
      let pythonToUse: string

      if (fs.existsSync(standalonePython)) {
        pythonToUse = standalonePython
      } else {
        if (!this.pythonPath) {
          await this.initPythonPath()
        }

        const version = await this.getPythonVersion()
        const hasCompatiblePython = version && /3\.(10|11|12)\./.test(version)

        if (!hasCompatiblePython) {
          const downloadResult = await this.downloadStandalonePython(onProgress)
          if (!downloadResult.success) {
            return { success: false, error: downloadResult.error || 'Failed to download Python' }
          }
          pythonToUse = standalonePython
        } else {
          pythonToUse = this.pythonPath!
        }
      }

      onProgress?.('Creating virtual environment...', 40)
      const venvPython = getVenvPython()

      if (!fs.existsSync(venvPython)) {
        await execAsync(`"${pythonToUse}" -m venv "${xttsVenvDir}"`, { timeout: 120000 })
      }

      if (!fs.existsSync(venvPython)) {
        return { success: false, error: 'Failed to create virtual environment' }
      }

      onProgress?.('Upgrading pip...', 50)
      await execAsync(`"${venvPython}" -m pip install --upgrade pip`, { timeout: 120000 })

      onProgress?.('Installing TTS library (this may take several minutes)...', 55)
      await execAsync(`"${venvPython}" -m pip install coqui-tts`, {
        timeout: 900000
      })

      onProgress?.('Installing audio codec...', 90)
      await execAsync(`"${venvPython}" -m pip install torchcodec`, { timeout: 120000 })
      onProgress?.('TTS library installed', 95)

      const status = await this.checkInstallation()
      if (!status.installed) {
        return { success: false, error: status.error || 'Installation verification failed' }
      }

      onProgress?.('Installation complete', 100)
      return { success: true }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      return { success: false, error }
    }
  }

  // Voice management - delegate to xtts-speakers module
  async createVoice(
    audioPath: string,
    name: string,
    language: XTTSLanguage
  ): Promise<{ success: boolean; voiceId?: string; error?: string }> {
    return createVoice(audioPath, name, language)
  }

  getVoices(): XTTSVoice[] {
    return getVoices()
  }

  getVoice(voiceId: string): XTTSVoice | null {
    return getVoice(voiceId)
  }

  deleteVoice(voiceId: string): { success: boolean; error?: string } {
    return deleteVoice(voiceId)
  }

  getSampleVoices(): typeof XTTS_SAMPLE_VOICES {
    return getSampleVoices()
  }

  isSampleVoiceInstalled(sampleId: string): boolean {
    return isSampleVoiceInstalled(sampleId)
  }

  getVoicesDir(): string {
    return getVoicesDir()
  }

  async downloadSampleVoice(
    sampleId: string,
    onProgress?: ProgressCallback
  ): Promise<{ success: boolean; voiceId?: string; error?: string }> {
    return downloadSampleVoice(sampleId, onProgress)
  }

  // Speech synthesis - delegate to xtts-synthesis module
  async speak(
    text: string,
    voiceId: string,
    language?: XTTSLanguage,
    options?: SpeakOptions
  ): Promise<{ success: boolean; audioData?: string; error?: string }> {
    const voice = this.getVoice(voiceId)
    if (!voice) {
      return { success: false, error: 'Voice not found' }
    }

    return synthesizeSpeech(this.server, text, voice, language, options)
  }

  stopSpeaking(): void {
    this.server.stop()
  }

  // Audio processing - delegate to xtts-synthesis module
  async getMediaDuration(filePath: string): Promise<{ success: boolean; duration?: number; error?: string }> {
    return getMediaDuration(filePath)
  }

  async extractAudioClip(
    inputPath: string,
    startTime: number,
    endTime: number,
    outputPath?: string
  ): Promise<{ success: boolean; outputPath?: string; dataUrl?: string; error?: string }> {
    return extractAudioClip(inputPath, startTime, endTime, outputPath)
  }

  getTempDir(): string {
    return getTempDir()
  }
}

// Export singleton instance
export const xttsManager = new XTTSManager()
