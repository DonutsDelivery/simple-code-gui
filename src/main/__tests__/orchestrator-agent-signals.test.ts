import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/agent-session-signal-instructions', () => ({
  installAgentSessionSignalInstructions: vi.fn(),
}))
vi.mock('../renderer-pty-data-pump', () => ({
  rendererPtyDataPump: { enqueue: vi.fn(), clearPty: vi.fn() },
}))

import { installAgentSessionSignalInstructions } from '../ipc/agent-session-signal-instructions'
import { OrchestratorApi } from '../orchestrator-api'

class MockResponse {
  statusCode = 0
  body = ''

  writeHead(statusCode: number): void {
    this.statusCode = statusCode
  }

  end(body = ''): void {
    this.body = body
  }
}

describe('OrchestratorApi agent signal instructions', () => {
  // AC: @agent-session-notifications ac-5
  it('installs instructions for the effective backend before spawning', async () => {
    const cwd = process.cwd()
    const spawn = vi.fn(() => 'pty-created')
    const ptyManager = {
      spawn,
      onData: vi.fn(),
      onExit: vi.fn(),
    }
    const sessionStore = {
      getWorkspace: () => ({ projects: [{ path: cwd }] }),
      getSettings: () => ({ backend: 'claude', autoAcceptTools: [], permissionMode: 'default' }),
    }
    const runtimeRegistry = {
      ensureRuntime: vi.fn(async () => {
        const ptyId = spawn()
        return { ptyId, runtimeId: 'runtime-1', agentSessionId: ptyId }
      }),
    }
    const api = new OrchestratorApi(
      ptyManager as any,
      new Map(),
      new Map(),
      sessionStore as any,
      () => null,
      runtimeRegistry as any,
    )
    const request = new EventEmitter()
    const response = new MockResponse()

    ;(api as any).handleCreateSession(request, response)
    request.emit('data', Buffer.from(JSON.stringify({ cwd, backend: 'codex' })))
    request.emit('end')
    await vi.waitFor(() => expect(response.statusCode).toBe(201))

    expect(installAgentSessionSignalInstructions).toHaveBeenCalledWith(cwd, 'codex')
    expect(vi.mocked(installAgentSessionSignalInstructions).mock.invocationCallOrder[0])
      .toBeLessThan(spawn.mock.invocationCallOrder[0])
    expect(response.statusCode).toBe(201)
  })
})
