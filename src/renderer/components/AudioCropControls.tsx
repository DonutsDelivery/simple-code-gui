import React from 'react'

interface AudioCropControlsProps {
  mediaPath: string
  mediaDuration: number
  cropStart: number
  cropEnd: number
  extracting: boolean
  isPreviewPlaying: boolean
  onCropStartChange: (value: number) => void
  onCropEndChange: (value: number) => void
  onPreview: () => void
  onStopPreview: () => void
  onUseCroppedAudio: () => void
  onClear: () => void
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function AudioCropControls({
  mediaPath,
  mediaDuration,
  cropStart,
  cropEnd,
  extracting,
  isPreviewPlaying,
  onCropStartChange,
  onCropEndChange,
  onPreview,
  onStopPreview,
  onUseCroppedAudio,
  onClear
}: AudioCropControlsProps): React.ReactElement {
  const filename = mediaPath.split('/').pop() || ''
  const selectionLeft = (cropStart / mediaDuration) * 100
  const selectionWidth = ((cropEnd - cropStart) / mediaDuration) * 100

  function handleStartChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const val = parseFloat(e.target.value)
    if (val < cropEnd - 3) {
      onCropStartChange(Math.max(0, val))
    }
  }

  function handleEndChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const val = parseFloat(e.target.value)
    if (val > cropStart + 3) {
      onCropEndChange(Math.min(mediaDuration, val))
    }
  }

  return (
    <div className="audio-crop-controls">
      <div className="crop-file-info">
        <span className="crop-filename">{filename}</span>
        <span className="crop-duration">Duration: {formatTime(mediaDuration)}</span>
      </div>

      <div className="crop-range-container">
        <div className="crop-range-labels">
          <span>{formatTime(cropStart)}</span>
          <span className="crop-length-badge">{formatTime(cropEnd - cropStart)}</span>
          <span>{formatTime(cropEnd)}</span>
        </div>
        <div className="crop-range-track">
          <div
            className="crop-range-selection"
            style={{
              left: `${selectionLeft}%`,
              width: `${selectionWidth}%`
            }}
          />
          <input
            type="range"
            className="crop-range-input crop-range-start"
            min={0}
            max={mediaDuration}
            step={0.1}
            value={cropStart}
            onChange={handleStartChange}
          />
          <input
            type="range"
            className="crop-range-input crop-range-end"
            min={0}
            max={mediaDuration}
            step={0.1}
            value={cropEnd}
            onChange={handleEndChange}
          />
        </div>
        <div className="crop-range-ticks">
          <span>0:00</span>
          <span>{formatTime(mediaDuration / 2)}</span>
          <span>{formatTime(mediaDuration)}</span>
        </div>
      </div>

      <div className="crop-actions">
        {isPreviewPlaying ? (
          <button className="btn-secondary btn-small" onClick={onStopPreview}>
            {'\u23F9'} Stop
          </button>
        ) : (
          <button
            className="btn-secondary btn-small"
            onClick={onPreview}
            disabled={extracting || cropStart >= cropEnd}
          >
            {extracting ? 'Extracting...' : '\u25B6 Preview'}
          </button>
        )}
        <button
          className="btn-primary btn-small"
          onClick={onUseCroppedAudio}
          disabled={extracting || cropStart >= cropEnd}
        >
          Use This Clip
        </button>
        <button className="btn-secondary btn-small" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  )
}
