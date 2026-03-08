#!/usr/bin/env node
/**
 * Orchestrator MCP Server
 *
 * Stdio-based MCP server that connects to the Electron app's orchestrator API.
 * Provides tools for listing sessions, reading output, and sending input
 * to all active CLI sessions in Claude Terminal.
 *
 * Protocol: JSON-RPC 2.0 over stdio (MCP standard)
 */

import { createInterface } from 'readline'
import http from 'http'

const API_PORT = parseInt(process.env.ORCHESTRATOR_PORT || '19836', 10)
const API_HOST = '127.0.0.1'

// --- HTTP client helpers ---

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve({ error: 'Invalid JSON response', raw: data })
        }
      })
    })

    req.on('error', (e) => {
      reject(new Error(`API request failed: ${e.message}. Is Claude Terminal running?`))
    })

    if (body) {
      req.write(JSON.stringify(body))
    }
    req.end()
  })
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: 'list_sessions',
    description: 'List all active CLI sessions in Claude Terminal. Returns session IDs, project paths, backends, and how long each has been running.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'read_session_output',
    description: 'Read recent output from a specific CLI session. Use list_sessions first to get the session ID. Returns the last N lines of terminal output (ANSI codes stripped).',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'The PTY session ID (from list_sessions)',
        },
        max_lines: {
          type: 'number',
          description: 'Maximum number of recent lines to return (default: 50, max: 200)',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'send_session_input',
    description: 'Send text input to a specific CLI session (simulates typing + Enter). Use this to give instructions to other Claude/Gemini/etc sessions. The input will be written to the session\'s terminal as if a user typed it.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'The PTY session ID (from list_sessions)',
        },
        input: {
          type: 'string',
          description: 'The text to send to the session (will be followed by Enter)',
        },
      },
      required: ['session_id', 'input'],
    },
  },
  {
    name: 'broadcast_input',
    description: 'Send the same text input to ALL active CLI sessions at once. Useful for coordinating actions across all projects simultaneously.',
    inputSchema: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'The text to send to all sessions',
        },
        exclude_self: {
          type: 'boolean',
          description: 'If true, exclude the orchestrator\'s own session (default: true)',
        },
      },
      required: ['input'],
    },
  },
]

// --- Tool handlers ---

async function handleToolCall(name, args) {
  switch (name) {
    case 'list_sessions': {
      const result = await apiRequest('GET', '/sessions')
      if (result.sessions) {
        const now = Date.now()
        const formatted = result.sessions.map(s => ({
          session_id: s.id,
          project: s.projectName,
          project_path: s.projectPath,
          backend: s.backend,
          uptime_minutes: Math.round((now - s.spawnedAt) / 60000),
        }))
        return { content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }] }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }

    case 'read_session_output': {
      const maxLines = Math.min(args.max_lines || 50, 200)
      const result = await apiRequest('GET', `/sessions/${args.session_id}/output?lines=${maxLines}`)
      if (result.lines) {
        return { content: [{ type: 'text', text: result.lines.join('\n') || '(no output yet)' }] }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: true }
    }

    case 'send_session_input': {
      const result = await apiRequest('POST', `/sessions/${args.session_id}/input`, { input: args.input })
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }

    case 'broadcast_input': {
      const sessions = await apiRequest('GET', '/sessions')
      if (!sessions.sessions || sessions.sessions.length === 0) {
        return { content: [{ type: 'text', text: 'No active sessions to broadcast to.' }] }
      }

      const results = []
      for (const session of sessions.sessions) {
        try {
          const r = await apiRequest('POST', `/sessions/${session.id}/input`, { input: args.input })
          results.push({ project: session.projectName, session_id: session.id, ...r })
        } catch (e) {
          results.push({ project: session.projectName, session_id: session.id, error: e.message })
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] }
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }
}

// --- MCP JSON-RPC protocol ---

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result })
  process.stdout.write(msg + '\n')
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
  process.stdout.write(msg + '\n')
}

function sendNotification(method, params) {
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params })
  process.stdout.write(msg + '\n')
}

async function handleMessage(message) {
  const { id, method, params } = message

  switch (method) {
    case 'initialize':
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'orchestrator',
          version: '1.0.0',
        },
      })
      break

    case 'notifications/initialized':
      // Client acknowledged initialization — no response needed
      break

    case 'tools/list':
      sendResponse(id, { tools: TOOLS })
      break

    case 'tools/call':
      try {
        const result = await handleToolCall(params.name, params.arguments || {})
        sendResponse(id, result)
      } catch (e) {
        sendResponse(id, {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          isError: true,
        })
      }
      break

    case 'ping':
      sendResponse(id, {})
      break

    default:
      if (id !== undefined) {
        sendError(id, -32601, `Method not found: ${method}`)
      }
      break
  }
}

// --- Main: read JSON-RPC from stdin ---

const rl = createInterface({ input: process.stdin })

rl.on('line', async (line) => {
  if (!line.trim()) return
  try {
    const message = JSON.parse(line)
    await handleMessage(message)
  } catch (e) {
    // Malformed JSON — send parse error if there's potentially an id
    process.stderr.write(`[orchestrator-mcp] Parse error: ${e.message}\n`)
  }
})

rl.on('close', () => {
  process.exit(0)
})

process.stderr.write('[orchestrator-mcp] Server started\n')
