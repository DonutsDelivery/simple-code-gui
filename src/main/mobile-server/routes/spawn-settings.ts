import type { Project, SessionStore, Settings } from '../../session-store'

export type MobileBackend = 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok'

export interface MobileSpawnSettings {
  backend: MobileBackend
  model?: string
  autoAcceptTools?: string[]
  permissionMode?: string
}

export function resolveMobileSpawnSettings(
  sessionStore: SessionStore | null,
  projectPath: string,
  requestedBackend?: MobileBackend | 'default',
  requestedModel?: string
): MobileSpawnSettings {
  const workspace = sessionStore?.getWorkspace()
  const project = workspace?.projects.find((p: Project) => p.path === projectPath)
  const globalSettings: Partial<Settings> = sessionStore?.getSettings() ?? {}

  const normalizedGlobalBackend = globalSettings.backend === 'default'
    ? undefined
    : globalSettings.backend

  const normalizedBackend = requestedBackend === 'default' ? undefined : requestedBackend
  const backend = normalizedBackend
    || (project?.backend && project.backend !== 'default'
      ? project.backend
      : normalizedGlobalBackend || 'claude')

  return {
    backend,
    model: requestedModel,
    autoAcceptTools: project?.autoAcceptTools ?? globalSettings.autoAcceptTools,
    permissionMode: project?.permissionMode ?? globalSettings.permissionMode
  }
}
