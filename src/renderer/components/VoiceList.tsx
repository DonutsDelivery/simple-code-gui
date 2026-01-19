import React from 'react'
import { getSampleUrl } from '../utils/voiceUtils.js'
import type { CombinedVoice } from './VoiceBrowserTypes.js'

interface VoiceListProps {
  voices: CombinedVoice[]
  playingPreview: string | null
  onSelect: (voice: CombinedVoice) => void
  onPreview: (voiceKey: string, e: React.MouseEvent) => void
  onDownload: (voiceKey: string, engine: 'piper' | 'xtts') => void
  onDeleteXtts: (voiceId: string, e: React.MouseEvent) => void
}

export function VoiceList({
  voices,
  playingPreview,
  onSelect,
  onPreview,
  onDownload,
  onDeleteXtts
}: VoiceListProps): React.ReactElement {
  return (
    <>
      <div className="voice-browser-header">
        <span className="voice-col-model">Model</span>
        <span className="voice-col-name">Name</span>
        <span className="voice-col-lang">Language</span>
        <span className="voice-col-quality">Quality</span>
        <span className="voice-col-size">Size</span>
        <span className="voice-col-preview">Preview</span>
        <span className="voice-col-action"></span>
      </div>
      <div className="voice-browser-list">
        {voices.map((voice) => (
          <VoiceRow
            key={`${voice.engine}-${voice.key}`}
            voice={voice}
            playingPreview={playingPreview}
            onSelect={onSelect}
            onPreview={onPreview}
            onDownload={onDownload}
            onDeleteXtts={onDeleteXtts}
          />
        ))}
        {voices.length === 0 && (
          <div className="voice-browser-empty">No voices match your filters</div>
        )}
      </div>
    </>
  )
}

interface VoiceRowProps {
  voice: CombinedVoice
  playingPreview: string | null
  onSelect: (voice: CombinedVoice) => void
  onPreview: (voiceKey: string, e: React.MouseEvent) => void
  onDownload: (voiceKey: string, engine: 'piper' | 'xtts') => void
  onDeleteXtts: (voiceId: string, e: React.MouseEvent) => void
}

function VoiceRow({
  voice,
  playingPreview,
  onSelect,
  onPreview,
  onDownload,
  onDeleteXtts
}: VoiceRowProps): React.ReactElement {
  return (
    <div
      className={`voice-browser-row ${voice.installed ? 'installed' : ''}`}
      onClick={() => onSelect(voice)}
      title={voice.key}
    >
      <span className="voice-col-model">
        <span className={`voice-model-badge ${voice.engine}`}>
          {voice.engine === 'piper' ? 'Piper' : 'XTTS'}
        </span>
      </span>
      <span className="voice-col-name">{voice.name}</span>
      <span className="voice-col-lang">{voice.language}</span>
      <span className="voice-col-quality">{voice.quality}</span>
      <span className="voice-col-size">
        {voice.size > 0 ? `${voice.size} MB` : '--'}
      </span>
      <span className="voice-col-preview">
        {voice.engine === 'piper' && getSampleUrl(voice.key) && (
          <button
            className={`voice-preview-btn ${playingPreview === voice.key ? 'playing' : ''}`}
            onClick={(e) => onPreview(voice.key, e)}
            title={playingPreview === voice.key ? 'Stop preview' : 'Play preview'}
          >
            {playingPreview === voice.key ? '\u23F9' : '\u25B6'}
          </button>
        )}
      </span>
      <span className="voice-col-action">
        <VoiceAction
          voice={voice}
          onDownload={onDownload}
          onDeleteXtts={onDeleteXtts}
        />
      </span>
    </div>
  )
}

interface VoiceActionProps {
  voice: CombinedVoice
  onDownload: (voiceKey: string, engine: 'piper' | 'xtts') => void
  onDeleteXtts: (voiceId: string, e: React.MouseEvent) => void
}

function VoiceAction({ voice, onDownload, onDeleteXtts }: VoiceActionProps): React.ReactElement {
  if (voice.installed) {
    if (voice.engine === 'xtts') {
      return (
        <button
          className="voice-delete-btn"
          onClick={(e) => onDeleteXtts(voice.key, e)}
          title="Delete voice clone"
        >
          Delete
        </button>
      )
    }
    return <span className="voice-installed-badge">Installed</span>
  }

  if (voice.isDownloading) {
    return <span className="voice-downloading">Downloading...</span>
  }

  return (
    <button
      className="voice-download-btn"
      onClick={(e) => {
        e.stopPropagation()
        onDownload(voice.key, voice.engine)
      }}
    >
      Download
    </button>
  )
}
