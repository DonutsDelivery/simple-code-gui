#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <project-name> <command> [args...]" >&2
  exit 2
fi

project="$1"
shift
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gate="${HOST_HEAVY_BUILD_GATE:-$HOME/.local/bin/host-heavy-build}"

if [[ ! -x "$gate" ]]; then
  echo "DonutCode heavy builds require the host build gate: $gate" >&2
  exit 75
fi

exec "$gate" run \
  --project "$project" \
  --worktree "$root" \
  --wait "${HOST_HEAVY_BUILD_WAIT_SECONDS:-0}" \
  -- "$@"
