import React, { useRef } from 'react'
import { Project } from '../../stores/workspace.js'
import { VoiceControls } from '../VoiceControls.js'
import { SidebarActionDock } from './SidebarActionDock.js'

interface SidebarActionsProps {
  activeTabId: string | null
  focusedTabId: string | null
  focusedProject: Project | undefined
  apiStatus: { running: boolean; port?: number } | undefined
  isDebugMode: boolean
  onOpenSettings: () => void
  onOpenProjectSettings: (project: Project) => void
  onToggleApi: (project: Project) => void
  onOpenMobileConnect?: () => void
}

export const SidebarActions = React.memo(function SidebarActions({
  activeTabId,
  focusedTabId,
  focusedProject,
  apiStatus,
  isDebugMode,
  onOpenSettings,
  onOpenProjectSettings,
  onToggleApi,
  onOpenMobileConnect,
}: SidebarActionsProps) {
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const focusedTabIdRef = useRef(focusedTabId)
  focusedTabIdRef.current = focusedTabId

  return (
    <VoiceControls
      activeTabId={activeTabId}
      onTranscription={(text) => {
        // Use focusedTabId (last clicked tile) over activeTabId (last opened tab)
        const currentTabId = focusedTabIdRef.current || activeTabIdRef.current
        if (currentTabId && window.electronAPI?.writePty) {
          window.electronAPI.writePty(currentTabId, text)
          setTimeout(() => window.electronAPI?.writePty?.(currentTabId, '\r'), 100)
        }
      }}
    >
      {(voice) => (
        <SidebarActionDock
          voice={voice}
          focusedProject={focusedProject}
          apiStatus={apiStatus}
          isDebugMode={isDebugMode}
          onOpenSettings={onOpenSettings}
          onOpenProjectSettings={onOpenProjectSettings}
          onToggleApi={onToggleApi}
          onOpenConnections={onOpenMobileConnect}
        />
      )}
    </VoiceControls>
  )
})
