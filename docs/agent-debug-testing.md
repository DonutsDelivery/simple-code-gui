# Agent Guide: Debugging & Testing Claude Terminal

How an AI agent verifies app behavior (scrolling, workspace switching, session
restore, PTY handling) with real introspection instead of guessing. The
orchestrator MCP server exposes `debug_*` tools backed by `/debug/*` HTTP routes
on the orchestrator API (port 19836+, localhost only).

**Availability:** debug routes only respond when the app runs in debug mode —
`npm run dev`, `DEBUG_MODE=1`, `--debug`, or any unpackaged build. In packaged
production builds without `--debug` they return 403.

**Auth:** every orchestrator route (debug included) requires the per-launch
shared secret in an `x-orchestrator-secret` header. Each instance writes its
secret to `~/.claude-terminal/orchestrator-secret-<port>` (0600) after binding
its port. The MCP tools handle this automatically; for raw curl:

```bash
curl -H "x-orchestrator-secret: $(cat ~/.claude-terminal/orchestrator-secret-19837)" \
  http://127.0.0.1:19837/debug/state
```

## Architecture in one paragraph

The renderer installs `window.__ctDebug` (`src/renderer/debug/debugBridge.ts`):
a registry of live xterm instances, a snapshot of the zustand workspace store,
and a ring buffer of trace events (every `scrollDebug()` call site feeds it).
The main process (`src/main/debug-api.ts`) reads it via
`webContents.executeJavaScript`, adds PTY-manager internals, renderer console
capture, screenshots (`webContents.capturePage` — in-app, not OS-level), and
real input injection (`webContents.sendInputEvent`). The MCP wrapper
(`scripts/orchestrator-mcp.mjs`) proxies all of it as tools.

## The golden rules

1. You are usually **running inside** Claude Terminal. Never kill/restart the
   app that hosts you, and never `pkill electron`.
2. Never test against the user's instance. Use the isolated test environment
   and pass its port as `instance_port` on **every** tool call — session tools
   (`create_session`, `send_session_input`, …) and `debug_*` tools alike.
   Without `instance_port`, calls go to the instance the MCP connected to:
   usually the user's real one (real tabs will appear in their UI).

## The test environment

```bash
npm run build                  # dev server does NOT hot-serve renderer changes (watch: null)
scripts/test-env.sh start      # → prints the orchestrator port (usually 19837)
scripts/test-env.sh stop       # when done; rm -rf /tmp/ct-test-env to reset fully
```

The script launches a fully sandboxed instance at `/tmp/ct-test-env`:

- **fake `HOME`** → it cannot see the user's real `~/.claude` sessions (so no
  auto-restored tabs of real projects), credentials, or config
- **own `--user-data-dir`** → own workspace/settings, bypasses the
  single-instance lock
- **seeded throwaway projects** (`/tmp/ct-test-env/projects/sample-a`, `-b`)
  registered in its workspace so `create_session`'s project-root gate passes —
  spawn sessions only in these
- **orchestrator secret** still written to the real `~/.claude-terminal/`
  (per-port file) via `ORCHESTRATOR_SECRET_DIR`, so your MCP tools can auth

Then:

1. `debug_instances` → confirm the test instance and its port.
2. Pass `instance_port: <port>` to every call.
3. Spawned CLIs run under the fake HOME, so they sit at login/trust prompts —
   that's fine for UI testing; use `debug_action inject_output` to generate
   terminal content deterministically instead of driving the CLI.

## Tool cheat sheet

| Tool | Use |
|---|---|
| `debug_instances` | Find running instances + ports |
| `debug_state` | Workspace store (sessions/tabs/tile tree/registered terminals) + main PTY internals + workspace.json |
| `debug_terminal {pty_id}` | `viewportY`, `baseY`, `atBottom`, `scrollbackLines`, `userScrolledUp`, `webglActive`, `hasFocus`, screen `rect` |
| `debug_input_event` | Real Chromium input. `{type:'wheel', pty_id, delta_y, steps}` (positive delta_y scrolls up into history) returns before/after snapshots. `{type:'key', key, modifiers}` needs focus first |
| `debug_action` | `switch_workspace {sessionId}`, `set_active_tab {tabId}`, `scroll_terminal {ptyId, lines}`, `scroll_to_bottom {ptyId}`, `focus_terminal {ptyId}`, `inject_output {ptyId, lines|data}` (writes into xterm buffer ONLY, not the PTY), `dispatch_wheel` (synthetic DOM event — bypasses Chromium; prefer debug_input_event), `clear_events` |
| `debug_events` | Trace ring: `scroll:*` (all scrollDebug sites), `workspace:switch`, `workspace:restored`, `terminal:register`. Poll incrementally with `since_seq` |
| `debug_console` | Renderer console.log/warn/error captured in main; filter `level`/`pattern` |
| `debug_screenshot` | PNG via capturePage → temp path; view it with the Read tool |
| `debug_eval` | Arbitrary JS in the renderer page — escape hatch when structured tools aren't enough |
| `debug_relaunch` | Restarts the app. Packaged/--debug builds only; never on the instance hosting you |

## Recipes

### "Does scrolling work?"

```text
1. debug_instances                         → pick test instance port P
2. debug_state {instance_port: P}          → pick a registered terminal ptyId
3. debug_action inject_output {ptyId, lines: 200} → baseY rises, atBottom true
4. debug_input_event {type: wheel, pty_id, delta_y: 120, steps: 5, instance_port: P}
   → assert after.viewportY < before.viewportY and after.userScrolledUp == true
5. debug_action inject_output {ptyId, lines: 50}  → assert viewportY UNCHANGED
   (scroll anchoring: new output must not yank a scrolled-up user to the bottom)
6. debug_input_event wheel with delta_y: -120 until atBottom == true,
   assert userScrolledUp flips false
7. debug_events {type: "scroll"}           → handler trace confirms the real path ran
8. debug_console {level: "error"}          → must be empty
```

### "Does workspace/tab switching work?"

```text
1. debug_state                → note activeSessionId / activeTabId / tile tree
2. debug_action switch_workspace {sessionId} (or set_active_tab {tabId})
3. debug_state                → assert active ids changed, openTabs/tileTree match target
4. debug_events {type: "workspace"} → switch event recorded
5. debug_screenshot           → visual confirmation
```

### "Does session restore work?"

```text
1. In a test instance, open sessions/tabs; debug_state → record the shape
   (workspace ids, tab ptyIds, tile tree); note main.workspaceFile
2. Kill the test instance (pgrep on its user-data-dir), relaunch it
3. Poll debug_state until the bridge answers; compare shapes,
   check sessions[].isRestored / hasSavedData
4. debug_events {type: "workspace:restored"}; read_session_output to confirm
   the PTY replayed
```

### "Why is it broken?" (the non-guessing loop)

1. Reproduce via `debug_input_event`/`debug_action` (real input path).
2. Read the facts: `debug_terminal` (buffer truth), `debug_events` (what the
   handlers actually did, in order), `debug_console` (errors).
3. If the structured data is insufficient, `debug_eval` arbitrary expressions
   against `window.__ctDebug.getState()`, the DOM, or anything in the page.
4. Screenshot for visual state.
5. Fix code → `npm run build` → restart the **test** instance → repeat.

## Gotchas

- The MCP wrapper connects to the first alive port (your own instance). Always
  use `instance_port` for the test instance, or spawn a dedicated wrapper with
  `ORCHESTRATOR_PORT=19837 node scripts/orchestrator-mcp.mjs`.
- `inject_output` writes to the renderer's xterm only — `read_session_output`
  (PTY OutputBuffer) will NOT show injected lines. That's expected.
- Wheel coordinates are computed from the terminal's rect; the target tab must
  be visible/active. Keyboard events need DOM focus (`focus_terminal` first).
- `webglActive: false` under Xvfb/CI is normal; scroll assertions use buffer
  state and don't depend on WebGL.
- Unit tests (`npm test`) cover pure logic; this system is for live-app
  behavior the unit tests can't see.
