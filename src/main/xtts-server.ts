import * as fs from 'fs'
import { spawn, ChildProcess } from 'child_process'
import {
  xttsDir,
  xttsScriptPath,
  getVenvPython,
  ensureDir,
  XTTS_HELPER_SCRIPT
} from './xtts-paths.js'
import { isWindows } from './platform.js'

type RequestHandler = {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
}

export class XTTSServer {
  private serverProcess: ChildProcess | null = null
  private serverReady = false
  private serverStarting: Promise<boolean> | null = null
  private pendingRequests: Map<string, RequestHandler> = new Map()
  private responseBuffer = ''
  private pythonPath: string | null = null

  constructor(pythonPath: string | null) {
    this.pythonPath = pythonPath
  }

  setPythonPath(pythonPath: string | null): void {
    this.pythonPath = pythonPath
  }

  isRunning(): boolean {
    return this.serverProcess !== null && this.serverReady
  }

  async start(): Promise<boolean> {
    if (this.serverStarting) {
      return this.serverStarting
    }

    if (this.serverProcess && this.serverReady) {
      return true
    }

    this.serverStarting = this.startInternal()
    const result = await this.serverStarting
    this.serverStarting = null
    return result
  }

  private async startInternal(): Promise<boolean> {
    const venvPython = getVenvPython()
    const pythonToUse = fs.existsSync(venvPython) ? venvPython : this.pythonPath

    if (!pythonToUse) {
      return false
    }

    this.ensureHelperScript()

    return new Promise((resolve) => {
      const proc = spawn(pythonToUse, [xttsScriptPath, 'server'])
      this.serverProcess = proc
      this.serverReady = false
      this.responseBuffer = ''

      proc.stdout.on('data', (data) => {
        this.responseBuffer += data.toString()

        const lines = this.responseBuffer.split('\n')
        this.responseBuffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const response = JSON.parse(line)

            if (response.status === 'ready') {
              this.serverReady = true
              resolve(true)
              continue
            }

            const entry = this.pendingRequests.entries().next().value
            if (entry) {
              const [requestId, handlers] = entry
              this.pendingRequests.delete(requestId)
              handlers.resolve(response)
            }
          } catch (e) {
            console.error('XTTS server parse error:', e, 'line:', line)
          }
        }
      })

      proc.stderr.on('data', (data) => {
        console.log('XTTS server:', data.toString())
      })

      proc.on('close', (code) => {
        this.serverProcess = null
        this.serverReady = false

        for (const [, handlers] of this.pendingRequests) {
          handlers.reject(new Error(`Server exited with code ${code}`))
        }
        this.pendingRequests.clear()

        if (!this.serverReady) {
          resolve(false)
        }
      })

      proc.on('error', () => {
        this.serverProcess = null
        this.serverReady = false
        resolve(false)
      })

      setTimeout(() => {
        if (!this.serverReady) {
          console.error('XTTS server startup timeout')
          this.stop()
          resolve(false)
        }
      }, 120000)
    })
  }

  stop(): void {
    if (this.serverProcess) {
      try {
        this.serverProcess.stdin?.write(JSON.stringify({ action: 'quit' }) + '\n')
      } catch {
        // Ignore write errors
      }

      setTimeout(() => {
        if (this.serverProcess) {
          this.serverProcess.kill()
          this.serverProcess = null
        }
      }, 1000)
    }
    this.serverReady = false
  }

  async sendCommand(command: object): Promise<unknown> {
    if (!this.serverProcess || !this.serverReady) {
      const started = await this.start()
      if (!started) {
        throw new Error('Failed to start XTTS server')
      }
    }

    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random()}`
      this.pendingRequests.set(requestId, { resolve, reject })

      try {
        this.serverProcess!.stdin?.write(JSON.stringify(command) + '\n')
      } catch (err) {
        this.pendingRequests.delete(requestId)
        reject(err)
      }

      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error('Request timeout'))
        }
      }, 300000)
    })
  }

  private ensureHelperScript(): void {
    ensureDir(xttsDir)
    fs.writeFileSync(xttsScriptPath, XTTS_HELPER_SCRIPT)
    if (!isWindows) {
      fs.chmodSync(xttsScriptPath, 0o755)
    }
  }
}
