// Voice manager path constants

import { app } from 'electron'
import * as path from 'path'

const depsDir = path.join(app.getPath('userData'), 'deps')

export const whisperDir = path.join(depsDir, 'whisper')
export const whisperModelsDir = path.join(whisperDir, 'models')
export const piperDir = path.join(depsDir, 'piper')
export const piperVoicesDir = path.join(piperDir, 'voices')
export const customVoicesDir = path.join(piperDir, 'custom-voices')
export const voiceSettingsPath = path.join(app.getPath('userData'), 'voice-settings.json')
export const ttsDebugLogPath = path.join(app.getPath('userData'), 'tts-debug.log')

export const VOICES_CATALOG_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json'
export const HF_BASE_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

export const PIPER_BINARY_URLS = {
  win32: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
  darwin: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_x64.tar.gz',
  linux: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz'
}
