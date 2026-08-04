import React from 'react'
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
  onTranscription: (text: string) => void
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
  onTranscription,
}: SidebarActionsProps) {
  return (
    <VoiceControls
      activeTabId={activeTabId}
      onTranscription={onTranscription}
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
