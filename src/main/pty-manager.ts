import * as pty from 'node-pty'
import * as os from 'os'
import * as path from 'path'

interface ClaudeProcess {
  id: string
  pty: pty.IPty
  cwd: string
  sessionId?: string
}

function getEnhancedEnv(): { [key: string]: string } {
  const env = { ...process.env } as { [key: string]: string }
  const home = os.homedir()

  // Add common paths where claude might be installed
  const additionalPaths = [
    path.join(home, '.nvm/versions/node/v20.18.1/bin'),
    path.join(home, '.nvm/versions/node/v22.11.0/bin'),
    path.join(home, '.local/bin'),
    path.join(home, '.npm-global/bin'),
    '/usr/local/bin',
  ]

  const currentPath = env.PATH || ''
  env.PATH = [...additionalPaths, currentPath].join(':')

  return env
}

export class PtyManager {
  private processes: Map<string, ClaudeProcess> = new Map()
  private dataCallbacks: Map<string, (data: string) => void> = new Map()
  private exitCallbacks: Map<string, (code: number) => void> = new Map()

  spawn(cwd: string, sessionId?: string): string {
    const id = crypto.randomUUID()

    const args: string[] = []
    if (sessionId) {
      args.push('-r', sessionId)
    }

    const shell = pty.spawn('claude', args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: getEnhancedEnv()
    })

    const proc: ClaudeProcess = {
      id,
      pty: shell,
      cwd,
      sessionId
    }

    this.processes.set(id, proc)

    shell.onData((data) => {
      const callback = this.dataCallbacks.get(id)
      if (callback) {
        callback(data)
      }
    })

    shell.onExit(({ exitCode }) => {
      const callback = this.exitCallbacks.get(id)
      if (callback) {
        callback(exitCode)
      }
      this.processes.delete(id)
      this.dataCallbacks.delete(id)
      this.exitCallbacks.delete(id)
    })

    return id
  }

  write(id: string, data: string): void {
    const proc = this.processes.get(id)
    if (proc) {
      proc.pty.write(data)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const proc = this.processes.get(id)
    if (proc) {
      proc.pty.resize(cols, rows)
    }
  }

  kill(id: string): void {
    const proc = this.processes.get(id)
    if (proc) {
      proc.pty.kill()
      this.processes.delete(id)
    }
  }

  killAll(): void {
    for (const [id] of this.processes) {
      this.kill(id)
    }
  }

  onData(id: string, callback: (data: string) => void): void {
    this.dataCallbacks.set(id, callback)
  }

  onExit(id: string, callback: (code: number) => void): void {
    this.exitCallbacks.set(id, callback)
  }
}
