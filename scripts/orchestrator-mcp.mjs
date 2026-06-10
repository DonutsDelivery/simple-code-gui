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
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import http from 'http'

const BASE_PORT = parseInt(process.env.ORCHESTRATOR_PORT || '19836', 10)
const API_HOST = '127.0.0.1'
let API_PORT = BASE_PORT

// M2: read the per-launch shared secret the app wrote (0600). Sent on every
// request so the localhost-only orchestrator API can distinguish us from any
// other local process. Re-read lazily in case the app starts after us.
const ORCHESTRATOR_SECRET_DIR = join(homedir(), '.claude-terminal')
function getSecret(port = API_PORT) {
  // Prefer the per-port secret (multi-instance), fall back to the legacy
  // un-suffixed file written for the base port.
  for (const file of [`orchestrator-secret-${port}`, 'orchestrator-secret']) {
    try {
      const v = readFileSync(join(ORCHESTRATOR_SECRET_DIR, file), 'utf8').trim()
      if (v) return v
    } catch {
      // try next
    }
  }
  return ''
}

// --- Cron job store ---
const CRON_JOBS = new Map()
let cronIdCounter = 0
// M2: bound the number of concurrent cron jobs so a buggy/abusive caller can't
// schedule unbounded recurring traffic against the API.
const MAX_CRON_JOBS = 25

function executeCronJob(job) {
  const run = async () => {
    try {
      if (job.target === 'broadcast') {
        const sessions = await apiRequest('GET', '/sessions')
        if (sessions.sessions && sessions.sessions.length > 0) {
          for (const session of sessions.sessions) {
            await apiRequest('POST', `/sessions/${session.id}/input`, { input: job.message })
          }
        }
      } else {
        await apiRequest('POST', `/sessions/${job.target}/input`, { input: job.message })
      }
      job.lastRun = Date.now()
      job.runCount++
      process.stderr.write(`[orchestrator-mcp] Cron job ${job.id} executed (run #${job.runCount})\n`)
    } catch (e) {
      process.stderr.write(`[orchestrator-mcp] Cron job ${job.id} error: ${e.message}\n`)
    }
  }
  job.timer = setInterval(run, job.intervalMs * 1000)
  run() // execute immediately on creation
}

// --- HTTP client helpers ---

function apiRequest(method, path, body = null, port = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      port: port || API_PORT,
      path,
      method,
      headers: { 'Content-Type': 'application/json', 'x-orchestrator-secret': getSecret(port || API_PORT) },
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
    name: 'list_tiles',
    description: 'List all UI tiles (tile panes) in Claude Terminal, each with its tile ID and the session/tab IDs it contains. Use this to find the tile_id needed for sub-tab or split placement when calling create_session. The tile ID is NOT the same as the session ID — tiles are layout containers that hold one or more sessions as tabs.',
    inputSchema: {
      type: 'object',
      properties: {        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances), e.g. an isolated test instance on 19837. Defaults to the instance this MCP connected to — when testing, ALWAYS pass the test instance port so you do not touch the user\'s real session.' },
},
      required: [],
    },
  },
  {
    name: 'list_sessions',
    description: 'List all active CLI sessions in Claude Terminal. Returns session IDs, project paths, backends, and how long each has been running.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances), e.g. an isolated test instance on 19837. Defaults to the instance this MCP connected to — when testing, ALWAYS pass the test instance port so you do not touch the user\'s real session.' },
      },
      required: [],
    },
  },
  {
    name: 'read_session_output',
    description: 'Read recent output from a specific CLI session. Use list_sessions first to get the session ID. Returns the last N lines of terminal output (ANSI codes stripped).',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances), e.g. an isolated test instance on 19837. Defaults to the instance this MCP connected to — when testing, ALWAYS pass the test instance port so you do not touch the user\'s real session.' },
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
    description: 'Send text input to a specific CLI session (simulates pasting text then pressing Enter). Use this to give instructions to other Claude/Gemini/etc sessions. The input is written to the terminal first, then Enter is sent after a short delay to ensure multi-line prompts are submitted correctly. Set raw=true to send input without appending Enter (useful for answering permission prompts where pressing a key like "1" immediately selects an option).',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances), e.g. an isolated test instance on 19837. Defaults to the instance this MCP connected to — when testing, ALWAYS pass the test instance port so you do not touch the user\'s real session.' },
        session_id: {
          type: 'string',
          description: 'The PTY session ID (from list_sessions)',
        },
        input: {
          type: 'string',
          description: 'The text to send to the session (will be followed by Enter unless raw=true)',
        },
        raw: {
          type: 'boolean',
          description: 'If true, send input without appending Enter. Use for permission prompts and single-key selections.',
        },
      },
      required: ['session_id', 'input'],
    },
  },
  {
    name: 'create_session',
    description: 'Create a new CLI session (spawn a new PTY terminal). Returns the new session ID. The session will use project-level or global settings for permissions and auto-accept tools.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances), e.g. an isolated test instance on 19837. Defaults to the instance this MCP connected to — when testing, ALWAYS pass the test instance port so you do not touch the user\'s real session.' },
        cwd: {
          type: 'string',
          description: 'Working directory for the new session (required). Must be an absolute path to a project directory.',
        },
        backend: {
          type: 'string',
          description: 'CLI backend to use (default: "claude"). Options: claude, gemini, codex, opencode, aider.',
          enum: ['claude', 'gemini', 'codex', 'opencode', 'aider'],
        },
        model: {
          type: 'string',
          description: 'Model to use (optional). Passed as --model flag to the CLI backend.',
        },
        workspace_id: {
          type: 'string',
          description: 'Workspace (session group) to add the new session to. Defaults to the currently active workspace.',
        },
        tile_id: {
          type: 'string',
          description: 'Target tile ID for placement. Used with placement="sub-tab" (add as tab in existing tile) or split-* directions.',
        },
        placement: {
          type: 'string',
          description: 'Where to place the new session: "new-tile" (default, creates a new tile), "sub-tab" (add as tab in tile_id), "split-left", "split-right", "split-top", "split-bottom" (split an existing tile).',
          enum: ['new-tile', 'sub-tab', 'split-left', 'split-right', 'split-top', 'split-bottom'],
        },
      },
      required: ['cwd'],
    },
  },
  {
    name: 'close_session',
    description: 'Close (kill) a CLI session by its session ID. The session\'s PTY process will be terminated.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances), e.g. an isolated test instance on 19837. Defaults to the instance this MCP connected to — when testing, ALWAYS pass the test instance port so you do not touch the user\'s real session.' },
        session_id: {
          type: 'string',
          description: 'The PTY session ID to close (from list_sessions or create_session)',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'broadcast_input',
    description: 'Send the same text input to ALL active CLI sessions at once. Useful for coordinating actions across all projects simultaneously.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances), e.g. an isolated test instance on 19837. Defaults to the instance this MCP connected to — when testing, ALWAYS pass the test instance port so you do not touch the user\'s real session.' },
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
  {
    name: 'cron_add',
    description: 'Schedule a recurring message to be sent to a specific session. session_id is required — use list_sessions first. To send to all sessions use broadcast_input instead. Returns the cron job ID for management.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The text message to send on each interval',
        },
        interval_seconds: {
          type: 'number',
          description: 'How often to send the message, in seconds (minimum 10)',
        },
        session_id: {
          type: 'string',
          description: 'Target session ID to send to (required). Use list_sessions to get session IDs. To broadcast to all sessions use broadcast_input instead.',
        },
      },
      required: ['message', 'interval_seconds', 'session_id'],
    },
  },
  {
    name: 'cron_update',
    description: 'Update an existing cron job — change its message, interval, or target session. Only provided fields are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          description: 'The cron job ID to update (from cron_list or cron_add response)',
        },
        message: {
          type: 'string',
          description: 'New message to send on each interval (optional)',
        },
        interval_seconds: {
          type: 'number',
          description: 'New interval in seconds (minimum 10, optional)',
        },
        session_id: {
          type: 'string',
          description: 'New target session ID (optional). Use list_sessions to get session IDs.',
        },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'cron_list',
    description: 'List all active cron jobs with their IDs, messages, intervals, targets, and run counts.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'cron_delete',
    description: 'Delete a cron job by its ID, stopping any further scheduled messages.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          description: 'The cron job ID (from cron_list or cron_add response)',
        },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'debug_instances',
    description: 'Scan ports 19836-19840 for running Claude Terminal instances and report each one: port, whether debug routes are enabled, whether the renderer bridge is up, packaged/dev, uptime, PTY count. Use this to find an isolated TEST instance (see docs/agent-debug-testing.md) and pass its port as instance_port to the other debug_* tools — that way you test new code in a second instance without restarting the instance you are running inside.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'debug_state',
    description: 'Get a full debug snapshot of Claude Terminal: renderer state (workspace sessions, open tabs, active tile tree, registered terminal IDs) plus main-process state (PTY sessions with buffer stats, persisted workspace file, zoom factor). Requires the app to run in debug mode (--debug, DEBUG_MODE=1, or dev). Start here when diagnosing any UI behavior.',
    inputSchema: { type: 'object', properties: {
      instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances). Defaults to the instance this MCP connected to.' },
    }, required: [] },
  },
  {
    name: 'debug_terminal',
    description: 'Get scroll/viewport state of one rendered terminal: viewportY, baseY, atBottom, rows/cols, scrollbackLines, userScrolledUp flag, WebGL status, focus, and screen rect. Call before and after debug_input_event or debug_action to verify scrolling actually moved. pty_id comes from list_sessions; registered ids are listed in debug_state under renderer.registeredTerminalIds.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances). Defaults to the instance this MCP connected to.' },
        pty_id: { type: 'string', description: 'The PTY session ID (from list_sessions)' },
      },
      required: ['pty_id'],
    },
  },
  {
    name: 'debug_events',
    description: 'Read the renderer debug event trace (ring buffer of scroll, resize, fit, workspace-switch, restore events with timestamps and sequence numbers). Filter with type (substring match, e.g. "scroll:" or "workspace:") and since_seq (only events after that sequence number — use the last seq you saw to poll incrementally).',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances). Defaults to the instance this MCP connected to.' },
        since_seq: { type: 'number', description: 'Only return events with seq greater than this' },
        type: { type: 'string', description: 'Substring filter on event type, e.g. "scroll:" or "workspace:"' },
        limit: { type: 'number', description: 'Max events to return (default 200)' },
      },
      required: [],
    },
  },
  {
    name: 'debug_console',
    description: 'Read renderer console messages (console.log/warn/error) captured by the main process. Filter by level (verbose|info|warning|error) and/or a regex pattern. Check level=error after any test action to catch silent renderer failures.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances). Defaults to the instance this MCP connected to.' },
        level: { type: 'string', description: 'Filter by level: verbose, info, warning, error', enum: ['verbose', 'info', 'warning', 'error'] },
        pattern: { type: 'string', description: 'Regex to filter message text' },
        limit: { type: 'number', description: 'Max messages to return (default 100)' },
      },
      required: [],
    },
  },
  {
    name: 'debug_screenshot',
    description: 'Capture a PNG screenshot of the Claude Terminal window and save it to a temp file. Returns the file path — use the Read tool on that path to view the image. Use for visual confirmation after scroll/switch actions.',
    inputSchema: { type: 'object', properties: {
      instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances). Defaults to the instance this MCP connected to.' },
    }, required: [] },
  },
  {
    name: 'debug_input_event',
    description: 'Send a REAL input event through Chromium\'s input pipeline (webContents.sendInputEvent) — exercises the actual wheel/key handlers exactly like a physical mouse/keyboard. For type=wheel, the event is aimed at the center of the given terminal (pty_id required; positive delta_y scrolls content up/back in history, negative scrolls down); returns before/after terminal snapshots so you can verify viewportY moved. For type=key, pass key (e.g. "Up", "Enter", "a") and optional modifiers; focus the terminal first with debug_action focus_terminal. For type=click, pass x/y viewport coordinates or a CSS selector — performs a real mouseDown+mouseUp (use for tab/workspace switching through the actual UI).',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances). Defaults to the instance this MCP connected to.' },
        type: { type: 'string', enum: ['wheel', 'key', 'click'], description: 'Input event type' },
        pty_id: { type: 'string', description: 'Target terminal PTY ID (required for wheel)' },
        x: { type: 'number', description: 'Viewport x coordinate for type=click' },
        y: { type: 'number', description: 'Viewport y coordinate for type=click' },
        selector: { type: 'string', description: 'CSS selector to click (alternative to x/y for type=click; aims at element center)' },
        delta_y: { type: 'number', description: 'Wheel vertical delta per step (positive = scroll up into history)' },
        delta_x: { type: 'number', description: 'Wheel horizontal delta per step' },
        steps: { type: 'number', description: 'Repeat the wheel event N times, 30ms apart (default 1, max 50)' },
        key: { type: 'string', description: 'Key code for type=key, e.g. "Enter", "Up", "PageUp", "a"' },
        modifiers: { type: 'array', items: { type: 'string' }, description: 'Modifiers for type=key, e.g. ["control"], ["shift"]' },
      },
      required: ['type'],
    },
  },
  {
    name: 'debug_action',
    description: 'Invoke a renderer-side debug action: switch_workspace {sessionId}, set_active_tab {tabId}, scroll_terminal {ptyId, lines}, scroll_to_bottom {ptyId}, focus_terminal {ptyId}, dispatch_wheel {ptyId, deltaY} (synthetic DOM WheelEvent — bypasses Chromium input; prefer debug_input_event for real-path testing), inject_output {ptyId, lines} or {ptyId, data} (write test lines into the xterm buffer ONLY, not the PTY — deterministic scrollback for scroll tests), clear_events. Returns {ok, before, after} state snapshots. Get sessionId/tabId/ptyId values from debug_state.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances). Defaults to the instance this MCP connected to.' },
        action: {
          type: 'string',
          enum: ['switch_workspace', 'set_active_tab', 'scroll_terminal', 'scroll_to_bottom', 'focus_terminal', 'dispatch_wheel', 'inject_output', 'clear_events'],
          description: 'The action to perform',
        },
        args: { type: 'object', description: 'Action arguments (see action descriptions)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'debug_eval',
    description: 'Evaluate an arbitrary JavaScript expression in the renderer\'s page context and return its JSON-serialized result. The escape hatch when the structured debug tools don\'t expose what you need — e.g. "window.__ctDebug.getState().sessions.length" or DOM queries like "document.querySelectorAll(\'.xterm\').length". Async expressions are awaited. Non-JSON-serializable results return an error.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances). Defaults to the instance this MCP connected to.' },
        expression: { type: 'string', description: 'JavaScript expression to evaluate in the renderer' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'debug_relaunch',
    description: 'WARNING: terminates and restarts the Claude Terminal app (app.relaunch + exit). Use only for testing session restore on packaged/--debug builds. Under "npm run dev" the relaunched instance detaches from the dev server — restart the dev task instead. All PTY sessions are killed.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_port: { type: 'number', description: 'Target a specific instance by orchestrator port (from debug_instances). Defaults to the instance this MCP connected to.' },
        confirm: { type: 'boolean', description: 'Must be true to confirm the restart' },
      },
      required: ['confirm'],
    },
  },
]

// --- Tool handlers ---

async function handleToolCall(name, args) {
  switch (name) {
    case 'list_tiles': {
      const result = await apiRequest('GET', '/tiles', null, args.instance_port)
      if (result.tiles) {
        const formatted = result.tiles.map(t => ({
          tile_id: t.tileId,
          session_ids: t.tabIds,
          active_session_id: t.activeTabId,
          workspace: t.workspaceName,
        }))
        return JSON.stringify({ tiles: formatted }, null, 2)
      }
      return JSON.stringify({ tiles: [] })
    }
    case 'list_sessions': {
      const result = await apiRequest('GET', '/sessions', null, args.instance_port)
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
      const result = await apiRequest('GET', `/sessions/${args.session_id}/output?lines=${maxLines}`, null, args.instance_port)
      if (result.lines) {
        return { content: [{ type: 'text', text: result.lines.join('\n') || '(no output yet)' }] }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: true }
    }

    case 'send_session_input': {
      const body = { input: args.input }
      if (args.raw) body.raw = true
      const result = await apiRequest('POST', `/sessions/${args.session_id}/input`, body, args.instance_port)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }

    case 'create_session': {
      const body = { cwd: args.cwd }
      if (args.backend) body.backend = args.backend
      if (args.model) body.model = args.model
      if (args.workspace_id) body.workspace_id = args.workspace_id
      if (args.tile_id) body.tile_id = args.tile_id
      if (args.placement) body.placement = args.placement
      const result = await apiRequest('POST', '/sessions', body, args.instance_port)
      if (result.session_id) {
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: true }
    }

    case 'close_session': {
      const result = await apiRequest('DELETE', `/sessions/${args.session_id}`, null, args.instance_port)
      if (result.success) {
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: true }
    }

    case 'broadcast_input': {
      const sessions = await apiRequest('GET', '/sessions', null, args.instance_port)
      if (!sessions.sessions || sessions.sessions.length === 0) {
        return { content: [{ type: 'text', text: 'No active sessions to broadcast to.' }] }
      }

      const results = []
      for (const session of sessions.sessions) {
        try {
          const r = await apiRequest('POST', `/sessions/${session.id}/input`, { input: args.input }, args.instance_port)
          results.push({ project: session.projectName, session_id: session.id, ...r })
        } catch (e) {
          results.push({ project: session.projectName, session_id: session.id, error: e.message })
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] }
    }

    case 'cron_add': {
      if (!args.session_id) {
        return { content: [{ type: 'text', text: 'session_id is required. Use list_sessions to get a session ID, or use broadcast_input for all sessions.' }], isError: true }
      }
      if (CRON_JOBS.size >= MAX_CRON_JOBS) {
        return { content: [{ type: 'text', text: `Cron job limit reached (${MAX_CRON_JOBS}). Delete existing jobs with cron_delete before adding more.` }], isError: true }
      }
      const intervalSeconds = Math.max(args.interval_seconds, 10)
      const id = String(++cronIdCounter)
      const job = {
        id,
        message: args.message,
        intervalMs: intervalSeconds,
        intervalSeconds,
        target: args.session_id,
        createdAt: Date.now(),
        lastRun: null,
        runCount: 0,
        timer: null,
      }
      executeCronJob(job)
      CRON_JOBS.set(id, job)
      return { content: [{ type: 'text', text: JSON.stringify({
        job_id: id,
        message: job.message,
        interval_seconds: intervalSeconds,
        target: job.target,
        created_at: new Date(job.createdAt).toISOString(),
      }, null, 2) }] }
    }

    case 'cron_update': {
      const job = CRON_JOBS.get(args.job_id)
      if (!job) {
        return { content: [{ type: 'text', text: `No cron job found with ID "${args.job_id}"` }], isError: true }
      }
      const reschedule = args.interval_seconds !== undefined
      if (args.message !== undefined) job.message = args.message
      if (args.session_id !== undefined) job.target = args.session_id
      if (reschedule) {
        const newInterval = Math.max(args.interval_seconds, 10)
        clearInterval(job.timer)
        job.intervalSeconds = newInterval
        job.intervalMs = newInterval
        executeCronJob(job)
      }
      return { content: [{ type: 'text', text: JSON.stringify({
        job_id: job.id,
        message: job.message,
        interval_seconds: job.intervalSeconds,
        target: job.target,
        run_count: job.runCount,
      }, null, 2) }] }
    }

    case 'cron_list': {
      const jobs = []
      for (const [id, job] of CRON_JOBS) {
        jobs.push({
          job_id: id,
          message: job.message,
          interval_seconds: job.intervalSeconds,
          target: job.target,
          run_count: job.runCount,
          last_run: job.lastRun ? new Date(job.lastRun).toISOString() : null,
          created_at: new Date(job.createdAt).toISOString(),
        })
      }
      if (jobs.length === 0) {
        return { content: [{ type: 'text', text: 'No active cron jobs.' }] }
      }
      return { content: [{ type: 'text', text: JSON.stringify(jobs, null, 2) }] }
    }

    case 'cron_delete': {
      const job = CRON_JOBS.get(args.job_id)
      if (!job) {
        return { content: [{ type: 'text', text: `No cron job found with ID "${args.job_id}"` }], isError: true }
      }
      clearInterval(job.timer)
      CRON_JOBS.delete(args.job_id)
      return { content: [{ type: 'text', text: JSON.stringify({
        deleted: args.job_id,
        message: job.message,
        run_count: job.runCount,
      }, null, 2) }] }
    }

    case 'debug_instances': {
      const checks = []
      for (let port = BASE_PORT; port < BASE_PORT + 5; port++) {
        checks.push(
          new Promise(resolve => {
            const req = http.get({ hostname: API_HOST, port, path: '/debug/state', timeout: 500, headers: { 'x-orchestrator-secret': getSecret(port) } }, res => {
              let data = ''
              res.on('data', c => { data += c })
              res.on('end', () => {
                try {
                  const d = JSON.parse(data)
                  if (d.main) {
                    resolve({ port, debug_enabled: true, renderer_bridge: d.ok, packaged: d.main.packaged, uptime_ms: d.main.uptimeMs, pty_count: d.main.ptySessions?.length ?? 0 })
                  } else {
                    resolve({ port, debug_enabled: false, note: d.error || 'debug routes unavailable (app not in debug mode or older build)' })
                  }
                } catch { resolve(null) }
              })
            })
            req.on('error', () => resolve(null))
            req.on('timeout', () => { req.destroy(); resolve(null) })
          })
        )
      }
      const instances = (await Promise.all(checks)).filter(Boolean)
      return { content: [{ type: 'text', text: JSON.stringify({ default_port: API_PORT, instances }, null, 2) }] }
    }

    case 'debug_state': {
      const result = await apiRequest('GET', '/debug/state', null, args.instance_port)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }

    case 'debug_terminal': {
      const result = await apiRequest('GET', `/debug/terminal/${encodeURIComponent(args.pty_id)}`, null, args.instance_port)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }

    case 'debug_events': {
      const params = new URLSearchParams()
      if (args.since_seq != null) params.set('since', String(args.since_seq))
      if (args.type) params.set('type', args.type)
      if (args.limit != null) params.set('limit', String(args.limit))
      const qs = params.toString()
      const result = await apiRequest('GET', `/debug/events${qs ? '?' + qs : ''}`, null, args.instance_port)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }

    case 'debug_console': {
      const params = new URLSearchParams()
      if (args.level) params.set('level', args.level)
      if (args.pattern) params.set('pattern', args.pattern)
      if (args.limit != null) params.set('limit', String(args.limit))
      const qs = params.toString()
      const result = await apiRequest('GET', `/debug/console${qs ? '?' + qs : ''}`, null, args.instance_port)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }

    case 'debug_screenshot': {
      const result = await apiRequest('POST', '/debug/screenshot', {}, args.instance_port)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }

    case 'debug_input_event': {
      const body = {
        type: args.type,
        ptyId: args.pty_id,
        deltaY: args.delta_y,
        deltaX: args.delta_x,
        steps: args.steps,
        key: args.key,
        modifiers: args.modifiers,
        x: args.x,
        y: args.y,
        selector: args.selector,
      }
      const result = await apiRequest('POST', '/debug/input-event', body, args.instance_port)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }

    case 'debug_action': {
      const result = await apiRequest('POST', '/debug/action', { action: args.action, args: args.args || {} }, args.instance_port)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }

    case 'debug_eval': {
      const result = await apiRequest('POST', '/debug/eval', { expression: args.expression }, args.instance_port)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }

    case 'debug_relaunch': {
      const result = await apiRequest('POST', '/debug/relaunch', { confirm: args.confirm === true }, args.instance_port)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
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
          resources: {},
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

    case 'resources/list': {
      try {
        const result = await apiRequest('GET', '/sessions')
        const sessions = result.sessions || []
        const now = Date.now()
        const resources = [
          {
            uri: 'orchestrator://sessions',
            name: 'Active Sessions',
            description: 'All active CLI sessions in Claude Terminal',
            mimeType: 'application/json',
          },
          ...sessions.map(s => ({
            uri: `orchestrator://session/${s.id}/output`,
            name: `${s.projectName || s.projectPath} (${s.backend}, ${Math.round((now - s.spawnedAt) / 60000)}m)`,
            description: `Recent output from session ${s.id} in ${s.projectPath}`,
            mimeType: 'text/plain',
          })),
        ]
        sendResponse(id, { resources })
      } catch (e) {
        sendResponse(id, { resources: [] })
      }
      break
    }

    case 'resources/read': {
      const uri = params?.uri || ''
      try {
        if (uri === 'orchestrator://sessions') {
          const result = await apiRequest('GET', '/sessions')
          const sessions = result.sessions || []
          const now = Date.now()
          const formatted = sessions.map(s => ({
            session_id: s.id,
            project: s.projectName,
            project_path: s.projectPath,
            backend: s.backend,
            uptime_minutes: Math.round((now - s.spawnedAt) / 60000),
          }))
          sendResponse(id, {
            contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(formatted, null, 2) }],
          })
        } else {
          const match = uri.match(/^orchestrator:\/\/session\/([^/]+)\/output$/)
          if (match) {
            const sessionId = match[1]
            const result = await apiRequest('GET', `/sessions/${sessionId}/output?lines=80`)
            const text = result.lines ? result.lines.join('\n') : (result.error || 'Session not found')
            sendResponse(id, {
              contents: [{ uri, mimeType: 'text/plain', text }],
            })
          } else {
            sendError(id, -32602, `Unknown resource URI: ${uri}`)
          }
        }
      } catch (e) {
        sendError(id, -32603, `Failed to read resource: ${e.message}`)
      }
      break
    }

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

// --- Port discovery: try BASE_PORT to BASE_PORT+4 ---

async function discoverPort() {
  for (let port = BASE_PORT; port < BASE_PORT + 5; port++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.request({ hostname: API_HOST, port, path: '/sessions', method: 'GET' }, (res) => {
          res.resume()
          res.on('end', resolve)
        })
        req.setTimeout(500, () => { req.destroy(); reject(new Error('timeout')) })
        req.on('error', reject)
        req.end()
      })
      API_PORT = port
      process.stderr.write(`[orchestrator-mcp] Found orchestrator on port ${port}\n`)
      return
    } catch {
      // try next port
    }
  }
  process.stderr.write(`[orchestrator-mcp] Orchestrator not found on ports ${BASE_PORT}-${BASE_PORT + 4}, using ${BASE_PORT}\n`)
}

// --- Main: read JSON-RPC from stdin ---

const rl = createInterface({ input: process.stdin })

discoverPort().then(() => {
  process.stderr.write('[orchestrator-mcp] Server started\n')
})

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
