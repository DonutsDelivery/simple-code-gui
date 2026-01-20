import React, { useState, useEffect } from 'react'
import type { Theme } from '../themes'
import { VoiceBrowserModal } from './VoiceBrowserModal'
import { useVoice } from '../contexts/VoiceContext'
import { useFocusTrap } from '../hooks/useFocusTrap'
import {
  ThemeSettings,
  ProjectDirectorySettings,
  PermissionsSettings,
  BackendSettings,
  ExtensionsSettings,
  VoiceInputSettings,
  VoiceOutputSettings,
  UninstallTTSSection,
  DEFAULT_GENERAL,
  DEFAULT_VOICE,
  DEFAULT_XTTS,
  DEFAULT_UI,
} from './settings'
import type {
  GeneralSettings,
  VoiceSettings,
  XttsSettings,
  UIState,
  SettingsModalProps,
} from './settings'

export function SettingsModal({ isOpen, onClose, onThemeChange, onSaved }: SettingsModalProps): React.ReactElement | null {
  // Grouped state: general settings (theme, directory, permissions, backend)
  const [general, setGeneral] = useState<GeneralSettings>(DEFAULT_GENERAL)

  // Focus trap for modal accessibility
  const focusTrapRef = useFocusTrap<HTMLDivElement>(isOpen)

  // Voice context for active whisper model and volume
  const { whisperModel: activeWhisperModel, setWhisperModel: setActiveWhisperModel, volume: voiceVolume } = useVoice()

  // Extensions state
  const [installedExtensions, setInstalledExtensions] = useState<Array<{ id: string; name: string; type: string }>>([])

  // Grouped state: voice settings (TTS, whisper status, selected voice/engine)
  const [voice, setVoice] = useState<VoiceSettings>(DEFAULT_VOICE)

  // Grouped state: XTTS quality settings
  const [xtts, setXtts] = useState<XttsSettings>(DEFAULT_XTTS)

  // Grouped state: UI/loading states
  const [ui, setUI] = useState<UIState>(DEFAULT_UI)

  // Load installed voices (Piper and XTTS)
  async function refreshInstalledVoices(): Promise<void> {
    try {
      const [piperVoices, xttsVoices] = await Promise.all([
        window.electronAPI?.voiceGetInstalled?.(),
        window.electronAPI?.xttsGetVoices?.()
      ])
      const combined: Array<{ key: string; displayName: string; source: string }> = []
      if (piperVoices) combined.push(...piperVoices)
      if (xttsVoices) {
        combined.push(...xttsVoices.map((v: { id: string; name: string }) => ({
          key: v.id,
          displayName: v.name,
          source: 'xtts'
        })))
      }
      setVoice(prev => ({ ...prev, installedVoices: combined }))
    } catch (e) {
      console.error('Failed to refresh installed voices:', e)
      setVoice(prev => ({ ...prev, installedVoices: [] }))
    }
  }

  useEffect(() => {
    if (isOpen) {
      window.electronAPI?.getSettings?.()?.then((settings) => {
        setGeneral(prev => ({
          ...prev,
          defaultProjectDir: settings.defaultProjectDir || '',
          selectedTheme: settings.theme || 'default',
          autoAcceptTools: settings.autoAcceptTools || [],
          permissionMode: settings.permissionMode || 'default',
          backend: settings.backend || 'claude'
        }))
      })

      // Load voice settings (active voice)
      window.electronAPI?.voiceGetSettings?.()?.then((voiceSettings: { ttsVoice?: string; ttsEngine?: string; ttsSpeed?: number; xttsTemperature?: number; xttsTopK?: number; xttsTopP?: number; xttsRepetitionPenalty?: number }) => {
        if (voiceSettings) {
          setVoice(prev => ({
            ...prev,
            selectedVoice: voiceSettings.ttsVoice || 'en_US-libritts_r-medium',
            selectedEngine: (voiceSettings.ttsEngine as 'piper' | 'xtts') || 'piper',
            ttsSpeed: voiceSettings.ttsSpeed || 1.0
          }))
          setXtts({
            temperature: voiceSettings.xttsTemperature ?? 0.65,
            topK: voiceSettings.xttsTopK ?? 50,
            topP: voiceSettings.xttsTopP ?? 0.85,
            repetitionPenalty: voiceSettings.xttsRepetitionPenalty ?? 2.0
          })
        }
      })?.catch(e => console.error('Failed to load voice settings:', e))

      // Load voice status
      window.electronAPI?.voiceCheckWhisper?.()?.then(status => {
        setVoice(prev => ({ ...prev, whisperStatus: status }))
      })?.catch(e => console.error('Failed to check Whisper status:', e))

      window.electronAPI?.voiceCheckTTS?.()?.then(status => {
        setVoice(prev => ({ ...prev, ttsStatus: status }))
      })?.catch(e => console.error('Failed to check TTS status:', e))

      refreshInstalledVoices()

      // Load installed extensions
      window.electronAPI?.extensionsGetInstalled?.()?.then(exts => {
        setInstalledExtensions(exts || [])
      })?.catch(e => console.error('Failed to load installed extensions:', e))
    } else {
      setUI(prev => ({ ...prev, playingPreview: null, previewLoading: null }))
    }
  }, [isOpen])

  async function handleSave(): Promise<void> {
    const newSettings = {
      defaultProjectDir: general.defaultProjectDir,
      theme: general.selectedTheme,
      autoAcceptTools: general.autoAcceptTools,
      permissionMode: general.permissionMode,
      backend: general.backend
    }
    await window.electronAPI?.saveSettings(newSettings)
    // Save voice settings including XTTS quality settings
    await window.electronAPI?.voiceApplySettings?.({
      ttsVoice: voice.selectedVoice,
      ttsEngine: voice.selectedEngine,
      ttsSpeed: voice.ttsSpeed,
      xttsTemperature: xtts.temperature,
      xttsTopK: xtts.topK,
      xttsTopP: xtts.topP,
      xttsRepetitionPenalty: xtts.repetitionPenalty
    })
    onSaved?.(newSettings)
    onClose()
  }

  function handleVoiceSelect(voiceKey: string, source: string): void {
    setVoice(prev => ({
      ...prev,
      selectedVoice: voiceKey,
      selectedEngine: source === 'xtts' ? 'xtts' : 'piper'
    }))
  }

  function toggleTool(tool: string): void {
    setGeneral(prev => ({
      ...prev,
      autoAcceptTools: prev.autoAcceptTools.includes(tool)
        ? prev.autoAcceptTools.filter(t => t !== tool)
        : [...prev.autoAcceptTools, tool]
    }))
  }

  function addCustomTool(): void {
    const trimmed = general.customTool.trim()
    if (trimmed && !general.autoAcceptTools.includes(trimmed)) {
      setGeneral(prev => ({
        ...prev,
        autoAcceptTools: [...prev.autoAcceptTools, trimmed],
        customTool: ''
      }))
    }
  }

  function removeCustomTool(tool: string): void {
    setGeneral(prev => ({
      ...prev,
      autoAcceptTools: prev.autoAcceptTools.filter(t => t !== tool)
    }))
  }

  async function handleInstallWhisperModel(model: string): Promise<void> {
    setUI(prev => ({ ...prev, installingModel: model }))
    try {
      await window.electronAPI?.voiceInstallWhisper?.(model)
      const status = await window.electronAPI?.voiceCheckWhisper?.()
      if (status) setVoice(prev => ({ ...prev, whisperStatus: status }))
    } catch (e) {
      console.error('Failed to install Whisper model:', e)
    }
    setUI(prev => ({ ...prev, installingModel: null }))
  }

  // Remove TTS instructions from all projects (uninstall feature)
  async function handleRemoveTTSFromAllProjects(): Promise<void> {
    if (!confirm('This will remove TTS voice output instructions from CLAUDE.md files in ALL your projects. This is useful if you want to stop using Claude Terminal.\n\nContinue?')) {
      return
    }

    setUI(prev => ({ ...prev, removingTTS: true, ttsRemovalResult: null }))

    try {
      const workspace = await window.electronAPI?.getWorkspace()
      const projects = workspace?.projects || []

      let success = 0
      let failed = 0

      for (const project of projects) {
        try {
          const result = await window.electronAPI?.ttsRemoveInstructions?.(project.path)
          if (result?.success) {
            success++
          } else {
            failed++
          }
        } catch {
          failed++
        }
      }

      setUI(prev => ({ ...prev, ttsRemovalResult: { success, failed } }))
    } catch (e) {
      console.error('Failed to remove TTS instructions:', e)
      setUI(prev => ({ ...prev, ttsRemovalResult: { success: 0, failed: 1 } }))
    }

    setUI(prev => ({ ...prev, removingTTS: false }))
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" ref={focusTrapRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-content">
          <ThemeSettings
            selectedTheme={general.selectedTheme}
            onThemeChange={onThemeChange}
            onSelect={(themeId) => setGeneral(prev => ({ ...prev, selectedTheme: themeId }))}
          />

          <ProjectDirectorySettings
            defaultProjectDir={general.defaultProjectDir}
            onChange={(dir) => setGeneral(prev => ({ ...prev, defaultProjectDir: dir }))}
          />

          <PermissionsSettings
            autoAcceptTools={general.autoAcceptTools}
            permissionMode={general.permissionMode}
            customTool={general.customTool}
            onToggleTool={toggleTool}
            onPermissionModeChange={(mode) => setGeneral(prev => ({ ...prev, permissionMode: mode }))}
            onCustomToolChange={(tool) => setGeneral(prev => ({ ...prev, customTool: tool }))}
            onAddCustomTool={addCustomTool}
            onRemoveCustomTool={removeCustomTool}
          />

          <BackendSettings
            backend={general.backend}
            onChange={(backend) => setGeneral(prev => ({ ...prev, backend }))}
          />

          <ExtensionsSettings installedExtensions={installedExtensions} />

          <VoiceInputSettings
            whisperStatus={voice.whisperStatus}
            activeWhisperModel={activeWhisperModel}
            installingModel={ui.installingModel}
            onSetActiveModel={setActiveWhisperModel}
            onInstallModel={handleInstallWhisperModel}
          />

          <VoiceOutputSettings
            voice={voice}
            xtts={xtts}
            playingPreview={ui.playingPreview}
            previewLoading={ui.previewLoading}
            voiceVolume={voiceVolume}
            onVoiceSelect={handleVoiceSelect}
            onSpeedChange={(speed) => setVoice(prev => ({ ...prev, ttsSpeed: speed }))}
            onXttsChange={setXtts}
            onShowVoiceBrowser={() => setUI(prev => ({ ...prev, showVoiceBrowser: true }))}
            onPreviewStateChange={(state) => setUI(prev => ({ ...prev, ...state }))}
          />

          <UninstallTTSSection
            removingTTS={ui.removingTTS}
            ttsRemovalResult={ui.ttsRemovalResult}
            onRemove={handleRemoveTTSFromAllProjects}
          />
        </div>
        <div className="modal-footer">
          <a
            href="https://ko-fi.com/donutsdelivery"
            target="_blank"
            rel="noopener noreferrer"
            className="kofi-link"
            onClick={(e) => {
              e.preventDefault()
              window.electronAPI?.openExternal?.('https://ko-fi.com/donutsdelivery')
            }}
          >
            ♥ Support on Ko-fi
          </a>
          <div className="modal-footer-buttons">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>

      <VoiceBrowserModal
        isOpen={ui.showVoiceBrowser}
        onClose={() => {
          setUI(prev => ({ ...prev, showVoiceBrowser: false }))
          refreshInstalledVoices()
        }}
        onVoiceSelect={(voiceKey, engine) => {
          setVoice(prev => ({
            ...prev,
            selectedVoice: voiceKey,
            selectedEngine: engine === 'xtts' ? 'xtts' : 'piper'
          }))
          window.electronAPI?.voiceSetVoice?.({ voice: voiceKey, engine })
        }}
      />
    </div>
  )
}
