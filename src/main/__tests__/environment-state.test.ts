import { describe, expect, it } from 'vitest'
import { EnvironmentEventLog } from '../environment-event-log'
import { EnvironmentState } from '../environment-state'
import type { Workspace } from '../session-store'

const workspace: Workspace = {
  projects: [{ path: '/repo', name: 'Repo', harnessId: 'hermes' }],
  sessions: [{
    id: 'workspace-1',
    name: 'Workspace 1',
    openTabs: [{
      id: 'tab-1',
      projectPath: '/repo',
      sessionId: 'agent-1',
      title: 'Agent',
      ptyId: 'pty-old',
      harnessId: 'hermes',
    }],
    activeTabId: 'tab-1',
  }],
  activeSessionId: 'workspace-1',
}

describe('EnvironmentState', () => {
  it('creates one server-bound canonical snapshot without treating persisted PTYs as live', () => {
    const state = new EnvironmentState('server-a', workspace)
    const snapshot = state.getSnapshot()

    expect(snapshot).toMatchObject({ serverId: 'server-a', revision: 0, workspace })
    expect(snapshot.sessions).toEqual([expect.objectContaining({
      agentSessionId: 'agent-1',
      serverId: 'server-a',
      harnessId: 'hermes',
      projectId: '/repo',
      lifecycle: 'stopped',
    })])
    expect(snapshot.ptys).toEqual([])
  })

  it('returns event catch-up when retained and a snapshot when the cursor is too old', () => {
    const state = new EnvironmentState('server-a', workspace)
    const log = new EnvironmentEventLog<Workspace>('server-a', [], 2)
    for (let revision = 1; revision <= 3; revision++) {
      state.commit({ ...state.getSnapshot(), workspace: state.getSnapshot().workspace })
      log.append(revision, {
        type: 'test',
        clientId: 'client',
        commandId: `command-${revision}`,
        result: revision,
        snapshot: state.getSnapshot(),
      })
    }

    const recent = log.after(2, state.getSnapshot())
    expect(recent.mode).toBe('events')
    expect(recent.events?.map(event => event.revision)).toEqual([3])

    const stale = log.after(0, state.getSnapshot())
    expect(stale.mode).toBe('snapshot')
    expect(stale.snapshot?.revision).toBe(3)
  })

  it('returns defensive copies instead of mutable authority references', () => {
    const state = new EnvironmentState('server-a', workspace)
    const copy = state.getSnapshot()
    copy.workspace.projects[0].name = 'Mutated client copy'

    expect(state.getSnapshot().workspace.projects[0].name).toBe('Repo')
  })

  it('marks persisted runtimes stopped after the server process restarts', () => {
    const state = new EnvironmentState('server-a', workspace, {
      serverId: 'server-a',
      revision: 8,
      workspace,
      sessions: [{
        agentSessionId: 'agent-1',
        serverId: 'server-a',
        harnessId: 'hermes',
        projectId: '/repo',
        runtimeId: 'runtime-old',
        ptyId: 'pty-old',
        lifecycle: 'running',
      }],
      ptys: [{
        ptyId: 'pty-old',
        runtimeId: 'runtime-old',
        agentSessionId: 'agent-1',
        serverId: 'server-a',
        lifecycle: 'running',
      }],
    })

    expect(state.getSnapshot()).toMatchObject({
      revision: 8,
      sessions: [{ agentSessionId: 'agent-1', lifecycle: 'stopped' }],
      ptys: [],
    })
    expect(state.getSnapshot().sessions[0].runtimeId).toBeUndefined()
    expect(state.getSnapshot().sessions[0].ptyId).toBeUndefined()
  })
})
