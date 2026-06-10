#!/usr/bin/env bash
# Isolated testing environment for Claude Terminal (see docs/agent-debug-testing.md).
#
# Launches a second app instance that CANNOT touch the user's real projects or
# sessions:
#   - fake HOME            → no real ~/.claude sessions to discover/resume,
#                            no real credentials, no real config
#   - own user-data dir    → own workspace.json, settings, window state
#   - seeded throwaway projects → create_session has valid project roots
#   - per-port orchestrator secret written to the REAL ~/.claude-terminal
#     (via ORCHESTRATOR_SECRET_DIR) so the MCP shim's debug_* tools can auth
#
# Usage:
#   scripts/test-env.sh start [env-dir]   # default env-dir: /tmp/ct-test-env
#   scripts/test-env.sh stop  [env-dir]
#   scripts/test-env.sh status [env-dir]
#
# After start, find the instance with the debug_instances MCP tool (usually
# port 19837) and target it with instance_port.

set -euo pipefail

CMD="${1:-start}"
# Default under $HOME (0700) — the env holds copied credentials for real-harness
# tests, so it must not live in world-readable /tmp.
ENV_DIR="${2:-$HOME/.cache/ct-test-env}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REAL_SECRET_DIR="$HOME/.claude-terminal"
LOG_FILE="$ENV_DIR/test-instance.log"

status() {
  if pgrep -f -- "--user-data-dir=$ENV_DIR/userdata" > /dev/null; then
    echo "running (pids: $(pgrep -f -- "--user-data-dir=$ENV_DIR/userdata" | tr '\n' ' '))"
  else
    echo "not running"
  fi
}

case "$CMD" in
  start)
    if pgrep -f -- "--user-data-dir=$ENV_DIR/userdata" > /dev/null; then
      echo "Test env already running at $ENV_DIR ($(status))"
      exit 0
    fi

    mkdir -p "$ENV_DIR/home" "$ENV_DIR/userdata/config" "$ENV_DIR/projects" "$ENV_DIR/bin"
    chmod 700 "$ENV_DIR"

    # Hybrid "claude" backend shim, resolved via the PATH override:
    #   - sessions in sample-a run a plain bash shell (deterministic output for
    #     scrollback/volume tests, zero API usage)
    #   - sessions anywhere else run the REAL claude binary (full harness
    #     roundtrip tests; copy credentials into the fake HOME for that)
    REAL_CLAUDE="$(command -v claude || true)"
    if [ ! -x "$ENV_DIR/bin/claude" ]; then
      cat > "$ENV_DIR/bin/claude" <<FAKE
#!/usr/bin/env bash
case "\${1:-}" in
  --version|-v|--help|-h) echo "9.9.9 (test-env fake claude)"; exit 0 ;;
esac
if [[ "\$PWD" == */sample-a ]]; then
  echo "[test-env fake claude] args: \$*"
  exec /bin/bash --noprofile --norc -i
fi
exec "${REAL_CLAUDE:-/bin/bash}" "\$@"
FAKE
      chmod +x "$ENV_DIR/bin/claude"
    fi

    # Real-harness credentials: claude reads auth + onboarding state from HOME.
    # Copying them into the sandbox HOME lets real sessions respond, while
    # session transcripts still land inside the sandbox (fake HOME), never in
    # the user's real ~/.claude.
    if [ -f "$HOME/.claude/.credentials.json" ] && [ ! -f "$ENV_DIR/home/.claude/.credentials.json" ]; then
      mkdir -p "$ENV_DIR/home/.claude"
      chmod 700 "$ENV_DIR/home" "$ENV_DIR/home/.claude"
      cp -p "$HOME/.claude/.credentials.json" "$ENV_DIR/home/.claude/"
    fi
    if [ -f "$HOME/.claude.json" ] && [ ! -f "$ENV_DIR/home/.claude.json" ]; then
      cp -p "$HOME/.claude.json" "$ENV_DIR/home/.claude.json"
    fi
    # Same for the other backend harnesses (auth/config only, transcripts stay
    # in the sandbox): gemini, codex, opencode.
    if [ -d "$HOME/.gemini" ] && [ ! -d "$ENV_DIR/home/.gemini" ]; then
      mkdir -p "$ENV_DIR/home/.gemini" && chmod 700 "$ENV_DIR/home/.gemini"
      for f in oauth_creds.json settings.json google_accounts.json installation_id; do
        [ -f "$HOME/.gemini/$f" ] && cp -p "$HOME/.gemini/$f" "$ENV_DIR/home/.gemini/"
      done
    fi
    if [ -d "$HOME/.codex" ] && [ ! -d "$ENV_DIR/home/.codex" ]; then
      mkdir -p "$ENV_DIR/home/.codex" && chmod 700 "$ENV_DIR/home/.codex"
      for f in auth.json config.toml config.json; do
        [ -f "$HOME/.codex/$f" ] && cp -p "$HOME/.codex/$f" "$ENV_DIR/home/.codex/"
      done
    fi
    if [ -f "$HOME/.local/share/opencode/auth.json" ] && [ ! -f "$ENV_DIR/home/.local/share/opencode/auth.json" ]; then
      mkdir -p "$ENV_DIR/home/.local/share/opencode"
      chmod 700 "$ENV_DIR/home/.local" "$ENV_DIR/home/.local/share" "$ENV_DIR/home/.local/share/opencode"
      cp -p "$HOME/.local/share/opencode/auth.json" "$ENV_DIR/home/.local/share/opencode/"
      [ -d "$HOME/.config/opencode" ] && cp -rp "$HOME/.config/opencode" "$ENV_DIR/home/.config/" 2>/dev/null || true
    fi
    if [ -d "$HOME/.hermes" ] && [ ! -d "$ENV_DIR/home/.hermes" ]; then
      mkdir -p "$ENV_DIR/home/.hermes" && chmod 700 "$ENV_DIR/home/.hermes"
      for f in auth.json config.yaml .env; do
        [ -f "$HOME/.hermes/$f" ] && cp -p "$HOME/.hermes/$f" "$ENV_DIR/home/.hermes/"
      done
    fi

    # Throwaway projects the test workspace points at
    for name in sample-a sample-b; do
      proj="$ENV_DIR/projects/$name"
      if [ ! -d "$proj" ]; then
        mkdir -p "$proj"
        echo "# $name — throwaway project for Claude Terminal testing" > "$proj/README.md"
        git -C "$proj" init -q 2>/dev/null || true
      fi
    done

    # Seed workspace.json so create_session's project-root gate passes
    if [ ! -f "$ENV_DIR/userdata/config/workspace.json" ]; then
      cat > "$ENV_DIR/userdata/config/workspace.json" <<EOF
{
  "workspace": {
    "projects": [
      { "path": "$ENV_DIR/projects/sample-a", "name": "sample-a" },
      { "path": "$ENV_DIR/projects/sample-b", "name": "sample-b" }
    ],
    "categories": [],
    "sessions": [],
    "activeSessionId": null
  }
}
EOF
    fi

    if [ ! -f "$APP_DIR/dist/main/index.js" ]; then
      echo "No build found — running npm run build first..."
      (cd "$APP_DIR" && npm run build)
    fi

    # Display env: inherit if present, else default to :0 / wayland-0
    export DISPLAY="${DISPLAY:-:0}"
    [ -n "${WAYLAND_DISPLAY:-}" ] || export WAYLAND_DISPLAY=wayland-0

    HOME="$ENV_DIR/home" \
    PATH="$ENV_DIR/bin:$PATH" \
    ORCHESTRATOR_SECRET_DIR="$REAL_SECRET_DIR" \
    NODE_ENV=production \
    DEBUG_MODE=1 \
    nohup "$APP_DIR/node_modules/.bin/electron" "$APP_DIR" \
      --user-data-dir="$ENV_DIR/userdata" > "$LOG_FILE" 2>&1 &
    disown || true

    echo "Started. Waiting for orchestrator..."
    for _ in $(seq 1 30); do
      sleep 1
      port=$(grep -ho "API server started on port [0-9]*" "$LOG_FILE" 2>/dev/null | tail -1 | grep -o '[0-9]*$' || true)
      if [ -n "$port" ]; then
        echo "Test instance up: orchestrator port $port, env $ENV_DIR"
        echo "Use debug_* MCP tools with instance_port: $port"
        exit 0
      fi
    done
    echo "Timed out waiting for orchestrator — check $LOG_FILE"
    exit 1
    ;;

  stop)
    pgrep -f -- "--user-data-dir=$ENV_DIR/userdata" | xargs -r kill 2>/dev/null || true
    sleep 1
    pgrep -f -- "--user-data-dir=$ENV_DIR/userdata" | xargs -r kill -9 2>/dev/null || true
    echo "Stopped. Env kept at $ENV_DIR (delete it to reset: rm -rf $ENV_DIR)"
    ;;

  status)
    status
    ;;

  *)
    echo "Usage: $0 start|stop|status [env-dir]"
    exit 1
    ;;
esac
