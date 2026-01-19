import React, { useState, useEffect, useMemo } from 'react'
import { useVoice } from '../contexts/VoiceContext.js'
import { getSampleUrl } from '../utils/voiceUtils.js'
import { VoiceFilters } from './VoiceFilters.js'
import { VoiceList } from './VoiceList.js'
import { XttsCreateDialog } from './XttsCreateDialog.js'
import type {
  VoiceCatalogEntry,
  InstalledVoice,
  XTTSVoice,
  XTTSSampleVoice,
  XTTSLanguage,
  ExtendedAudioElement,
  CombinedVoice,
  ModelFilter
} from './VoiceBrowserTypes.js'

interface VoiceBrowserModalProps {
  isOpen: boolean
  onClose: () => void
  onVoiceSelect?: (voiceKey: string, engine: 'piper' | 'xtts') => void
}

export function VoiceBrowserModal({ isOpen, onClose, onVoiceSelect }: VoiceBrowserModalProps): React.ReactElement | null {
  const { volume: voiceVolume } = useVoice()
  const [catalog, setCatalog] = useState<VoiceCatalogEntry[]>([])
  const [installed, setInstalled] = useState<InstalledVoice[]>([])
  const [xttsVoices, setXttsVoices] = useState<XTTSVoice[]>([])
  const [xttsSampleVoices, setXttsSampleVoices] = useState<XTTSSampleVoice[]>([])
  const [xttsLanguages, setXttsLanguages] = useState<XTTSLanguage[]>([])
  const [xttsStatus, setXttsStatus] = useState<{ installed: boolean; error?: string }>({ installed: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all')
  const [languageFilter, setLanguageFilter] = useState('all')
  const [qualityFilter, setQualityFilter] = useState('all')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [playingPreview, setPlayingPreview] = useState<string | null>(null)
  const [previewAudio, setPreviewAudio] = useState<ExtendedAudioElement | null>(null)
  const [showCreateXtts, setShowCreateXtts] = useState(false)

  useEffect(() => {
    if (isOpen) {
      loadData()
    }
  }, [isOpen])

  // Stop preview when modal closes
  useEffect(() => {
    if (!isOpen && previewAudio) {
      if (previewAudio._stop) {
        previewAudio._stop()
      } else {
        previewAudio.pause()
        previewAudio.src = ''
      }
      setPreviewAudio(null)
      setPlayingPreview(null)
    }
  }, [isOpen])

  async function loadData(forceRefresh: boolean = false): Promise<void> {
    setLoading(true)
    setError(null)

    try {
      const [catalogData, installedData, xttsVoicesData, xttsSamplesData, xttsLangs, xttsCheck] = await Promise.all([
        window.electronAPI.voiceFetchCatalog(forceRefresh),
        window.electronAPI.voiceGetInstalled(),
        window.electronAPI.xttsGetVoices(),
        window.electronAPI.xttsGetSampleVoices(),
        window.electronAPI.xttsGetLanguages(),
        window.electronAPI.xttsCheck()
      ])
      setCatalog(catalogData)
      setInstalled(installedData)
      setXttsVoices(xttsVoicesData)
      setXttsSampleVoices(xttsSamplesData)
      setXttsLanguages(xttsLangs)
      setXttsStatus({ installed: xttsCheck.installed, error: xttsCheck.error })
      setLoading(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load voice catalog')
      setLoading(false)
    }
  }

  const languages = useMemo(() => {
    const langSet = new Set<string>()
    catalog.forEach((v) => langSet.add(v.language.name_english))
    xttsLanguages.forEach((l) => langSet.add(l.name))
    return Array.from(langSet).sort()
  }, [catalog, xttsLanguages])

  const qualities = useMemo(() => {
    const qualSet = new Set<string>()
    catalog.forEach((v) => qualSet.add(v.quality))
    return Array.from(qualSet).sort()
  }, [catalog])

  const filteredVoices = useMemo(() => {
    const combined: CombinedVoice[] = []

    // Add Piper voices
    if (modelFilter === 'all' || modelFilter === 'piper') {
      catalog.forEach((v) => {
        const isInstalled = installed.some((i) => i.key === v.key)
        const onnxFile = Object.entries(v.files).find(
          ([p]) => p.endsWith('.onnx') && !p.endsWith('.onnx.json')
        )
        const size = onnxFile ? Math.round(onnxFile[1].size_bytes / (1024 * 1024)) : 0

        combined.push({
          key: v.key,
          name: v.name,
          language: `${v.language.name_english} (${v.language.country_english})`,
          quality: v.quality,
          size,
          engine: 'piper',
          installed: isInstalled,
          isDownloading: downloading === v.key
        })
      })
    }

    // Add XTTS voices
    if (modelFilter === 'all' || modelFilter === 'xtts') {
      xttsVoices.forEach((v) => {
        const langName = xttsLanguages.find((l) => l.code === v.language)?.name || v.language
        combined.push({
          key: v.id,
          name: v.name,
          language: langName,
          quality: 'clone',
          size: 0,
          engine: 'xtts',
          installed: true,
          isDownloading: downloading === v.id,
          createdAt: v.createdAt
        })
      })

      xttsSampleVoices.forEach((v) => {
        if (xttsVoices.some((uv) => uv.id === v.id)) return
        const langName = xttsLanguages.find((l) => l.code === v.language)?.name || v.language
        combined.push({
          key: v.id,
          name: v.name,
          language: langName,
          quality: 'sample',
          size: 0,
          engine: 'xtts',
          installed: v.installed,
          isDownloading: downloading === v.id
        })
      })
    }

    return combined
      .filter((v) => {
        if (searchQuery) {
          const q = searchQuery.toLowerCase()
          if (!v.name.toLowerCase().includes(q) && !v.key.toLowerCase().includes(q) && !v.language.toLowerCase().includes(q)) {
            return false
          }
        }
        if (languageFilter !== 'all' && !v.language.toLowerCase().includes(languageFilter.toLowerCase())) {
          return false
        }
        if (qualityFilter !== 'all' && v.quality !== qualityFilter) {
          return false
        }
        return true
      })
      .sort((a, b) => {
        if (a.installed !== b.installed) return a.installed ? -1 : 1
        if (a.engine !== b.engine) return a.engine === 'xtts' ? -1 : 1
        if (a.language !== b.language) return a.language.localeCompare(b.language)
        return a.name.localeCompare(b.name)
      })
  }, [catalog, installed, xttsVoices, xttsSampleVoices, xttsLanguages, searchQuery, modelFilter, languageFilter, qualityFilter, downloading])

  async function handleDownload(voiceKey: string, engine: 'piper' | 'xtts'): Promise<void> {
    setDownloading(voiceKey)
    try {
      if (engine === 'xtts') {
        const result = await window.electronAPI.xttsDownloadSampleVoice(voiceKey)
        if (result.success) {
          const [voices, samples] = await Promise.all([
            window.electronAPI.xttsGetVoices(),
            window.electronAPI.xttsGetSampleVoices()
          ])
          setXttsVoices(voices)
          setXttsSampleVoices(samples)
        } else {
          setError(result.error || 'Download failed')
        }
      } else {
        const result = await window.electronAPI.voiceDownloadFromCatalog(voiceKey)
        if (result.success) {
          const installedData = await window.electronAPI.voiceGetInstalled()
          setInstalled(installedData)
        } else {
          setError(result.error || 'Download failed')
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Download failed')
    }
    setDownloading(null)
  }

  async function handleImportCustom(): Promise<void> {
    const result = await window.electronAPI.voiceImportCustom()
    if (result.success) {
      const installedData = await window.electronAPI.voiceGetInstalled()
      setInstalled(installedData)
    } else if (result.error) {
      setError(result.error)
    }
  }

  function handleOpenFolder(): void {
    window.electronAPI.voiceOpenCustomFolder()
  }

  function handleSelect(voice: CombinedVoice): void {
    if (voice.installed) {
      onVoiceSelect?.(voice.key, voice.engine)
      onClose()
    }
  }

  function handlePreview(voiceKey: string, e: React.MouseEvent): void {
    e.stopPropagation()

    if (previewAudio) {
      if (previewAudio._stop) {
        previewAudio._stop()
      } else {
        previewAudio.pause()
        previewAudio.src = ''
      }
      setPreviewAudio(null)
    }

    if (playingPreview === voiceKey) {
      setPlayingPreview(null)
      return
    }

    const sampleUrl = getSampleUrl(voiceKey)
    if (!sampleUrl) {
      setError('No preview available for this voice')
      return
    }

    const audio = new Audio(sampleUrl) as ExtendedAudioElement
    audio.volume = voiceVolume
    let intentionallyStopped = false

    audio.onended = () => {
      setPlayingPreview(null)
      setPreviewAudio(null)
    }
    audio.onerror = () => {
      if (!intentionallyStopped) {
        setPlayingPreview(null)
        setPreviewAudio(null)
        setError('Failed to load audio preview')
      }
    }

    audio._stop = () => {
      intentionallyStopped = true
      audio.pause()
      audio.src = ''
    }

    audio.play()
    setPreviewAudio(audio)
    setPlayingPreview(voiceKey)
  }

  async function handleDeleteXtts(voiceId: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    if (!confirm('Delete this voice clone?')) return
    const result = await window.electronAPI.xttsDeleteVoice(voiceId)
    if (result.success) {
      setXttsVoices((prev) => prev.filter((v) => v.id !== voiceId))
    } else {
      setError(result.error || 'Failed to delete voice')
    }
  }

  async function handleInstallXtts(): Promise<void> {
    setError(null)
    try {
      const result = await window.electronAPI.xttsInstall()
      if (result.success) {
        setXttsStatus({ installed: true })
      } else {
        setError(result.error || 'XTTS installation failed')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'XTTS installation failed')
    }
  }

  async function handleCreateXttsVoice(name: string, language: string, audioPath: string): Promise<void> {
    setError(null)
    try {
      const result = await window.electronAPI.xttsCreateVoice(audioPath, name, language)
      if (result.success) {
        const voices = await window.electronAPI.xttsGetVoices()
        setXttsVoices(voices)
        setShowCreateXtts(false)
      } else {
        setError(result.error || 'Failed to create voice')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create voice')
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal voice-browser-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Voice Browser</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <VoiceFilters
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          modelFilter={modelFilter}
          onModelFilterChange={setModelFilter}
          languageFilter={languageFilter}
          onLanguageFilterChange={setLanguageFilter}
          qualityFilter={qualityFilter}
          onQualityFilterChange={setQualityFilter}
          languages={languages}
          qualities={qualities}
          onRefresh={() => loadData(true)}
          loading={loading}
        />

        <div className="voice-browser-content">
          {loading ? (
            <div className="voice-browser-loading">Loading voice catalog...</div>
          ) : error ? (
            <div className="voice-browser-error">
              {error}
              <button className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          ) : (
            <VoiceList
              voices={filteredVoices}
              playingPreview={playingPreview}
              onSelect={handleSelect}
              onPreview={handlePreview}
              onDownload={handleDownload}
              onDeleteXtts={handleDeleteXtts}
            />
          )}
        </div>

        <div className="voice-browser-footer">
          <div className="voice-browser-actions">
            <button className="btn-secondary" onClick={handleImportCustom}>
              Import Piper...
            </button>
            <button className="btn-secondary" onClick={() => setShowCreateXtts(true)}>
              Create XTTS Voice...
            </button>
            <button className="btn-secondary" onClick={handleOpenFolder}>
              Open Folder
            </button>
          </div>
          <div className="voice-browser-stats">{!loading && `Showing ${filteredVoices.length} voices`}</div>
        </div>

        {showCreateXtts && (
          <XttsCreateDialog
            xttsStatus={xttsStatus}
            xttsLanguages={xttsLanguages}
            voiceVolume={voiceVolume}
            onClose={() => setShowCreateXtts(false)}
            onInstallXtts={handleInstallXtts}
            onCreateVoice={handleCreateXttsVoice}
            onError={setError}
          />
        )}
      </div>
    </div>
  )
}
