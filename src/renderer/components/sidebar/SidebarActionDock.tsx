import React, { useEffect, useState } from 'react'
import type { Project } from '../../stores/workspace.js'
import type { VoiceControlState } from '../VoiceControls.js'
import { SidebarActionOverflow, type SidebarOverflowAction } from './SidebarActionOverflow.js'

type DockIconName = 'microphone' | 'connections' | 'settings' | 'headphones' | 'speaker' | 'api' | 'refresh'

function DockIcon({ name }: { name: DockIconName }): React.ReactElement {
  const paths: Record<DockIconName, React.ReactNode> = {
    microphone: <><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
    connections: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /><path d="M8 9h.01M12 9h4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.18.37.4.7.6 1 .28.3.66.47 1.1.5h.09v4h-.09c-.44.03-.82.2-1.1.5-.2.3-.42.63-.6 1Z" /></>,
    headphones: <><path d="M4 13v-1a8 8 0 0 1 16 0v1" /><path d="M4 13h3v7H5a1 1 0 0 1-1-1v-6ZM20 13h-3v7h2a1 1 0 0 0 1-1v-6Z" /></>,
    speaker: <><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></>,
    api: <><path d="M8 12h8M12 8v8" /><rect x="3" y="3" width="18" height="18" rx="5" /></>,
    refresh: <><path d="M20 6v5h-5M4 18v-5h5" /><path d="M18.4 9A7 7 0 0 0 6.2 6.2L4 8M5.6 15A7 7 0 0 0 17.8 17.8L20 16" /></>,
  }

  return (
    <svg className="sidebar-dock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

interface SidebarActionDockProps {
  voice: VoiceControlState
  focusedProject?: Project
  apiStatus?: { running: boolean; port?: number }
  isDebugMode: boolean
  onOpenSettings: () => void
  onOpenProjectSettings: (project: Project) => void
  onToggleApi: (project: Project) => void
  onOpenConnections?: () => void
}

export function SidebarActionDock({
  voice,
  focusedProject,
  apiStatus,
  isDebugMode,
  onOpenSettings,
  onOpenProjectSettings,
  onToggleApi,
  onOpenConnections,
}: SidebarActionDockProps): React.ReactElement {
  const primaryCount = onOpenConnections ? 4 : 3
  const settingsIndex = onOpenConnections ? 2 : 1
  const overflowIndex = primaryCount - 1
  const [primaryFocusIndex, setPrimaryFocusIndex] = useState(0)

  useEffect(() => {
    if (primaryFocusIndex >= primaryCount) setPrimaryFocusIndex(primaryCount - 1)
  }, [primaryCount, primaryFocusIndex])

  const movePrimaryFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.sidebar-dock-button:not(:disabled)'))
    if (buttons.length === 0) return
    event.preventDefault()
    const currentIndex = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement))
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    setPrimaryFocusIndex(nextIndex)
    buttons[nextIndex].focus()
  }

  const apiLabel = apiStatus?.running ? 'Stop project API' : focusedProject?.apiPort ? 'Start project API' : 'Configure project API'
  const apiDescription = apiStatus?.running
    ? `Listening on port ${focusedProject?.apiPort}`
    : focusedProject?.apiPort
      ? `Configured for port ${focusedProject.apiPort}`
      : 'Choose a port for this project'

  const overflowActions: SidebarOverflowAction[] = [
    {
      id: 'input-mode',
      label: voice.pushToTalkEnabled ? 'Push-to-talk input' : 'Automatic voice input',
      description: voice.pushToTalkEnabled ? 'Hold Ctrl+Space while speaking' : 'Submits after the silence threshold',
      icon: <DockIcon name="headphones" />,
      active: voice.pushToTalkEnabled,
      status: voice.pushToTalkEnabled ? 'On' : 'Auto',
      onSelect: voice.togglePushToTalk,
    },
    {
      id: 'voice-output',
      label: voice.ttsInstalled ? 'Voice output' : 'Install voice output',
      description: voice.installingTTS
        ? 'Installing the speech engine…'
        : voice.ttsInstalled
          ? 'Read assistant responses aloud'
          : 'Install Piper and the default voice',
      icon: <DockIcon name="speaker" />,
      active: voice.voiceOutputEnabled,
      disabled: voice.installingTTS,
      status: voice.installingTTS ? 'Installing' : voice.voiceOutputEnabled ? 'On' : 'Off',
      onSelect: voice.handleVoiceOutput,
    },
  ]

  if (focusedProject) {
    overflowActions.push({
      id: 'project-api',
      label: apiLabel,
      description: apiDescription,
      icon: <DockIcon name="api" />,
      active: Boolean(apiStatus?.running),
      status: apiStatus?.running ? 'Live' : 'Off',
      closeOnSelect: true,
      onSelect: () => {
        if (focusedProject.apiPort) onToggleApi(focusedProject)
        else onOpenProjectSettings(focusedProject)
      },
    })
  }

  if (isDebugMode) {
    overflowActions.push({
      id: 'debug-refresh',
      label: 'Refresh interface',
      description: 'Reload the renderer in debug mode',
      icon: <DockIcon name="refresh" />,
      closeOnSelect: true,
      onSelect: () => window.electronAPI?.refresh?.(),
    })
  }

  return (
    <div className="sidebar-action-dock">
      <div
        className="sidebar-dock-primary"
        role="toolbar"
        aria-label="Sidebar actions"
        style={{ gridTemplateColumns: `repeat(${primaryCount}, minmax(0, 1fr))` }}
        onKeyDown={movePrimaryFocus}
        onFocusCapture={(event) => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.sidebar-dock-button'))
          const index = buttons.indexOf(event.target as HTMLButtonElement)
          if (index >= 0) setPrimaryFocusIndex(index)
        }}
      >
        <div className="sidebar-dock-voice-wrap">
          <button
            type="button"
            className={`sidebar-dock-button ${voice.isRecording ? 'is-recording is-active' : ''} ${voice.isModelLoading ? 'is-busy' : ''}`}
            onClick={voice.handleVoiceInput}
            disabled={voice.isModelLoading}
            tabIndex={primaryFocusIndex === 0 ? 0 : -1}
            aria-label={voice.voiceInputTitle}
            title={voice.voiceInputTitle}
          >
            <DockIcon name="microphone" />
            <span>Voice</span>
            {voice.isRecording && <span className="sidebar-dock-status-dot" aria-hidden="true" />}
          </button>

          {voice.showLevelMeter && (
            <div className="voice-level-meter sidebar-dock-level-meter" aria-label={`Voice level ${voice.audioLevel} percent`}>
              <div className="voice-level-bar-bg">
                <div
                  className="voice-level-bar-fill"
                  style={{
                    height: `${voice.audioLevel}%`,
                    backgroundColor: voice.audioLevel > voice.silenceThreshold ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                />
                <div className="voice-level-threshold" style={{ bottom: `${voice.silenceThreshold}%` }} />
              </div>
              {!voice.pushToTalkEnabled && (
                <input
                  type="range"
                  className="voice-threshold-slider"
                  min="0"
                  max="50"
                  value={voice.silenceThreshold}
                  onChange={(event) => voice.setSilenceThreshold(Number(event.target.value))}
                  aria-label="Voice silence threshold"
                />
              )}
            </div>
          )}
        </div>

        {onOpenConnections && (
          <button
            type="button"
            className="sidebar-dock-button"
            onClick={onOpenConnections}
            tabIndex={primaryFocusIndex === 1 ? 0 : -1}
            aria-label="Connections and mobile pairing"
            title="Connections and mobile pairing"
          >
            <DockIcon name="connections" />
            <span>Connect</span>
          </button>
        )}

        <button
          type="button"
          className="sidebar-dock-button"
          onClick={onOpenSettings}
          tabIndex={primaryFocusIndex === settingsIndex ? 0 : -1}
          aria-label="Open settings"
          title="Open settings"
        >
          <DockIcon name="settings" />
          <span>Settings</span>
        </button>

        <SidebarActionOverflow actions={overflowActions} tabIndex={primaryFocusIndex === overflowIndex ? 0 : -1} />
      </div>
    </div>
  )
}
