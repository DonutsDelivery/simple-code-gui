# DonutCode Unified Runtime — Two-Host Runbook

Fast-track Checkpoint 9F: run the real packaged DonutCode desktop frontend on
either host (Linux x64 / macOS arm64) against the packaged headless backend on
either host, with secure pairing, backend-owned sessions, restart recovery, and
per-device revocation.

**Matrix status**

| Row | Frontend | Backend | Status |
|---|---|---|---|
| A | macOS Electron | macOS headless server | PASS (`9cc0c65` + fixes) |
| B | Linux Electron | Linux headless server | PASS (`fbbdb0f`) |
| C | Linux Electron | macOS headless server | pending |
| D | macOS Electron | Linux headless server | pending |

Row evidence lives in `docs/plans/unified-environment-runtime-implementation.md`
(local working copy; the `plans/` dir is gitignored but the file is tracked).

---

## 1. Build the packages (per host, from the same commit)

Checkout the same commit on both hosts, then:

**Linux (x64)**

```bash
npm ci
npm run package:linux        # -> dist-build/DonutCode-1.3.58.AppImage
                             #    dist-build/linux-unpacked/
```

The packaged headless server binary is
`dist-build/linux-unpacked/resources/bin/donutcode-server`.

**macOS (arm64)**

```bash
npm ci
npm run package:mac           # -> dist-build/DonutCode-1.3.58.dmg / .zip
                              #    dist-build/mac-arm64/DonutCode.app
```

The packaged headless server binary is
`dist-build/mac-arm64/DonutCode.app/Contents/Resources/bin/donutcode-server`
(or run `dist-build/mac-arm64/DonutCode.app/Contents/Resources/bin/donutcode-server serve ...`
directly).

> macOS signing/notarization is deferred to a later checkpoint; ad-hoc signed
> builds are fine for the matrix rows.

---

## 2. Start the backend

Pick the **backend host** (the machine that owns projects/sessions). It must be
reachable from the frontend host over LAN (or Tailscale).

**Linux**

```bash
# DATA_DIR must be an absolute path; runtime-info.json + credential store live here
DATA_DIR=/tmp/dc-backend
mkdir -p "$DATA_DIR"
donutcode-server serve --data-dir "$DATA_DIR" --listen 0.0.0.0 --port 46545
```

**macOS**

```bash
DATA_DIR=/tmp/dc-backend
mkdir -p "$DATA_DIR"
/Applications/DonutCode.app/Contents/Resources/bin/donutcode-server serve \
  --data-dir "$DATA_DIR" --listen 0.0.0.0 --port 46545
```

Notes:

- Omit `--port` (or use `--port 0`) to let the server pick a free port; the
  chosen port is in `runtime-info.json` (`endpoint`).
- `--listen 0.0.0.0` is required for LAN frontends. The default loopback-only
  binding is the secure default for single-host use.
- The data dir is single-owner: a second `serve` against the same `--data-dir`
  is rejected pre-startup.

**Verify**

```bash
donutcode-server status --data-dir "$DATA_DIR"    # running: true, serverId, endpoint
donutcode-server pairing-offer --data-dir "$DATA_DIR" --output /tmp/dc-offer.json
# -> signed, short-lived pairing offer (offer text + expiresAt)
```

Record the `serverId` and the TLS `certFingerprint` from the serve log /
status — both must be stable across backend restarts (the credential is keyed
to them).

---

## 3. Pair the frontend

On the **frontend host**, launch the packaged app with a fresh profile:

**Linux**

```bash
# scrubbed env is REQUIRED on Linux: inherited dev env (NODE_ENV,
# ELECTRON_RENDERER_URL, NODE_OPTIONS) stalls the packaged app before JS init.
# XDG_SESSION_TYPE/XDG_CURRENT_DESKTOP/WAYLAND_DISPLAY make safeStorage
# keyring-backed credentials available (session-type vars per the
# donutcode-linux-electron-acceptance skill).
CFG=$(mktemp -d /tmp/dc-cfg.XXXXXX)
env -i \
  DISPLAY=:0 \
  XAUTHORITY="$XAUTHORITY" \
  XDG_RUNTIME_DIR=/run/user/$(id -u) \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" \
  XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=GNOME WAYLAND_DISPLAY=wayland-0 \
  XDG_CONFIG_HOME="$CFG" \
  HOME="$HOME" PATH=/usr/bin:/bin:/usr/local/bin \
  DEBUG_MODE=1 \
  dist-build/linux-unpacked/donutcode --frontend-only
```

**macOS**

```bash
CFG=$(mktemp -d /tmp/dc-cfg.XXXXXX)
open -n dist-build/mac-arm64/DonutCode.app --args \
  --user-data-dir="$CFG" --frontend-only
```

> `--frontend-only` prevents the local shared-token auto-bind; the app lands on
> the ConnectionScreen.

**Pair:**

1. On the frontend, **Paste pairing link** → paste the offer text from
   `pairing-offer --output` → Continue.
2. The Approve Server dialog shows the backend's serverId + TLS fingerprint —
   verify they match the backend's `status` output, then **Approve**.
3. On the backend host, approve the pending request via the authenticated HTTP
   API (per-device token or host token):

   ```bash
   # list pending requests
   curl -k -H "Authorization: Bearer $TOKEN" \
     https://127.0.0.1:46545/api/auth/pairing-requests
   # approve one
   curl -k -X POST -H "Authorization: Bearer $TOKEN" \
     https://127.0.0.1:46545/api/auth/pairing-requests/<requestId>/approve
   ```

   The backend log shows `Issued per-device token` and the frontend connects
   (`WebSocket client connected (main)`).

The credential is stored in the host keychain/keyring keyed to the serverId;
localStorage holds metadata only. Restarting the frontend with the same
`CFG` lands directly in the app with **zero new pairing requests**.

---

## 4. One canonical session per row

1. Add a project on the backend (`+ add` in the sidebar, or
   `POST /api/project/add` with a path inside a registered project root).
2. Click the project → a harness session spawns **on the backend** (verify the
   process tree on the backend host: `ct-<harness>-client-<ptyId>` under the
   backend PID).
3. Type in the terminal → output arrives ordered (product API writes show a
   monotonic sequence ack).
4. Switch harness from the session footer **Harness** dropup (e.g.
   claude → hermes): backend log shows
   `PTY backend switched { oldId → newId, backend: 'hermes' }`, the old stream
   closes, the new stream connects, and the renderer tab re-points to the new
   pty id.

---

## 5. Restart recovery

- **Backend restart:** `donutcode-server stop --data-dir "$DATA_DIR"` → the
  server must exit promptly even with a connected frontend (fixed in
  `6773d1d`). Restart `serve` with the same `--data-dir` + `--port`: same
  serverId + cert fingerprint, `0` new pairing requests, and the frontend's
  main WSS auto-reconnects (backoff 1s→30s — give it ~30s).
- **Frontend restart:** kill the app, relaunch with the same `CFG`: lands in
  MainApp, no re-pair, WSS + PTY streams re-attach.

---

## 6. Revocation isolation

With two paired devices A and B:

```bash
# list devices (authenticated HTTP on the backend)
curl -k -H "Authorization: Bearer $TOKEN" https://127.0.0.1:46545/api/auth/devices
# revoke device A
curl -k -X POST -H "Authorization: Bearer $TOKEN" \
  https://127.0.0.1:46545/api/auth/devices/<deviceA-id>/revoke
```

Expect: backend log `Revoked device { deviceId: …, tokens: 1 }` →
`WebSocket client disconnected (main)` for A; A is removed from the device
list; **B's** WSS stays connected and its device remains authorized; the
host/operator token is unaffected (revocation is per-device, not a global
secret rotation).

---

## 7. Stop

```bash
donutcode-server stop --data-dir "$DATA_DIR"   # exits promptly, even with FEs connected
```

---

## Deferred (later checkpoints)

systemd/LaunchAgent installers, macOS signing/notarization, auto-update,
Windows, mobile parity packaging, repository materialization/transfer,
artifact transfer, durable agent coordination.
