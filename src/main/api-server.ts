import * as http from 'http'

interface ApiServer {
  server: http.Server
  port: number
  projectPath: string
}

type PromptHandler = (projectPath: string, prompt: string) => boolean

export class ApiServerManager {
  private servers: Map<string, ApiServer> = new Map() // projectPath -> server
  private promptHandler: PromptHandler | null = null

  setPromptHandler(handler: PromptHandler) {
    this.promptHandler = handler
  }

  start(projectPath: string, port: number): { success: boolean; error?: string } {
    // Stop existing server for this project if any
    this.stop(projectPath)

    // Check if port is already in use by another project
    for (const [path, server] of this.servers) {
      if (server.port === port && path !== projectPath) {
        return { success: false, error: `Port ${port} is already in use by another project` }
      }
    }

    try {
      const server = http.createServer((req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') {
          res.writeHead(200)
          res.end()
          return
        }

        if (req.method === 'POST' && req.url === '/prompt') {
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const prompt = data.prompt || data.message || data.text || ''

              if (!prompt) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: 'No prompt provided' }))
                return
              }

              if (this.promptHandler) {
                const sent = this.promptHandler(projectPath, prompt)
                if (sent) {
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ success: true, message: 'Prompt sent to terminal' }))
                } else {
                  res.writeHead(404, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ success: false, error: 'No active terminal for this project' }))
                }
              } else {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: 'No prompt handler configured' }))
              }
            } catch (e) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }))
            }
          })
        } else if (req.method === 'GET' && req.url === '/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            project: projectPath,
            message: 'API server running'
          }))
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            error: 'Not found',
            endpoints: {
              'POST /prompt': 'Send a prompt to the terminal. Body: { "prompt": "your message" }',
              'GET /status': 'Check server status'
            }
          }))
        }
      })

      server.on('error', (e: NodeJS.ErrnoException) => {
        console.error(`API server error on port ${port}:`, e.message)
        this.servers.delete(projectPath)
      })

      server.listen(port, '127.0.0.1', () => {
        console.log(`API server started on port ${port} for project: ${projectPath}`)
      })

      this.servers.set(projectPath, { server, port, projectPath })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  stop(projectPath: string): void {
    const apiServer = this.servers.get(projectPath)
    if (apiServer) {
      apiServer.server.close()
      this.servers.delete(projectPath)
      console.log(`API server stopped for project: ${projectPath}`)
    }
  }

  stopAll(): void {
    for (const [projectPath] of this.servers) {
      this.stop(projectPath)
    }
  }

  isRunning(projectPath: string): boolean {
    return this.servers.has(projectPath)
  }

  getPort(projectPath: string): number | undefined {
    return this.servers.get(projectPath)?.port
  }
}
