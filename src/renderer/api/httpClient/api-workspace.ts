/**
 * Workspace and Settings API
 *
 * API methods for workspace management, projects, and settings.
 */

import { HostConfig } from '../hostConfig.js'
import { get, put } from './http-helpers.js'
import type { Workspace, Settings, Session, BackendId } from './types.js'

/**
 * Get the current workspace
 */
export function getWorkspace(config: HostConfig): Promise<Workspace> {
  return get<Workspace>(config, '/projects')
}

/**
 * Save the workspace
 */
export async function saveWorkspace(config: HostConfig, workspace: Workspace): Promise<void> {
  await put<void>(config, '/projects', workspace)
}

/**
 * Discover sessions for a project
 */
export function discoverSessions(
  config: HostConfig,
  projectPath: string,
  backend?: BackendId
): Promise<Session[]> {
  const encodedPath = encodeURIComponent(projectPath)
  let url = `/terminal/discover/${encodedPath}`
  if (backend) {
    url += `?backend=${backend}`
  }
  return get<Session[]>(config, url)
}

/**
 * Get application settings
 */
export function getSettings(config: HostConfig): Promise<Settings> {
  return get<Settings>(config, '/settings')
}

/**
 * Save application settings
 */
export async function saveSettings(config: HostConfig, settings: Settings): Promise<void> {
  await put<void>(config, '/settings', settings)
}
