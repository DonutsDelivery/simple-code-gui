/**
 * Workspace API Methods
 *
 * Workspace, settings, session, TTS, and project management methods for the HTTP backend.
 */

import {
  Settings,
  Workspace,
  Session,
  ApiOpenSessionCallback,
  Unsubscribe,
  BackendId
} from '../types'
import { ConnectionManager } from './connection'
import type { CommandEnvelope } from '../../../common/server-protocol.js'
import type { EnvironmentCommandResult, EnvironmentEventsResult, EnvironmentSnapshot } from '../../../common/environment-protocol.js'
import type { EnvironmentCommand } from '../../../main/environment-command-router.js'

export class WorkspaceApi {
  private connection: ConnectionManager
  private apiOpenSessionCallbacks: Set<ApiOpenSessionCallback> = new Set()

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  // Session Management

  async discoverSessions(projectPath: string, backend?: BackendId): Promise<Session[]> {
    const params = new URLSearchParams({ path: projectPath })
    if (backend) {
      params.set('backend', backend)
    }

    const data = await this.connection.fetchJson<{ sessions: Session[] }>(
      `/api/sessions?${params}`
    )
    return data.sessions
  }

  // Workspace Management

  async getWorkspace(): Promise<Workspace> {
    return this.connection.fetchJson<Workspace>('/api/workspace')
  }

  async saveWorkspace(workspace: Workspace): Promise<void> {
    const snapshot = await this.getEnvironmentSnapshot()
    await this.executeEnvironmentCommand({
      clientId: 'http-workspace-compatibility',
      commandId: crypto.randomUUID(),
      serverId: snapshot.serverId,
      expectedRevision: snapshot.revision,
      command: { type: 'replace-workspace', workspace },
    })
  }

  async getEnvironmentSnapshot(): Promise<EnvironmentSnapshot<Workspace>> {
    return this.connection.fetchJson<EnvironmentSnapshot<Workspace>>('/api/environment/snapshot')
  }

  async getEnvironmentEvents(afterRevision: number): Promise<EnvironmentEventsResult<Workspace>> {
    return this.connection.fetchJson<EnvironmentEventsResult<Workspace>>(`/api/environment/events?after=${afterRevision}`)
  }

  async executeEnvironmentCommand(command: CommandEnvelope<EnvironmentCommand>): Promise<EnvironmentCommandResult> {
    return this.connection.fetchJson<EnvironmentCommandResult>('/api/environment/commands', {
      method: 'POST',
      body: JSON.stringify(command),
    })
  }

  // Settings Management

  async getSettings(): Promise<Settings> {
    return this.connection.fetchJson<Settings>('/api/settings')
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.connection.fetchJson('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings)
    })
  }

  // Project Management

  async addProject(): Promise<string | null> {
    // HTTP backend cannot open a native file dialog on the desktop
    // Instead, mobile clients should browse/select paths differently
    // This could be implemented via a file browser endpoint in the future
    console.warn('[HttpBackend] addProject() - Native dialogs not available via HTTP')
    return null
  }

  async addProjectsFromParent(): Promise<Array<{ path: string; name: string }> | null> {
    // HTTP backend cannot open a native file dialog on the desktop
    console.warn('[HttpBackend] addProjectsFromParent() - Native dialogs not available via HTTP')
    return null
  }

  // TTS (Text-to-Speech)

  async ttsInstallInstructions(projectPath: string, _aiBackend?: string): Promise<{ success: boolean }> {
    // TTS instruction installation is a desktop-only feature
    // The mobile app uses the host's TTS directly
    console.warn('[HttpBackend] ttsInstallInstructions() - Desktop-only feature')
    return { success: false }
  }

  async ttsSpeak(
    text: string
  ): Promise<{ success: boolean; audioData?: string; error?: string }> {
    try {
      const data = await this.connection.fetchJson<{
        success: boolean
        audioData?: string
        error?: string
        format?: string
      }>('/api/tts/speak', {
        method: 'POST',
        body: JSON.stringify({ text })
      })
      return data
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'TTS failed'
      }
    }
  }

  async ttsStop(): Promise<{ success: boolean }> {
    try {
      return await this.connection.fetchJson<{ success: boolean }>('/api/tts/stop', {
        method: 'POST'
      })
    } catch (error) {
      return { success: false }
    }
  }

  // Events

  onApiOpenSession(callback: ApiOpenSessionCallback): Unsubscribe {
    // API open session events would come via WebSocket from the main connection
    // For now, this is primarily used in the desktop app
    // Mobile clients don't typically receive these events
    this.apiOpenSessionCallbacks.add(callback)
    return () => {
      this.apiOpenSessionCallbacks.delete(callback)
    }
  }
}
