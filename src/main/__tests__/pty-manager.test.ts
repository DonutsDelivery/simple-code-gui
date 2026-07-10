import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'

// Mock crypto for UUID generation
vi.stubGlobal('crypto', {
  randomUUID: vi.fn().mockReturnValue('test-uuid-12345'),
})

// Mock node-pty
const mockPtyProcess = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
}

vi.mock('node-pty', () => ({
  spawn: vi.fn().mockImplementation(() => mockPtyProcess),
}))

// Mock fs for executable checking
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}))

// Mock platform module
vi.mock('../platform', () => ({
  isWindows: false,
  getEnhancedPathWithPortable: vi
    .fn()
    .mockReturnValue('/usr/bin:/usr/local/bin'),
  getAdditionalPaths: vi.fn().mockReturnValue(['/usr/local/bin']),
}))

// Mock portable-deps module
vi.mock('../portable-deps', () => ({
  getPortableBinDirs: vi.fn().mockReturnValue([]),
}))

import { PtyManager } from '../pty-manager'
import * as pty from 'node-pty'
import * as fs from 'fs'
import * as platform from '../platform'

describe('PtyManager', () => {
  let manager: PtyManager
  let dataCallback: ((data: string) => void) | null = null
  let exitCallback: ((result: { exitCode: number }) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mock implementations
    dataCallback = null
    exitCallback = null

    mockPtyProcess.onData.mockImplementation((cb: (data: string) => void) => {
      dataCallback = cb
    })
    mockPtyProcess.onExit.mockImplementation(
      (cb: (result: { exitCode: number }) => void) => {
        exitCallback = cb
      }
    )

    manager = new PtyManager()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  describe('spawn()', () => {
    it('should spawn a PTY process and return an ID', () => {
      const id = manager.spawn('/test/dir')

      expect(id).toBe('test-uuid-12345')
      expect(pty.spawn).toHaveBeenCalledWith(
        'claude',
        [],
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
          cwd: '/test/dir',
          handleFlowControl: true,
        })
      )
    })

    it('should spawn with resume session ID', () => {
      manager.spawn('/test/dir', 'session-123')

      expect(pty.spawn).toHaveBeenCalledWith(
        'claude',
        ['-r', 'session-123'],
        expect.any(Object)
      )
    })

    it('should spawn with model argument', () => {
      manager.spawn('/test/dir', undefined, undefined, undefined, 'opus')

      expect(pty.spawn).toHaveBeenCalledWith(
        'claude',
        ['--model', 'opus'],
        expect.any(Object)
      )
    })

    it('should not add model argument for "default" model', () => {
      manager.spawn('/test/dir', undefined, undefined, undefined, 'default')

      expect(pty.spawn).toHaveBeenCalledWith('claude', [], expect.any(Object))
    })

    it('should spawn with permission mode arguments', () => {
      manager.spawn('/test/dir', undefined, undefined, 'acceptEdits')

      expect(pty.spawn).toHaveBeenCalledWith(
        'claude',
        ['--permission-mode', 'acceptEdits'],
        expect.any(Object)
      )
    })

    it('should spawn with auto-accept tools', () => {
      manager.spawn('/test/dir', undefined, ['Read', 'Write'])

      expect(pty.spawn).toHaveBeenCalledWith(
        'claude',
        ['--allowedTools', 'Read,Write'],
        expect.any(Object)
      )
    })

    it('should spawn with all arguments combined', () => {
      manager.spawn('/test/dir', 'session-123', ['Read'], 'dontAsk', 'sonnet')

      expect(pty.spawn).toHaveBeenCalledWith(
        'claude',
        [
          '-r',
          'session-123',
          '--permission-mode',
          'dontAsk',
          '--allowedTools',
          'Read',
          '--model',
          'sonnet',
        ],
        expect.any(Object)
      )
    })

    describe('headroom routing', () => {
      it('should route Claude through the Anthropic headroom proxy when enabled', () => {
        manager.setHeadroomRouting({ enabled: true, port: 8787 })

        manager.spawn('/test/dir', undefined, undefined, undefined, undefined, 'claude')

        const options = vi.mocked(pty.spawn).mock.calls[0][2]
        expect(options.env?.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8787')
      })

      it('should not overwrite Hermes MiniMax routing when headroom is enabled', () => {
        vi.stubEnv('MINIMAX_BASE_URL', 'https://api.minimax.io')
        manager.setHeadroomRouting({ enabled: true, port: 8787 })

        manager.spawn('/test/dir', undefined, undefined, undefined, undefined, 'hermes')

        const options = vi.mocked(pty.spawn).mock.calls[0][2]
        expect(options.env?.MINIMAX_BASE_URL).toBe('https://api.minimax.io')
        vi.unstubAllEnvs()
      })
    })

    describe('backend-specific spawning', () => {
      it('should spawn gemini backend with correct executable and args', () => {
        manager.spawn(
          '/test/dir',
          'session-123',
          ['tool1'],
          'dontAsk',
          undefined,
          'gemini'
        )

        expect(pty.spawn).toHaveBeenCalledWith(
          'gemini',
          [
            '--resume',
            'session-123',
            '--approval-mode',
            'yolo',
            '--allowed-tools',
            'tool1',
          ],
          expect.any(Object)
        )
      })

      it('should spawn codex backend with correct executable and args', () => {
        manager.spawn(
          '/test/dir',
          'session-123',
          undefined,
          'dontAsk',
          undefined,
          'codex'
        )

        expect(pty.spawn).toHaveBeenCalledWith(
          'codex',
          [
            '-c',
            'projects."/test/dir".trust_level="trusted"',
            'resume',
            '-a',
            'never',
            '-s',
            'workspace-write',
            '-c',
            'sandbox_workspace_write.network_access=true',
            'session-123',
          ],
          expect.any(Object)
        )
      })

      it('should spawn opencode backend without permission args', () => {
        manager.spawn(
          '/test/dir',
          'session-123',
          ['Read'],
          'dontAsk',
          undefined,
          'opencode'
        )

        expect(pty.spawn).toHaveBeenCalledWith(
          'opencode',
          ['--session', 'session-123'],
          expect.any(Object)
        )
      })

      it('should spawn aider backend with --yes for non-default permission', () => {
        manager.spawn(
          '/test/dir',
          'session-123',
          undefined,
          'acceptEdits',
          undefined,
          'aider'
        )

        expect(pty.spawn).toHaveBeenCalledWith(
          'aider',
          ['--restore', 'session-123', '--yes'],
          expect.any(Object)
        )
      })

      it('should not replace a failed Hermes resume with a blank session', () => {
        manager.spawn('/test/dir', 'hermes-session', undefined, undefined, undefined, 'hermes')

        exitCallback?.({ exitCode: 1 })

        expect(pty.spawn).toHaveBeenCalledTimes(1)
      })
    })

    describe('spawn failure handling', () => {
      it('should handle spawn throwing an error', () => {
        vi.mocked(pty.spawn).mockImplementationOnce(() => {
          throw new Error('spawn ENOENT')
        })

        expect(() => manager.spawn('/test/dir')).toThrow('spawn ENOENT')
      })
    })
  })

  describe('write()', () => {
    it('should write data to the PTY process', () => {
      const id = manager.spawn('/test/dir')

      manager.write(id, 'hello world')

      expect(mockPtyProcess.write).toHaveBeenCalledWith('hello world')
    })

    it('should do nothing for non-existent process ID', () => {
      manager.write('non-existent-id', 'hello')

      expect(mockPtyProcess.write).not.toHaveBeenCalled()
    })
  })

  describe('resize()', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should resize the PTY process after debounce', () => {
      const id = manager.spawn('/test/dir')

      manager.resize(id, 200, 50)

      // Not called immediately (debounced)
      expect(mockPtyProcess.resize).not.toHaveBeenCalled()

      // Advance past debounce period (50ms for non-Ink backends)
      vi.advanceTimersByTime(60)

      expect(mockPtyProcess.resize).toHaveBeenCalledWith(200, 50)
    })

    it('should debounce rapid resize calls', () => {
      const id = manager.spawn('/test/dir')

      manager.resize(id, 100, 30)
      manager.resize(id, 150, 40)
      manager.resize(id, 200, 50)

      vi.advanceTimersByTime(60)

      // Only the last resize should fire
      expect(mockPtyProcess.resize).toHaveBeenCalledTimes(1)
      expect(mockPtyProcess.resize).toHaveBeenCalledWith(200, 50)
    })

    it('should skip resize if dimensions unchanged', () => {
      const id = manager.spawn('/test/dir')

      manager.resize(id, 200, 50)
      vi.advanceTimersByTime(60)
      mockPtyProcess.resize.mockClear()

      // Same dimensions again
      manager.resize(id, 200, 50)
      vi.advanceTimersByTime(60)

      expect(mockPtyProcess.resize).not.toHaveBeenCalled()
    })

    it.each(['gemini', 'hermes'])('should use longer debounce for %s during startup', backend => {
      const id = manager.spawn('/test/dir', undefined, undefined, undefined, undefined, backend as 'gemini' | 'hermes')

      manager.resize(id, 200, 50)

      // At 60ms - should NOT have fired (startup debounce is 1500ms)
      vi.advanceTimersByTime(60)
      expect(mockPtyProcess.resize).not.toHaveBeenCalled()

      // At 1600ms - should have fired
      vi.advanceTimersByTime(1500)
      expect(mockPtyProcess.resize).toHaveBeenCalledWith(200, 50)
    })

    it('should do nothing for non-existent process ID', () => {
      manager.resize('non-existent-id', 200, 50)
      vi.advanceTimersByTime(60)

      expect(mockPtyProcess.resize).not.toHaveBeenCalled()
    })

    it('should handle resize errors gracefully (e.g., PTY already exited)', () => {
      const id = manager.spawn('/test/dir')
      mockPtyProcess.resize.mockImplementationOnce(() => {
        throw new Error('pty already closed')
      })

      manager.resize(id, 200, 50)
      // Should not throw when debounce fires
      expect(() => vi.advanceTimersByTime(60)).not.toThrow()
    })
  })

  describe('kill()', () => {
    it('should kill the PTY process on non-Windows', () => {
      const id = manager.spawn('/test/dir')

      manager.kill(id)

      expect(mockPtyProcess.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('should do nothing for non-existent process ID', () => {
      manager.kill('non-existent-id')

      expect(mockPtyProcess.kill).not.toHaveBeenCalled()
    })

    it('should handle kill errors gracefully (process already dead)', () => {
      const id = manager.spawn('/test/dir')
      mockPtyProcess.kill.mockImplementationOnce(() => {
        throw new Error('process already terminated')
      })

      // Should not throw
      expect(() => manager.kill(id)).not.toThrow()
    })

    it('should remove process from internal map after kill', () => {
      const id = manager.spawn('/test/dir')
      manager.kill(id)

      // Process should no longer exist
      expect(manager.getProcess(id)).toBeUndefined()
    })
  })

  describe('killAll()', () => {
    it('should kill all PTY processes', () => {
      // Reset UUID mock to return different values
      let callCount = 0
      vi.mocked(crypto.randomUUID).mockImplementation(
        () => `uuid-${callCount++}`
      )

      manager.spawn('/test/dir1')
      manager.spawn('/test/dir2')
      manager.spawn('/test/dir3')

      manager.killAll()

      expect(mockPtyProcess.kill).toHaveBeenCalledTimes(3)
    })
  })

  describe('gracefulShutdown()', () => {
    // AC: @terminal/pty-lifecycle ac-4
    it('sends SIGTERM first so backends can flush their session files', async () => {
      let callCount = 0
      vi.mocked(crypto.randomUUID).mockImplementation(
        () => `uuid-${callCount++}`
      )

      const id = manager.spawn('/test/dir1')

      // Simulate the process exiting cleanly shortly after SIGTERM.
      setTimeout(() => {
        if (exitCallback) exitCallback({ exitCode: 0 })
      }, 25)

      await manager.gracefulShutdown(1000)

      const sigtermCalls = mockPtyProcess.kill.mock.calls.filter(
        (args) => args[0] === 'SIGTERM'
      )
      expect(sigtermCalls.length).toBeGreaterThan(0)
      expect(manager.getProcess(id)).toBeUndefined()
    })

    it('falls back to SIGKILL after timeout when a backend ignores SIGTERM', async () => {
      manager.spawn('/test/dir1')

      // Don't trigger exit — process "ignores" SIGTERM. Use a tiny timeout.
      await manager.gracefulShutdown(80)

      const sigtermCalls = mockPtyProcess.kill.mock.calls.filter(
        (args) => args[0] === 'SIGTERM'
      )
      const sigkillCalls = mockPtyProcess.kill.mock.calls.filter(
        (args) => args[0] === 'SIGKILL'
      )
      expect(sigtermCalls.length).toBeGreaterThan(0)
      expect(sigkillCalls.length).toBeGreaterThan(0)
    })

    it('returns immediately when no processes are running', async () => {
      const start = Date.now()
      await manager.gracefulShutdown(5000)
      expect(Date.now() - start).toBeLessThan(50)
    })
  })

  describe('getProcess()', () => {
    it('should return process info for existing ID', () => {
      const id = manager.spawn('/test/dir')

      const proc = manager.getProcess(id)

      expect(proc).toBeDefined()
      expect(proc?.id).toBe(id)
      expect(proc?.cwd).toBe('/test/dir')
    })

    it('should return undefined for non-existent ID', () => {
      expect(manager.getProcess('non-existent')).toBeUndefined()
    })

    it('should include sessionId and backend in process info', () => {
      const id = manager.spawn(
        '/test/dir',
        'session-abc',
        undefined,
        undefined,
        undefined,
        'gemini'
      )

      const proc = manager.getProcess(id)

      expect(proc?.sessionId).toBe('session-abc')
      expect(proc?.backend).toBe('gemini')
    })
  })

  describe('onData()', () => {
    it('should register data callback and receive data', () => {
      const id = manager.spawn('/test/dir')
      const callback = vi.fn()

      manager.onData(id, callback)

      // Simulate data from PTY
      dataCallback?.('test output')

      expect(callback).toHaveBeenCalledWith('test output')
    })
  })

  describe('onExit()', () => {
    it('should register exit callback and receive exit code', () => {
      const id = manager.spawn('/test/dir')
      const callback = vi.fn()

      manager.onExit(id, callback)

      // Simulate PTY exit
      exitCallback?.({ exitCode: 0 })

      expect(callback).toHaveBeenCalledWith(0)
    })

    it('should clean up process on exit', () => {
      const id = manager.spawn('/test/dir')

      // Simulate PTY exit
      exitCallback?.({ exitCode: 0 })

      expect(manager.getProcess(id)).toBeUndefined()
    })
  })

  describe('addDataListener / addExitListener', () => {
    // AC: @terminal/mobile-live-attach ac-2
    it('fires additional data listeners alongside the primary callback', () => {
      const id = manager.spawn('/test/dir')
      const primary = vi.fn()
      const listenerA = vi.fn()
      const listenerB = vi.fn()

      manager.onData(id, primary)
      manager.addDataListener(id, listenerA)
      manager.addDataListener(id, listenerB)

      dataCallback?.('hello')

      expect(primary).toHaveBeenCalledWith('hello')
      expect(listenerA).toHaveBeenCalledWith('hello')
      expect(listenerB).toHaveBeenCalledWith('hello')
    })

    // AC: @terminal/mobile-live-attach ac-3
    it('disposing a data listener stops it without affecting the primary or siblings', () => {
      const id = manager.spawn('/test/dir')
      const primary = vi.fn()
      const listenerA = vi.fn()
      const listenerB = vi.fn()

      manager.onData(id, primary)
      const disposeA = manager.addDataListener(id, listenerA)
      manager.addDataListener(id, listenerB)

      disposeA()
      dataCallback?.('after dispose')

      expect(primary).toHaveBeenCalledWith('after dispose')
      expect(listenerA).not.toHaveBeenCalled()
      expect(listenerB).toHaveBeenCalledWith('after dispose')
    })

    it('fires exit listeners alongside the primary exit callback', () => {
      const id = manager.spawn('/test/dir')
      const primary = vi.fn()
      const listener = vi.fn()

      manager.onExit(id, primary)
      manager.addExitListener(id, listener)

      exitCallback?.({ exitCode: 7 })

      expect(primary).toHaveBeenCalledWith(7)
      expect(listener).toHaveBeenCalledWith(7)
    })

    it('a thrown listener does not block sibling listeners or the primary callback', () => {
      const id = manager.spawn('/test/dir')
      const primary = vi.fn()
      const bad = vi.fn(() => { throw new Error('boom') })
      const good = vi.fn()

      manager.onData(id, primary)
      manager.addDataListener(id, bad)
      manager.addDataListener(id, good)

      expect(() => dataCallback?.('x')).not.toThrow()
      expect(primary).toHaveBeenCalledWith('x')
      expect(good).toHaveBeenCalledWith('x')
    })
  })

  describe('getReplayBytes()', () => {
    // AC: @terminal/mobile-live-attach ac-1
    it('returns the bytes captured since spawn so a late attacher can rebuild the screen', () => {
      const id = manager.spawn('/test/dir')

      dataCallback?.('chunk1')
      dataCallback?.('chunk2')

      expect(manager.getReplayBytes(id)).toBe('chunk1chunk2')
    })

    it('returns null for a non-existent PTY', () => {
      expect(manager.getReplayBytes('not-a-real-id')).toBeNull()
    })
  })

  describe('Windows-specific behavior', () => {
    beforeEach(() => {
      // Set isWindows to true
      vi.mocked(platform).isWindows = true
    })

    afterEach(() => {
      vi.mocked(platform).isWindows = false
    })

    it('should use ConPTY on Windows', () => {
      manager.spawn('/test/dir')

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          useConpty: true,
        })
      )
    })

    it('should call kill without signal on Windows', () => {
      const id = manager.spawn('/test/dir')
      manager.kill(id)

      // On Windows, kill() is called without arguments
      expect(mockPtyProcess.kill).toHaveBeenCalledWith()
    })
  })
})

describe('buildPermissionArgs (via spawn)', () => {
  let manager: PtyManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockPtyProcess.onData.mockImplementation(() => {})
    mockPtyProcess.onExit.mockImplementation(() => {})
    manager = new PtyManager()
  })

  describe('claude backend', () => {
    it('should not add permission-mode for default', () => {
      manager.spawn(
        '/test',
        undefined,
        undefined,
        'default',
        undefined,
        'claude'
      )

      expect(pty.spawn).toHaveBeenCalledWith('claude', [], expect.any(Object))
    })

    it('should add permission-mode for acceptEdits', () => {
      manager.spawn(
        '/test',
        undefined,
        undefined,
        'acceptEdits',
        undefined,
        'claude'
      )

      expect(pty.spawn).toHaveBeenCalledWith(
        'claude',
        ['--permission-mode', 'acceptEdits'],
        expect.any(Object)
      )
    })
  })

  describe('gemini backend', () => {
    it('should map acceptEdits to auto_edit', () => {
      manager.spawn(
        '/test',
        undefined,
        undefined,
        'acceptEdits',
        undefined,
        'gemini'
      )

      expect(pty.spawn).toHaveBeenCalledWith(
        'gemini',
        ['--approval-mode', 'auto_edit'],
        expect.any(Object)
      )
    })

    it('should map dontAsk to yolo', () => {
      manager.spawn(
        '/test',
        undefined,
        undefined,
        'dontAsk',
        undefined,
        'gemini'
      )

      expect(pty.spawn).toHaveBeenCalledWith(
        'gemini',
        ['--approval-mode', 'yolo'],
        expect.any(Object)
      )
    })

    it('should map bypassPermissions to yolo', () => {
      manager.spawn(
        '/test',
        undefined,
        undefined,
        'bypassPermissions',
        undefined,
        'gemini'
      )

      expect(pty.spawn).toHaveBeenCalledWith(
        'gemini',
        ['--approval-mode', 'yolo'],
        expect.any(Object)
      )
    })
  })

  describe('codex backend', () => {
    it('should resume the most recent Codex session for the resume-last sentinel', () => {
      const id = manager.spawn(
        '/test',
        '__codex_resume_last__',
        undefined,
        undefined,
        undefined,
        'codex'
      )

      expect(pty.spawn).toHaveBeenCalledWith(
        'codex',
        ['-c', 'projects."/test".trust_level="trusted"', 'resume', '--last'],
        expect.any(Object)
      )
      expect(manager.getProcess(id)?.sessionId).toBeUndefined()
    })

    it('should retry stale Codex session IDs with resume --last', () => {
      let localExitCallback: ((result: { exitCode: number }) => void) | undefined
      mockPtyProcess.onExit.mockImplementationOnce((cb: (result: { exitCode: number }) => void) => {
        localExitCallback = cb
      })

      manager.spawn(
        '/test',
        'ses_stale',
        undefined,
        undefined,
        undefined,
        'codex'
      )

      localExitCallback?.({ exitCode: 1 })

      expect(pty.spawn).toHaveBeenNthCalledWith(
        1,
        'codex',
        ['-c', 'projects."/test".trust_level="trusted"', 'resume', 'ses_stale'],
        expect.any(Object)
      )
      expect(pty.spawn).toHaveBeenNthCalledWith(
        2,
        'codex',
        ['-c', 'projects."/test".trust_level="trusted"', 'resume', '--last'],
        expect.any(Object)
      )
    })

    it('should map acceptEdits to no-approval workspace-write mode', () => {
      manager.spawn(
        '/test',
        undefined,
        undefined,
        'acceptEdits',
        undefined,
        'codex'
      )

      expect(pty.spawn).toHaveBeenCalledWith(
        'codex',
        [
          '-c',
          'projects."/test".trust_level="trusted"',
          '-a',
          'never',
          '-s',
          'workspace-write',
        ],
        expect.any(Object)
      )
    })

    it('should map dontAsk to no-approval workspace mode with network access', () => {
      manager.spawn(
        '/test',
        undefined,
        undefined,
        'dontAsk',
        undefined,
        'codex'
      )

      expect(pty.spawn).toHaveBeenCalledWith(
        'codex',
        [
          '-c',
          'projects."/test".trust_level="trusted"',
          '-a',
          'never',
          '-s',
          'workspace-write',
          '-c',
          'sandbox_workspace_write.network_access=true',
        ],
        expect.any(Object)
      )
    })

    it('should map bypassPermissions to --yolo', () => {
      manager.spawn(
        '/test',
        undefined,
        undefined,
        'bypassPermissions',
        undefined,
        'codex'
      )

      expect(pty.spawn).toHaveBeenCalledWith(
        'codex',
        ['-c', 'projects."/test".trust_level="trusted"', '--yolo'],
        expect.any(Object)
      )
    })
  })
})
