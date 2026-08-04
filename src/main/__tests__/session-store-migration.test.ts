import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('../runtime-paths', () => ({
  getRuntimeDataDir: () => state.userDataDir,
}))

vi.mock('../meta-project-sync', () => ({ syncMetaProjects: vi.fn() }))

import { SessionStore } from '../session-store'

let roots: string[] = []

beforeEach(() => {
  state.userDataDir = mkdtempSync(join(tmpdir(), 'session-store-harness-'))
  roots.push(state.userDataDir)
  mkdirSync(join(state.userDataDir, 'config'))
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('SessionStore harness schema migration', () => {
  it('migrates legacy backend fields and preserves a backup before writing the current schema', () => {
    const configPath = join(state.userDataDir, 'config', 'workspace.json')
    const legacy = {
      workspace: {
        projects: [{ path: '/repo', name: 'Repo', backend: 'hermes' }],
        openTabs: [{ id: 'legacy', projectPath: '/repo', title: 'Legacy', backend: 'claude' }],
        sessions: [{
          id: 'workspace-1',
          name: 'Workspace',
          activeTabId: 'session-tab',
          openTabs: [{ id: 'session-tab', projectPath: '/repo', title: 'Session', backend: 'codex' }]
        }],
        activeTabId: 'legacy'
      },
      settings: { defaultProjectDir: '', theme: 'default', backend: 'gemini' }
    }
    writeFileSync(configPath, JSON.stringify(legacy))

    const store = new SessionStore()

    expect(store.getWorkspace().projects[0]).toMatchObject({ harnessId: 'hermes' })
    expect(store.getWorkspace().openTabs?.[0]).toMatchObject({ harnessId: 'claude' })
    expect(store.getWorkspace().sessions?.[0].openTabs[0]).toMatchObject({ harnessId: 'codex' })
    expect(store.getSettings()).toMatchObject({ defaultHarnessId: 'gemini' })

    const saved = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(saved.schemaVersion).toBe(3)
    expect(JSON.stringify(saved)).not.toContain('"backend"')
    expect(JSON.parse(readFileSync(`${configPath}.backup`, 'utf8'))).toEqual(legacy)
  })

  it('never writes legacy backend fields received through the compatibility API', () => {
    const store = new SessionStore()

    store.saveWorkspace({
      projects: [{ path: '/repo', name: 'Repo', backend: 'hermes' }],
      openTabs: [{ id: 'tab', projectPath: '/repo', title: 'Tab', backend: 'claude' }],
      activeTabId: 'tab'
    })
    store.saveSettings({ defaultProjectDir: '', theme: 'default', backend: 'codex' })

    const saved = JSON.parse(readFileSync(join(state.userDataDir, 'config', 'workspace.json'), 'utf8'))
    expect(saved.workspace.projects[0].harnessId).toBe('hermes')
    expect(saved.workspace.openTabs[0].harnessId).toBe('claude')
    expect(saved.settings.defaultHarnessId).toBe('codex')
    expect(JSON.stringify(saved)).not.toContain('"backend"')
  })

  it('atomically round-trips the authoritative snapshot, event log, and command receipts', () => {
    const store = new SessionStore()
    const authority = {
      snapshot: {
        serverId: 'server-a',
        revision: 1,
        workspace: { projects: [{ path: '/repo', name: 'Renamed' }], openTabs: [], activeTabId: null },
        sessions: [],
        ptys: [],
      },
      events: [{
        serverId: 'server-a',
        revision: 1,
        eventId: 'server-a:1',
        occurredAt: 1,
        event: { type: 'update-project', clientId: 'client', commandId: 'command', result: { success: true } },
      }],
      receipts: [{
        clientId: 'client',
        commandId: 'command',
        requestHash: 'hash',
        response: { serverId: 'server-a', revision: 1, result: { success: true }, replayed: false },
      }],
    }

    store.saveEnvironmentAuthority(authority)
    const restarted = new SessionStore()

    expect(restarted.getEnvironmentAuthority('server-a')).toEqual(authority)
    expect(restarted.getWorkspace().projects[0].name).toBe('Renamed')
  })
})
