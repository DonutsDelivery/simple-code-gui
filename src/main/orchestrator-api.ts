import * as http from 'http'
import type { PtyManager } from './pty-manager.js'

const ORCHESTRATOR_PORT = 19836
const MAX_PORT_RETRIES = 5

export class OrchestratorApi {
  private server: http.Server | null = null
  private ptyManager: PtyManager
  private ptyToProject: Map<string, string>
  private activePort: number = ORCHESTRATOR_PORT

  constructor(ptyManager: PtyManager, ptyToProject: Map<string, string>) {
    this.ptyManager = ptyManager
    this.ptyToProject = ptyToProject
  }

  start(): void {
    if (this.server) return

    this.activePort = ORCHESTRATOR_PORT

    this.server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')

      // Only allow localhost
      const remote = req.socket.remoteAddress
      if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
        res.writeHead(403)
        res.end(JSON.stringify({ error: 'Forbidden' }))
        return
      }

      const url = new URL(req.url || '/', `http://localhost:${this.activePort}`)
      const path = url.pathname

      // Match: /sessions/:id/output or /sessions/:id/input
      const sessionMatch = path.match(/^\/sessions\/([^/]+)\/(output|input)$/)

      if (req.method === 'GET' && path === '/sessions') {
        this.handleListSessions(res)
      } else if (req.method === 'GET' && sessionMatch?.[2] === 'output') {
        const maxLines = parseInt(url.searchParams.get('lines') || '50', 10)
        this.handleReadOutput(sessionMatch[1], maxLines, res)
      } else if (req.method === 'POST' && sessionMatch?.[2] === 'input') {
        this.handleSendInput(sessionMatch[1], req, res)
      } else {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Not found' }))
      }
    })

    this.tryListen(this.activePort)
  }

  private tryListen(port: number): void {
    const retryCount = port - ORCHESTRATOR_PORT
    if (retryCount >= MAX_PORT_RETRIES) {
      console.error(`[Orchestrator] Failed to bind after ${MAX_PORT_RETRIES} attempts (ports ${ORCHESTRATOR_PORT}-${port - 1})`)
      this.server?.close()
      this.server = null
      return
    }

    this.server!.listen(port, '127.0.0.1', () => {
      this.activePort = port
      console.log(`[Orchestrator] API server started on port ${port}`)
    })

    this.server!.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        console.warn(`[Orchestrator] Port ${port} in use, trying ${port + 1}`)
        this.tryListen(port + 1)
      } else {
        console.error('[Orchestrator] API server error:', e.message)
        this.server?.close()
        this.server = null
      }
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  private handleListSessions(res: http.ServerResponse): void {
    const sessions = this.ptyManager.listSessions()
    // Enrich with project path from ptyToProject map
    const enriched = sessions.map(s => ({
      ...s,
      projectPath: this.ptyToProject.get(s.id) || s.cwd,
      projectName: (this.ptyToProject.get(s.id) || s.cwd).split('/').pop() || 'unknown',
    }))
    res.writeHead(200)
    res.end(JSON.stringify({ sessions: enriched }))
  }

  private handleReadOutput(id: string, maxLines: number, res: http.ServerResponse): void {
    const lines = this.ptyManager.readOutput(id, maxLines)
    if (lines === null) {
      res.writeHead(404)
      res.end(JSON.stringify({ error: 'Session not found' }))
      return
    }
    res.writeHead(200)
    res.end(JSON.stringify({ lines }))
  }

  private handleSendInput(id: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 10240) {
        res.writeHead(413)
        res.end(JSON.stringify({ error: 'Input too large' }))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const input = data.input || data.text || data.message || ''
        if (!input) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'No input provided' }))
          return
        }

        const proc = this.ptyManager.getProcess(id)
        if (!proc) {
          res.writeHead(404)
          res.end(JSON.stringify({ error: 'Session not found' }))
          return
        }

        // Write input followed by carriage return (simulates pressing Enter in terminal)
        this.ptyManager.write(id, input + '\r')
        res.writeHead(200)
        res.end(JSON.stringify({ success: true, message: `Input sent to session ${id}` }))
      } catch {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    })
  }
}

export { ORCHESTRATOR_PORT }
