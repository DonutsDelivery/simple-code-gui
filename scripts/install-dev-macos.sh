#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "dev:install:mac is only supported on macOS" >&2
  exit 1
fi

project_root="$(cd "$(dirname "$0")/.." && pwd)"
canonical_app="/Applications/DonutCode.app"
build_root="$(mktemp -d "${TMPDIR:-/tmp}/donutcode-dev-build.XXXXXX")"
stage_app="/Applications/.DonutCode.dev-install.$$.app"
backup_app="/Applications/.DonutCode.dev-backup.$$.app"

cleanup() {
  rm -rf "$build_root" "$stage_app"
}
trap cleanup EXIT

cd "$project_root"
./node_modules/.bin/electron-builder \
  --mac dir \
  --publish never \
  --config.directories.output="$build_root"

built_app="$(find "$build_root" -type d -path '*/DonutCode.app' -prune -print -quit)"
if [[ -z "$built_app" || ! -f "$built_app/Contents/Info.plist" ]]; then
  echo "Packaged DonutCode.app was not produced" >&2
  exit 1
fi

osascript -e 'tell application "DonutCode" to quit' >/dev/null 2>&1 || true
canonical_pid_pattern="^${canonical_app}/Contents/MacOS/DonutCode$"
for _ in {1..30}; do
  pgrep -f "$canonical_pid_pattern" >/dev/null || break
  sleep 0.1
done
if pgrep -f "$canonical_pid_pattern" >/dev/null; then
  pkill -TERM -f "$canonical_pid_pattern"
  for _ in {1..20}; do
    pgrep -f "$canonical_pid_pattern" >/dev/null || break
    sleep 0.1
  done
fi
if pgrep -f "$canonical_pid_pattern" >/dev/null; then
  echo "The canonical DonutCode process did not stop; app was not replaced" >&2
  exit 1
fi

ditto "$built_app" "$stage_app"
if [[ -d "$canonical_app" ]]; then
  mv "$canonical_app" "$backup_app"
fi
if ! mv "$stage_app" "$canonical_app"; then
  [[ -d "$backup_app" ]] && mv "$backup_app" "$canonical_app"
  exit 1
fi
rm -rf "$backup_app"

/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$canonical_app" >/dev/null 2>&1 || true
open "$canonical_app"
echo "Installed canonical DonutCode development build at $canonical_app"
