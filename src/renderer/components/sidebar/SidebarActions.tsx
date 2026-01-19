import React, { useRef } from 'react'
import { Project } from '../../stores/workspace.js'
import { VoiceControls } from '../VoiceControls.js'

interface SidebarActionsProps {
  activeTabId: string | null
  focusedProject: Project | undefined
  apiStatus: { running: boolean; port?: number } | undefined
  isDebugMode: boolean
  onOpenSettings: () => void
  onOpenProjectSettings: (project: Project) => void
  onToggleApi: (project: Project) => void
}

export const SidebarActions = React.memo(function SidebarActions({
  activeTabId,
  focusedProject,
  apiStatus,
  isDebugMode,
  onOpenSettings,
  onOpenProjectSettings,
  onToggleApi,
}: SidebarActionsProps) {
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId

  return (
    <div className="sidebar-actions">
      <VoiceControls
        activeTabId={activeTabId}
        onTranscription={(text) => {
          const currentTabId = activeTabIdRef.current
          if (currentTabId) {
            window.electronAPI.writePty(currentTabId, text)
            setTimeout(() => window.electronAPI.writePty(currentTabId, '\r'), 100)
          }
        }}
      />
      {focusedProject && (
        <button
          className={`action-icon-btn ${apiStatus?.running ? 'enabled' : ''}`}
          onClick={() => {
            if (!focusedProject.apiPort) {
              onOpenProjectSettings(focusedProject)
            } else {
              onToggleApi(focusedProject)
            }
          }}
          tabIndex={0}
          title={
            apiStatus?.running
              ? `Stop API (port ${focusedProject.apiPort})`
              : focusedProject.apiPort
                ? `Start API (port ${focusedProject.apiPort})`
                : 'Configure API'
          }
          aria-label={
            apiStatus?.running
              ? `Stop API (port ${focusedProject.apiPort})`
              : focusedProject.apiPort
                ? `Start API (port ${focusedProject.apiPort})`
                : 'Configure API'
          }
        >
          {apiStatus?.running ? '🟢' : '🔌'}
        </button>
      )}
      {isDebugMode && (
        <button
          className="action-icon-btn"
          onClick={() => window.electronAPI.refresh()}
          tabIndex={0}
          title="Refresh (Debug Mode)"
          aria-label="Refresh (Debug Mode)"
        >
          🔄
        </button>
      )}
      <button
        className="action-icon-btn"
        onClick={onOpenSettings}
        tabIndex={0}
        title="Settings"
        aria-label="Settings"
      >
        ⚙️
      </button>
    </div>
  )
})
