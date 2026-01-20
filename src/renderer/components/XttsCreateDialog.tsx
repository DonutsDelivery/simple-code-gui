import React, { useState } from 'react'
import { AudioCropControls } from './AudioCropControls.js'
import type { XTTSLanguage } from './VoiceBrowserTypes.js'

interface XttsCreateDialogProps {
  xttsStatus: { installed: boolean; error?: string }
  xttsLanguages: XTTSLanguage[]
  voiceVolume: number
  onClose: () => void
  onInstallXtts: () => Promise<void>
  onCreateVoice: (name: string, language: string, audioPath: string) => Promise<void>
  onError: (error: string) => void
}

export function XttsCreateDialog({
  xttsStatus,
  xttsLanguages,
  voiceVolume,
  onClose,
  onInstallXtts,
  onCreateVoice,
  onError
}: XttsCreateDialogProps): React.ReactElement {
  const [createXttsName, setCreateXttsName] = useState('')
  const [createXttsLanguage, setCreateXttsLanguage] = useState('en')
  const [createXttsAudioPath, setCreateXttsAudioPath] = useState('')
  const [creatingXtts, setCreatingXtts] = useState(false)
  const [installingXtts, setInstallingXtts] = useState(false)

  // Audio cropping state
  const [mediaPath, setMediaPath] = useState('')
  const [mediaDuration, setMediaDuration] = useState(0)
  const [cropStart, setCropStart] = useState(0)
  const [cropEnd, setCropEnd] = useState(0)
  const [extracting, setExtracting] = useState(false)
  const [cropPreviewAudio, setCropPreviewAudio] = useState<HTMLAudioElement | null>(null)

  async function handleInstallXtts(): Promise<void> {
    setInstallingXtts(true)
    await onInstallXtts()
    setInstallingXtts(false)
  }

  async function handleSelectAudio(): Promise<void> {
    const result = await window.electronAPI?.xttsSelectAudio()
    if (result.success && result.path) {
      setCreateXttsAudioPath(result.path)
    }
  }

  async function handleSelectMedia(): Promise<void> {
    const result = await window.electronAPI?.xttsSelectMediaFile()
    if (result.success && result.path) {
      setMediaPath(result.path)
      setMediaDuration(result.duration || 0)
      setCropStart(0)
      setCropEnd(Math.min(result.duration || 30, 30))
    }
  }

  async function handleCropPreview(): Promise<void> {
    if (!mediaPath || cropStart >= cropEnd) return

    if (cropPreviewAudio) {
      cropPreviewAudio.pause()
      cropPreviewAudio.src = ''
      setCropPreviewAudio(null)
    }

    setExtracting(true)
    try {
      const result = await window.electronAPI?.xttsExtractAudioClip(mediaPath, cropStart, cropEnd)
      if (result.success && result.dataUrl) {
        const audio = new Audio(result.dataUrl)
        audio.volume = voiceVolume
        audio.onended = () => {
          setCropPreviewAudio(null)
        }
        audio.play()
        setCropPreviewAudio(audio)
      } else {
        onError(result.error || 'Failed to extract audio clip')
      }
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Failed to extract audio clip')
    }
    setExtracting(false)
  }

  function handleStopCropPreview(): void {
    if (cropPreviewAudio) {
      cropPreviewAudio.pause()
      cropPreviewAudio.src = ''
      setCropPreviewAudio(null)
    }
  }

  async function handleUseCroppedAudio(): Promise<void> {
    if (!mediaPath || cropStart >= cropEnd) return

    setExtracting(true)
    try {
      const result = await window.electronAPI?.xttsExtractAudioClip(mediaPath, cropStart, cropEnd)
      if (result.success && result.outputPath) {
        setCreateXttsAudioPath(result.outputPath)
        setMediaPath('')
        setMediaDuration(0)
        setCropStart(0)
        setCropEnd(0)
      } else {
        onError(result.error || 'Failed to extract audio clip')
      }
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Failed to extract audio clip')
    }
    setExtracting(false)
  }

  function handleClearMedia(): void {
    setMediaPath('')
    setMediaDuration(0)
    setCropStart(0)
    setCropEnd(0)
  }

  async function handleCreateXtts(): Promise<void> {
    if (!createXttsName.trim() || !createXttsAudioPath) return
    setCreatingXtts(true)
    await onCreateVoice(createXttsName.trim(), createXttsLanguage, createXttsAudioPath)
    setCreatingXtts(false)
  }

  return (
    <div className="voice-create-dialog">
      <div className="voice-create-content">
        <div className="voice-create-header">
          <h3>Create XTTS Voice Clone</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        {!xttsStatus.installed ? (
          <XttsInstallPrompt
            error={xttsStatus.error}
            installing={installingXtts}
            onInstall={handleInstallXtts}
            onCancel={onClose}
          />
        ) : (
          <XttsCreateForm
            name={createXttsName}
            language={createXttsLanguage}
            audioPath={createXttsAudioPath}
            languages={xttsLanguages}
            mediaPath={mediaPath}
            mediaDuration={mediaDuration}
            cropStart={cropStart}
            cropEnd={cropEnd}
            extracting={extracting}
            isPreviewPlaying={cropPreviewAudio !== null}
            creating={creatingXtts}
            onNameChange={setCreateXttsName}
            onLanguageChange={setCreateXttsLanguage}
            onSelectAudio={handleSelectAudio}
            onSelectMedia={handleSelectMedia}
            onCropStartChange={setCropStart}
            onCropEndChange={setCropEnd}
            onCropPreview={handleCropPreview}
            onStopCropPreview={handleStopCropPreview}
            onUseCroppedAudio={handleUseCroppedAudio}
            onClearMedia={handleClearMedia}
            onCancel={onClose}
            onCreate={handleCreateXtts}
          />
        )}
      </div>
    </div>
  )
}

interface XttsInstallPromptProps {
  error?: string
  installing: boolean
  onInstall: () => void
  onCancel: () => void
}

function XttsInstallPrompt({
  error,
  installing,
  onInstall,
  onCancel
}: XttsInstallPromptProps): React.ReactElement {
  return (
    <div className="xtts-install-prompt">
      <p>XTTS requires Python and the TTS library to be installed.</p>
      {error && <p className="error-text selectable">{error}</p>}
      <button className="btn-primary" onClick={onInstall} disabled={installing}>
        {installing ? 'Installing...' : 'Install XTTS Dependencies'}
      </button>
      <p className="note-text">This will install the TTS library via pip (~2GB)</p>
      <button className="btn-secondary" onClick={onCancel} style={{ marginTop: 12 }}>
        Cancel
      </button>
    </div>
  )
}

interface XttsCreateFormProps {
  name: string
  language: string
  audioPath: string
  languages: XTTSLanguage[]
  mediaPath: string
  mediaDuration: number
  cropStart: number
  cropEnd: number
  extracting: boolean
  isPreviewPlaying: boolean
  creating: boolean
  onNameChange: (name: string) => void
  onLanguageChange: (language: string) => void
  onSelectAudio: () => void
  onSelectMedia: () => void
  onCropStartChange: (value: number) => void
  onCropEndChange: (value: number) => void
  onCropPreview: () => void
  onStopCropPreview: () => void
  onUseCroppedAudio: () => void
  onClearMedia: () => void
  onCancel: () => void
  onCreate: () => void
}

function XttsCreateForm({
  name,
  language,
  audioPath,
  languages,
  mediaPath,
  mediaDuration,
  cropStart,
  cropEnd,
  extracting,
  isPreviewPlaying,
  creating,
  onNameChange,
  onLanguageChange,
  onSelectAudio,
  onSelectMedia,
  onCropStartChange,
  onCropEndChange,
  onCropPreview,
  onStopCropPreview,
  onUseCroppedAudio,
  onClearMedia,
  onCancel,
  onCreate
}: XttsCreateFormProps): React.ReactElement {
  return (
    <>
      <div className="form-group">
        <label>Voice Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="My Voice Clone"
        />
      </div>
      <div className="form-group">
        <label>Language</label>
        <select value={language} onChange={(e) => onLanguageChange(e.target.value)}>
          {languages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Reference Audio (6-30 seconds recommended)</label>

        <div className="audio-select-row">
          <input type="text" value={audioPath} readOnly placeholder="Select an audio file..." />
          <button className="btn-secondary" onClick={onSelectAudio}>
            Browse...
          </button>
        </div>

        <div className="audio-crop-section">
          <div className="audio-crop-header">
            <span className="note-text">Or extract from video/audio:</span>
            <button className="btn-secondary btn-small" onClick={onSelectMedia}>
              Import Media...
            </button>
          </div>

          {mediaPath && (
            <AudioCropControls
              mediaPath={mediaPath}
              mediaDuration={mediaDuration}
              cropStart={cropStart}
              cropEnd={cropEnd}
              extracting={extracting}
              isPreviewPlaying={isPreviewPlaying}
              onCropStartChange={onCropStartChange}
              onCropEndChange={onCropEndChange}
              onPreview={onCropPreview}
              onStopPreview={onStopCropPreview}
              onUseCroppedAudio={onUseCroppedAudio}
              onClear={onClearMedia}
            />
          )}
        </div>

        <p className="note-text">Use a clean recording of the voice you want to clone</p>
      </div>
      <div className="dialog-actions">
        <button className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={onCreate}
          disabled={creating || !name.trim() || !audioPath}
        >
          {creating ? 'Creating...' : 'Create Voice'}
        </button>
      </div>
    </>
  )
}
