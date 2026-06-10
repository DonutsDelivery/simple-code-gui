import { ipcMain, BrowserWindow, dialog } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { voiceManager, WHISPER_MODELS, PIPER_VOICES, WhisperModelName, PiperVoiceName } from '../voice-manager'
import { xttsManager, XTTS_LANGUAGES, XTTS_SAMPLE_VOICES } from '../xtts-manager'
import { tadaTTS, TADA_SAMPLE_VOICES, getTadaSamplePath } from '../voice/tada-tts'
import { installTaskInstructions } from './kspec-handlers'
import { type AIBackend, readInstructionFile, writeInstructionFile, ensureAiderConfig } from './instruction-files'

const TTS_INSTRUCTIONS_START = '\n\n<!-- TTS_VOICE_OUTPUT_START -->'
const TTS_INSTRUCTIONS_END = '<!-- TTS_VOICE_OUTPUT_END -->\n'
const TTS_INSTRUCTIONS = `${TTS_INSTRUCTIONS_START}
## Voice Output (TTS)

When responding, wrap your natural language prose in \`«tts»...«/tts»\` markers for text-to-speech.

Rules:
- ONLY wrap conversational prose meant to be spoken aloud
- Do NOT wrap: code, file paths, commands, tool output, URLs, lists, errors
- Keep markers on same line as text (no line breaks inside)

Examples:
✓ «tts»I'll help you fix that bug.«/tts»
✓ «tts»The tests are passing.«/tts» Here's what changed:
✗ «tts»src/Header.tsx«/tts»  (file path - don't wrap)
✗ «tts»npm install«/tts»  (command - don't wrap)
${TTS_INSTRUCTIONS_END}`

function installTTSInstructions(projectPath: string, aiBackend: AIBackend = 'claude'): boolean {
  try {
    let content = readInstructionFile(projectPath, aiBackend)

    if (content.includes(TTS_INSTRUCTIONS_START)) {
      const startIdx = content.indexOf(TTS_INSTRUCTIONS_START)
      const endIdx = content.indexOf(TTS_INSTRUCTIONS_END)
      if (startIdx !== -1 && endIdx !== -1) {
        content = content.substring(0, startIdx) + content.substring(endIdx + TTS_INSTRUCTIONS_END.length)
      }
    }

    content += TTS_INSTRUCTIONS
    writeInstructionFile(projectPath, aiBackend, content)

    // For aider, ensure .aider.conf.yml loads the conventions file
    if (aiBackend === 'aider') {
      ensureAiderConfig(projectPath)
    }

    // Also refresh task instructions on every session open so outdated
    // instruction entries (e.g. wrong --type list) get corrected.
    // Runs after TTS write so installTaskInstructions reads the updated file.
    refreshTaskInstructions(projectPath, aiBackend)

    return true
  } catch (e) {
    console.error('Failed to install TTS instructions:', e)
    return false
  }
}

/**
 * Refresh task management instructions in CLAUDE.md if a task backend is initialized.
 * Detects kspec (.kspec/) or beads (.beads/) and re-injects current instructions,
 * ensuring outdated instructions from older app versions get replaced.
 */
function refreshTaskInstructions(projectPath: string, aiBackend: AIBackend = 'claude'): void {
  try {
    const hasKspec = existsSync(join(projectPath, '.kspec'))
    const hasBeads = existsSync(join(projectPath, '.beads'))
    if (!hasKspec && !hasBeads) return

    const backend = hasKspec ? 'kspec' : 'beads'
    installTaskInstructions(projectPath, backend, aiBackend)
  } catch {
    // Non-critical — task instructions will be injected at next init
  }
}

function removeTTSInstructions(projectPath: string, aiBackend: AIBackend = 'claude'): boolean {
  try {
    let content = readInstructionFile(projectPath, aiBackend)
    if (!content) return true

    const startIdx = content.indexOf(TTS_INSTRUCTIONS_START)
    const endIdx = content.indexOf(TTS_INSTRUCTIONS_END)

    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + content.slice(endIdx + TTS_INSTRUCTIONS_END.length)
      content = content.trimEnd() + '\n'
      writeInstructionFile(projectPath, aiBackend, content)
    }
    return true
  } catch (e) {
    console.error('Failed to remove TTS instructions:', e)
    return false
  }
}

export function registerVoiceHandlers(getMainWindow: () => BrowserWindow | null) {
  // TTS Instructions
  ipcMain.handle('tts:installInstructions', (_, projectPath: string, aiBackend?: AIBackend) => {
    return { success: installTTSInstructions(projectPath, aiBackend || 'claude') }
  })

  ipcMain.handle('tts:removeInstructions', (_, projectPath: string, aiBackend?: AIBackend) => {
    return { success: removeTTSInstructions(projectPath, aiBackend || 'claude') }
  })

  // Whisper (STT)
  ipcMain.handle('voice:checkWhisper', async () => {
    try {
      return await voiceManager.checkWhisper()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:installWhisper', async (_, model: WhisperModelName) => {
    try {
      return await voiceManager.downloadWhisperModel(model, (status, percent) => {
        getMainWindow()?.webContents.send('install:progress', { type: 'whisper', status, percent })
      })
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:transcribe', async (_, pcmData: Float32Array) => {
    try {
      return await voiceManager.transcribe(pcmData)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:setWhisperModel', async (_, model: WhisperModelName) => {
    try {
      voiceManager.setWhisperModel(model)
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // TTS
  ipcMain.handle('voice:checkTTS', async () => {
    try {
      return await voiceManager.checkTTS()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Combined status check for Whisper and TTS in a single IPC call
  ipcMain.handle('voice:getFullStatus', async () => {
    try {
      return await voiceManager.getFullVoiceStatus()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:installPiper', async () => {
    try {
      return await voiceManager.installPiper((status, percent) => {
        getMainWindow()?.webContents.send('install:progress', { type: 'piper', status, percent })
      })
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:installVoice', async (_, voice: PiperVoiceName) => {
    try {
      return await voiceManager.downloadPiperVoice(voice, (status, percent) => {
        getMainWindow()?.webContents.send('install:progress', { type: 'piper-voice', status, percent })
      })
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:speak', async (_, text: string) => {
    try {
      return await voiceManager.speak(text)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:stopSpeaking', async () => {
    try {
      voiceManager.stopSpeaking()
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:getVoices', async () => {
    try {
      const installed = voiceManager.getInstalledPiperVoices()
      const all = Object.entries(PIPER_VOICES).map(([id, info]) => ({
        id,
        description: info.description,
        license: info.license,
        installed: installed.includes(id)
      }))
      return { installed, all }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:getWhisperModels', async () => {
    try {
      const installedModels = voiceManager.getInstalledWhisperModels()
      // Cast keys to WhisperModelName - safe since we're iterating over WHISPER_MODELS keys
      const modelIds = Object.keys(WHISPER_MODELS) as WhisperModelName[]
      const all = modelIds.map(id => ({
        id,
        size: WHISPER_MODELS[id].size,
        installed: installedModels.includes(id)
      }))
      return { installed: installedModels, all }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:setVoice', async (_, voice: string | { voice: string; engine: 'piper' | 'xtts' | 'tada' }) => {
    try {
      if (typeof voice === 'string') {
        voiceManager.setTTSVoice(voice)
      } else {
        voiceManager.setTTSVoice(voice.voice, voice.engine)
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:getSettings', async () => {
    try {
      return voiceManager.getSettings()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:applySettings', async (_, settings: any) => {
    try {
      voiceManager.applySettings(settings)
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:fetchCatalog', async (_, forceRefresh?: boolean) => {
    try {
      return await voiceManager.fetchVoicesCatalog(forceRefresh ?? false)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:downloadFromCatalog', async (_, voiceKey: string) => {
    try {
      return await voiceManager.downloadVoiceFromCatalog(voiceKey)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:getInstalled', async () => {
    try {
      return voiceManager.getInstalledVoices()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:importCustom', async () => {
    try {
      const win = getMainWindow()
      if (!win) {
        return { success: false, error: 'No window available' }
      }

      const result = await dialog.showOpenDialog(win, {
        title: 'Select Piper Voice Model',
        filters: [{ name: 'ONNX Model', extensions: ['onnx'] }],
        properties: ['openFile']
      })

      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: 'No file selected' }
      }

      const onnxPath = result.filePaths[0]
      const configPath = onnxPath + '.json'
      if (!existsSync(configPath)) {
        return { success: false, error: 'Config file (.onnx.json) not found next to model file' }
      }

      return await voiceManager.importCustomVoiceFiles(onnxPath, configPath)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:removeCustom', async (_, voiceKey: string) => {
    try {
      return voiceManager.removeCustomVoice(voiceKey)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:openCustomFolder', async () => {
    try {
      const { shell } = require('electron')
      const customDir = voiceManager.getCustomVoicesDir()
      if (!existsSync(customDir)) {
        mkdirSync(customDir, { recursive: true })
      }
      shell.openPath(customDir)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // XTTS (voice cloning)
  ipcMain.handle('xtts:check', async () => {
    try {
      return await xttsManager.checkInstallation()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('xtts:install', async () => {
    try {
      return await xttsManager.install()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('xtts:createVoice', async (_, { audioPath, name, language }) => {
    try {
      return await xttsManager.createVoice(audioPath, name, language)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('xtts:getVoices', async () => {
    try {
      return xttsManager.getVoices()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('xtts:deleteVoice', async (_, voiceId: string) => {
    try {
      return xttsManager.deleteVoice(voiceId)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('xtts:speak', async (_, { text, voiceId, language }) => {
    try {
      return await xttsManager.speak(text, voiceId, language)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('xtts:selectAudio', async () => {
    try {
      const win = getMainWindow()
      if (!win) {
        return { success: false, error: 'No window available' }
      }

      const result = await dialog.showOpenDialog(win, {
        title: 'Select Voice Sample Audio',
        filters: [{ name: 'Audio Files', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a'] }],
        properties: ['openFile']
      })

      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: 'No file selected' }
      }

      return { success: true, path: result.filePaths[0] }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('xtts:getLanguages', async () => {
    try {
      return XTTS_LANGUAGES
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('xtts:getSampleVoices', async () => {
    try {
      return XTTS_SAMPLE_VOICES.map(s => ({
        ...s,
        installed: xttsManager.isSampleVoiceInstalled(s.id)
      }))
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('xtts:downloadSampleVoice', async (_, sampleId: string) => {
    try {
      return await xttsManager.downloadSampleVoice(sampleId)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('xtts:getMediaDuration', async (_, filePath: string) => {
    try {
      return await xttsManager.getMediaDuration(filePath)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('xtts:extractAudioClip', async (_, { inputPath, startTime, endTime }) => {
    try {
      return await xttsManager.extractAudioClip(inputPath, startTime, endTime)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('xtts:selectMediaFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Media Files', extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'mp3', 'wav', 'ogg', 'flac', 'm4a'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false }
      }

      const filePath = result.filePaths[0]
      const duration = await xttsManager.getMediaDuration(filePath)

      return {
        success: true,
        path: filePath,
        duration: duration.success ? duration.duration : undefined,
        error: duration.error
      }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // TADA (neural voice cloning)
  ipcMain.handle('tada:install', async () => {
    try {
      return await tadaTTS.install()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('tada:check', async () => {
    try {
      return await tadaTTS.checkInstallation()
    } catch (e) {
      return { installed: false, pythonPath: null, venvExists: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('tada:loginHuggingFace', async (_, token: string) => {
    try {
      return await tadaTTS.loginHuggingFace(token)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('tada:selectVoiceSample', async () => {
    try {
      const win = getMainWindow()
      if (!win) {
        return { success: false, error: 'No window available' }
      }

      const result = await dialog.showOpenDialog(win, {
        title: 'Select Voice Sample for TADA',
        filters: [{ name: 'Audio Files', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a'] }],
        properties: ['openFile']
      })

      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: 'No file selected' }
      }

      const samplePath = result.filePaths[0]
      voiceManager.setTadaVoiceSample(samplePath)
      return { success: true, path: samplePath }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('tada:setVoiceSample', async (_, samplePath: string) => {
    try {
      voiceManager.setTadaVoiceSample(samplePath)
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('tada:getVoiceSample', async () => {
    return { path: voiceManager.getTadaVoiceSample() }
  })

  ipcMain.handle('tada:speak', async (_, text: string) => {
    try {
      return await tadaTTS.speak(text)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('tada:getSampleVoices', async () => {
    return TADA_SAMPLE_VOICES.map(s => ({
      ...s,
      available: getTadaSamplePath(s.id) !== null
    }))
  })

  ipcMain.handle('tada:useSampleVoice', async (_, sampleId: string) => {
    try {
      const samplePath = getTadaSamplePath(sampleId)
      if (!samplePath) {
        return { success: false, error: `Sample voice "${sampleId}" not found` }
      }
      voiceManager.setTadaVoiceSample(samplePath)
      return { success: true, path: samplePath }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
