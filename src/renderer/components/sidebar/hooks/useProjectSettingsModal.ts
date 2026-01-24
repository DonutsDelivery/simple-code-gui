import { useState, useCallback } from 'react'
import { Project } from '../../../stores/workspace.js'
import { ProjectSettingsModalState, InstalledVoice } from '../types.js'
import { COMMON_TOOLS } from '../constants.js'

interface UseProjectSettingsModalOptions {
  onUpdateProject: (path: string, updates: Partial<Project>) => void
}

interface UseProjectSettingsModalReturn {
  projectSettingsModal: ProjectSettingsModalState | null
  installedVoices: InstalledVoice[]
  globalVoiceSettings: { voice: string; engine: string }
  globalPermissions: { tools: string[]; mode: string }
  apiStatus: Record<string, { running: boolean; port?: number }>
  setApiStatus: React.Dispatch<
    React.SetStateAction<Record<string, { running: boolean; port?: number }>>
  >
  handleOpenProjectSettings: (project: Project) => Promise<void>
  handleSaveProjectSettings: () => Promise<void>
  handleToggleApi: (project: Project) => Promise<void>
  setProjectSettingsModal: React.Dispatch<
    React.SetStateAction<ProjectSettingsModalState | null>
  >
  handleToggleTool: (tool: string) => void
  handleAllowAll: () => void
  handleClearAll: () => void
  handleProjectSettingsChange: (updates: Partial<ProjectSettingsModalState>) => void
}

export function useProjectSettingsModal({
  onUpdateProject,
}: UseProjectSettingsModalOptions): UseProjectSettingsModalReturn {
  const [projectSettingsModal, setProjectSettingsModal] =
    useState<ProjectSettingsModalState | null>(null)
  const [installedVoices, setInstalledVoices] = useState<InstalledVoice[]>([])
  const [globalVoiceSettings, setGlobalVoiceSettings] = useState<{
    voice: string
    engine: string
  }>({ voice: '', engine: '' })
  const [globalPermissions, setGlobalPermissions] = useState<{
    tools: string[]
    mode: string
  }>({ tools: [], mode: 'default' })
  const [apiStatus, setApiStatus] = useState<
    Record<string, { running: boolean; port?: number }>
  >({})

  const handleOpenProjectSettings = useCallback(async (project: Project) => {
    const settings = await window.electronAPI?.getSettings()
    setGlobalPermissions({
      tools: settings?.autoAcceptTools || [],
      mode: settings?.permissionMode || 'default',
    })

    try {
      const [piperVoices, xttsVoices, voiceSettings] = await Promise.all([
        (window.electronAPI?.voiceGetInstalled?.() || []) as InstalledVoice[],
        window.electronAPI?.xttsGetVoices?.() || [],
        window.electronAPI?.voiceGetSettings?.() || {},
      ])
      const combined: InstalledVoice[] = []
      if (piperVoices) combined.push(...piperVoices)
      if (xttsVoices) {
        combined.push(
          ...xttsVoices.map((v: { id: string; name: string }) => ({
            key: v.id,
            displayName: v.name,
            source: 'xtts',
          }))
        )
      }
      setInstalledVoices(combined)
      const voice = (voiceSettings as { ttsVoice?: string }).ttsVoice || ''
      const engine = (voiceSettings as { ttsEngine?: string }).ttsEngine || 'piper'
      setGlobalVoiceSettings({ voice, engine })
    } catch (e) {
      console.error('Failed to load voice settings:', e)
      setInstalledVoices([])
      setGlobalVoiceSettings({ voice: '', engine: 'piper' })
    }

    setProjectSettingsModal({
      project,
      apiPort: project.apiPort?.toString() || '',
      apiAutoStart: project.apiAutoStart || false,
      apiSessionMode: project.apiSessionMode || 'existing',
      apiModel: project.apiModel || 'default',
      tools: project.autoAcceptTools || [],
      permissionMode: project.permissionMode || 'default',
      ttsVoice: project.ttsVoice || '',
      ttsEngine: project.ttsEngine || '',
      backend: project.backend || 'default',
    })
  }, [])

  const handleSaveProjectSettings = useCallback(async () => {
    if (!projectSettingsModal) return

    const port = parseInt(projectSettingsModal.apiPort, 10)
    const hasPortValue = projectSettingsModal.apiPort.trim() !== ''

    if (hasPortValue && (isNaN(port) || port < 1024 || port > 65535)) {
      setProjectSettingsModal({
        ...projectSettingsModal,
        apiStatus: 'error',
        apiError: 'Please enter a valid port number (1024-65535)',
      })
      return
    }

    const newPort = hasPortValue ? port : undefined
    const oldPort = projectSettingsModal.project.apiPort

    if (newPort !== oldPort) {
      if (!newPort) {
        await window.electronAPI?.apiStop?.(projectSettingsModal.project.path)
        setApiStatus((prev) => ({
          ...prev,
          [projectSettingsModal.project.path]: { running: false },
        }))
      } else {
        setProjectSettingsModal({ ...projectSettingsModal, apiStatus: 'checking' })
        const result = await window.electronAPI?.apiStart?.(
          projectSettingsModal.project.path,
          newPort
        )
        if (!result?.success) {
          setProjectSettingsModal({
            ...projectSettingsModal,
            apiStatus: 'error',
            apiError: result?.error || 'Port may already be in use',
          })
          return
        }
        setApiStatus((prev) => ({
          ...prev,
          [projectSettingsModal.project.path]: { running: true, port: newPort },
        }))
      }
    }

    onUpdateProject(projectSettingsModal.project.path, {
      apiPort: newPort,
      apiAutoStart: projectSettingsModal.apiAutoStart || undefined,
      apiSessionMode:
        projectSettingsModal.apiSessionMode !== 'existing'
          ? projectSettingsModal.apiSessionMode
          : undefined,
      apiModel:
        projectSettingsModal.apiModel !== 'default'
          ? projectSettingsModal.apiModel
          : undefined,
      autoAcceptTools:
        projectSettingsModal.tools.length > 0 ? projectSettingsModal.tools : undefined,
      permissionMode:
        projectSettingsModal.permissionMode !== 'default'
          ? projectSettingsModal.permissionMode
          : undefined,
      ttsVoice: projectSettingsModal.ttsVoice || undefined,
      ttsEngine: projectSettingsModal.ttsEngine || undefined,
      backend:
        projectSettingsModal.backend !== 'default'
          ? projectSettingsModal.backend
          : undefined,
    })

    setProjectSettingsModal(null)
  }, [projectSettingsModal, onUpdateProject])

  const handleToggleApi = useCallback(
    async (project: Project) => {
      const status = apiStatus[project.path]
      if (status?.running) {
        await window.electronAPI?.apiStop?.(project.path)
        setApiStatus((prev) => ({ ...prev, [project.path]: { running: false } }))
      } else if (project.apiPort) {
        const result = await window.electronAPI?.apiStart?.(project.path, project.apiPort)
        if (result?.success) {
          setApiStatus((prev) => ({
            ...prev,
            [project.path]: { running: true, port: project.apiPort },
          }))
        } else {
          alert(`Failed to start API server: ${result?.error || 'Unknown error'}`)
        }
      }
    },
    [apiStatus]
  )

  const handleToggleTool = useCallback((tool: string) => {
    setProjectSettingsModal((prev) => {
      if (!prev) return null
      const newTools = prev.tools.includes(tool)
        ? prev.tools.filter((t) => t !== tool)
        : [...prev.tools, tool]
      return { ...prev, tools: newTools }
    })
  }, [])

  const handleAllowAll = useCallback(() => {
    setProjectSettingsModal((prev) => {
      if (!prev) return null
      const allTools = COMMON_TOOLS.map((t) => t.value)
      return { ...prev, tools: allTools, permissionMode: 'bypassPermissions' }
    })
  }, [])

  const handleClearAll = useCallback(() => {
    setProjectSettingsModal((prev) => {
      if (!prev) return null
      return { ...prev, tools: [], permissionMode: 'default' }
    })
  }, [])

  const handleProjectSettingsChange = useCallback(
    (updates: Partial<ProjectSettingsModalState>) => {
      setProjectSettingsModal((prev) => (prev ? { ...prev, ...updates } : null))
    },
    []
  )

  return {
    projectSettingsModal,
    installedVoices,
    globalVoiceSettings,
    globalPermissions,
    apiStatus,
    setApiStatus,
    handleOpenProjectSettings,
    handleSaveProjectSettings,
    handleToggleApi,
    setProjectSettingsModal,
    handleToggleTool,
    handleAllowAll,
    handleClearAll,
    handleProjectSettingsChange,
  }
}
