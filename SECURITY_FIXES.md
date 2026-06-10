# Security Audit — simple-code-gui / Claude-Terminal

Audit date: 2026-06-10. Method: full read of the network server, PTY/orchestrator/MCP,
Electron main/preload/IPC, and pairing/token surfaces. Every item cites file:line evidence.

## Threat model & hard constraints (every fix MUST respect these)

This app spawns PTY shells running AI coding CLIs and exposes them to a mobile/LAN client
over an embedded HTTP + WebSocket server with QR pairing. "Type into your own shell" is the
*intended* product; the audit targets **unauthenticated / cross-origin / cross-process
reachability and privilege escalation beyond that**.

- **Localhost / same-machine must keep full access.**
- **LAN access via the mobile app with token/QR auth must keep working.**
- **Plain HTTP/ws must keep working** — no valid TLS certs are assumed. Do **not** force
  HTTPS/HSTS/cert validation or break cleartext LAN.
- **QR pairing must stay intact and user-friendly** — no re-scanning on every connect;
  invisible token refresh is fine. "Stay secure without being a nuisance to users."

## Architecture (as found)

- Active server: `src/main/mobile-server/` (class `MobileServer`), instantiated
  unconditionally at `src/main/index.ts:57`, started at `:191`. Binds **`0.0.0.0:38470`
  over plain HTTP** (`mobile-server/index.ts:79,339`). Single 64-hex bearer token
  (`token-manager.ts`, 256-bit, AES-256-GCM encrypted at rest). Auth on HTTP routes
  (`Authorization: Bearer` or `?token=`) + WS upgrade; a second IP-class layer gates
  write/admin (localhost=admin, LAN=write, other=read).
- `src/main/orchestrator-api.ts` — separate API bound to **`127.0.0.1:19836`**, **no token**
  (IP-allowlist only). Drives session spawn/input/broadcast/cron. The bundled MCP shim
  (`scripts/orchestrator-mcp.mjs`) talks to it and is auto-registered into Claude/Codex/
  Gemini/OpenCode configs.
- `src/server/*` — a **second, weaker, dead** server implementation (no importers anywhere
  in `src/main|renderer|preload`). See L6.
- PTY spawn (`pty-manager.ts:789-847`) uses `pty.spawn(exe, args[])` — **no `shell:true`,
  no string-concat exec anywhere** (verified). Executable always resolved via
  `findExecutable()`, never from request input. The injection surface is *which directory /
  backend / permission-mode* a request may choose, not argv.

---

## CRITICAL

- **C1 — Renderer→host RCE via unvalidated IPC sinks**  ☑ FIXED (batch 1)
  `src/main/app/ipc-handlers/settings.ts:24` (`app:openExternal` → `shell.openExternal(url)`,
  no scheme allowlist) and `:58-67` (`executable:run` → `spawn(executable,[],{cwd,detached})`
  with renderer-supplied path). The renderer displays untrusted model/terminal output, so an
  injected link or string reaching these handlers launches arbitrary URI schemes / arbitrary
  binaries as the desktop user. **Fix:** validate `new URL(url).protocol` against
  `https:/http:/mailto:` before `openExternal`; for `executable:run` only accept a path the
  user actually chose via the main-process file dialog (held in main), not an arbitrary IPC string.

---

## HIGH

- **H1 — Mobile server exposed on 0.0.0.0 by default, no enable gate**  ☑ FIXED (batch 3)
  `mobile-server/index.ts:339` (`listen(port,'0.0.0.0')`), `:79` (`useTls=false`),
  `src/main/index.ts:191` (unconditional `start()`). Every launch silently exposes a
  terminal-driving API to the whole LAN/VPN over cleartext; the bearer token and all PTY I/O
  cross the wire in the clear (passive sniff → token capture → takeover via H2).
  **Fix:** gate `start()` behind an explicit "Enable mobile access" setting (default off);
  when off, don't listen (or bind `127.0.0.1`). Keeps localhost + opt-in LAN/QR; no forced TLS.

- **H2 — LAN token-holder spawns a backend in an arbitrary directory (remote code execution)**  ☑ FIXED (batch 2)
  `mobile-server/routes/pty.ts:42-84` and `routes/terminal.ts:17-55`. `validateProjectPath`
  (`path-validation.ts:134`) only checks the dir *exists* and isn't in a system blocklist — it
  does **not** restrict to configured projects; `terminal.ts` doesn't validate `cwd` at all.
  Combined with a chooseable `backend` and `permissionMode` (can be `bypassPermissions`), a
  token-authenticated LAN client runs an agent that executes arbitrary commands in any directory.
  **Fix:** constrain spawn `cwd` to an allowlist of already-registered workspace project paths
  (reject anything else); apply the same check in `terminal.ts`.

- **H3 — QR = permanent, multi-device, unrevocable full control**  ☑ FIXED (batch 4)
  Model: trust-on-first-use per-device tokens. Phone sends a stable `deviceId` at
  `/verify-handshake` (the single-use nonce IS the pairing proof) and gets its own bearer
  token (`device-registry.ts`), adopted client-side in place of the shared QR token — no
  re-scan, individually revocable. `regenerateToken()` now closes live sockets; `revokeDevice()`
  closes only that device's sockets (sockets tagged with `__authToken`). Desktop QR dialog lists
  paired devices with one-tap Revoke. **Residual (documented):** the legacy shared token stays
  accepted so already-paired/older clients keep working without a re-scan; it is demoted to a
  pairing credential as devices migrate. Closing it fully would force a re-scan (constraint).
  `mobile-server/index.ts:266-278` (QR embeds the raw long-lived token; no desktop approval
  step, no device cap, token never auto-rotates) and `:236-239` (`regenerateToken()` swaps the
  token but never closes `connectedClients`, so "revoke" leaves live WS sessions streaming).
  A screenshot/shoulder-surf/screen-share of the QR yields permanent LAN terminal access.
  **Fix (no re-scan):** bind the existing 5-min nonce to the token — phone exchanges
  (nonce+proof) at `/verify-handshake` for a **per-device** bearer token, with a one-tap
  desktop "Allow device?" prompt; make `regenerateToken()` close all sockets; enable per-device revoke.

- **H4 — Renderer sandbox not enabled**  ☑ FIXED (batch 1)
  `src/main/app/window.ts:27-31` sets `contextIsolation:true`/`nodeIntegration:false` (good) but
  omits `sandbox:true`. Without the OS renderer sandbox, a renderer exploit is uncontained and
  pivots straight to the C1 IPC sinks. **Fix:** set `sandbox:true`; verify the wasm/whisper
  worker still loads (preload already uses only `contextBridge`/`ipcRenderer`/`webUtils`).

---

## MEDIUM

- **M1 — Arbitrary file metadata read & exfiltration over the LAN**  ☑ FIXED (batch 2)
  `mobile-server/routes/files.ts:126-158` (`/api/files/info`) and `:161-188` (`/api/files/send`)
  validate only against the system blocklist with **no `allowedBasePaths`**, unlike `/list` and
  `/download`. A token-holding LAN client can stat and exfiltrate any readable file outside
  blocked system roots — `~/.ssh/id_rsa`, `~/.aws/credentials`, etc. **Fix:** require & enforce a
  `basePath` (allowedBasePaths = registered projects) on `/info` and `/send`.

- **M2 — Unauthenticated local orchestrator API (confused-deputy / timed injection)**  ☑ FIXED (batch 5)
  Per-launch secret provisioned to `~/.claude-terminal/orchestrator-secret-<port>` (0600), required
  via `x-orchestrator-secret` header on every orchestrator request (constant-time compare);
  the MCP shim reads the same file. Spawn `cwd` now validated against the registered-project
  allowlist (`validateWithinProjectRoots`, 403 on escape). Cron jobs capped at 25.
  `src/main/orchestrator-api.ts:43-52,167-344` authorizes by loopback IP only, no token, and does
  **no `cwd` validation** on spawn. Any local process (or other local UID) can spawn/drive/close
  sessions; `broadcast_input`+`cron_add` (`scripts/orchestrator-mcp.mjs:355-372,23-45`) schedule
  attacker text (with submit `\r`) into *every* session persistently. Port is fixed/discoverable
  (19836-19840). **Fix:** require a per-launch secret (0600 file/env shared with the MCP shim) on
  orchestrator requests; apply H2's project-allowlist to orchestrator `cwd`; cap cron jobs.

- **M3 — Token transported in URL query strings**  ☑ FIXED (batch 5)
  Dropped the `?token=` leak from the WS upgrade log (`websocket-manager.ts` no longer logs
  `req.url`). WS auth already accepts `Sec-WebSocket-Protocol`/header tokens. The deep-link
  `url` field is kept intentionally — it is the pairing channel (equivalent trust to the QR),
  and `?token=` is retained only for the unavoidable Android file-download `window.open` case.
  WS stream `...stream?token=${token}` (`renderer/api/http-backend/pty-websocket.ts:37`), accepted
  server-side for `/ws`, static, `/api/files/*` (`mobile-server/middleware.ts:111-142`), and the
  convenience `url:'claude-terminal://…?token=<token>'` (`index.ts:282`). Query strings leak to
  logs/proxy/history; cleartext on LAN. **Fix:** prefer the already-supported
  `Sec-WebSocket-Protocol` token + `Authorization` header; drop the token from the `url` field;
  keep `?token=` only for the unavoidable Android file-download `window.open` case.

- **M4 — Non-constant-time token comparison**  ☑ FIXED (batch 5)
  Added `tokensEqual()` (`utils.ts`) using `crypto.timingSafeEqual` over equal-length buffers
  (length-mismatch short-circuits to false). All `===`/`!==` token comparisons in
  `middleware.ts`, `index.ts`, and `websocket-manager.ts` now route through it.
  `mobile-server/middleware.ts:113,122,130,142,155`, `index.ts:112`, `websocket-manager.ts:52`
  use plain `===`/`!==`. Heavily mitigated by the 5/15-min rate limiter, but trivial to fix.
  **Fix:** shared helper using `crypto.timingSafeEqual` over fixed-length buffers.

- **M5 — Over-broad CORS with credentials**  ☑ FIXED (batch 5)
  Set `credentials: false` in the CORS config — token auth uses Bearer header / query token /
  `Sec-WebSocket-Protocol`, never cross-origin cookies, so credentialed CORS only widened the
  origin-reflection attack surface. Origin allowlist (RFC1918 / Tailscale / `*.ts.net`) unchanged.
  `mobile-server/middleware.ts:21-71` allows any RFC1918 / `100.64/10` / `*.ts.net` origin (and
  `!origin`) with `credentials:true`; dead `src/server/app.ts:127-132` is worse (`origin:'*'`+creds).
  Auth is token-based, not cookie-based. **Fix:** set `credentials:false` (token auth doesn't need
  it) and/or reflect only known app origins.

- **M6 — `will-navigate` allowlist bypassable**  ☑ FIXED (batch 5)
  `will-navigate` now parses the URL and compares `parsed.hostname` *exactly* against
  `localhost`/`127.0.0.1` (file: always allowed), `preventDefault()` otherwise — so
  `localhost.attacker.com` / `localhost@attacker.com` no longer match.
  `src/main/app/window.ts:47-50` uses `url.startsWith('http://localhost')`, which matches
  `http://localhost.attacker.com` / `http://localhost@attacker.com`. Navigating the top frame to an
  attacker origin keeps the privileged preload attached → C1 sinks. **Fix:** compare
  `new URL(url).hostname` exactly against `localhost`/`127.0.0.1` (+ the LAN host actually used).

- **M7 — CSP allows `unsafe-eval` + wildcard connect-src**  ☑ FIXED (batch 5, partial)
  Packaged builds now drop plain `'unsafe-eval'` (keep `'wasm-unsafe-eval'` for the whisper/wasm
  worker); dev keeps `'unsafe-eval'` for the Vite toolchain. `connect-src` is intentionally left
  broad: CSP cannot express RFC1918 CIDRs, and the remote-host + plain-HTTP-LAN constraints require
  wildcard `http:`/`ws:` to keep working — narrowing it would break LAN media/streaming.
  `src/main/app/app-setup.ts:35-44`: `script-src 'unsafe-eval'` and `connect-src http: https: ws:
  wss:` (any host). Weakens XSS containment and allows exfil anywhere. **Fix:** drop plain
  `unsafe-eval` (keep `wasm-unsafe-eval`); narrow `http:`/`ws:` connect to localhost + RFC1918
  ranges the app targets — preserves plain-HTTP LAN.

- **M8 — Auto-updater unsigned / no publisher pinning**  ◩ DEFERRED — needs infra
  Code signing requires a Windows code-signing certificate + Apple notarization credentials wired
  into the CI/release pipeline (`afterSign`/`certificateFile`); not resolvable from app source in
  this batch. Tracked for the release-infra workstream. Trust root stays the HTTPS GitHub feed
  until signing lands.
  `src/main/updater.ts:1-81` (+ `autoInstallOnAppQuit=true`), `electron-builder.yml:14-17` (GitHub
  HTTPS feed, but no Windows `certificateFile`/`afterSign`/notarization, Linux targets unsigned;
  repo name mismatch `simple-claude-gui` vs `simple-code-gui` — verify the feed). Trust root is
  only "whoever controls the GitHub release." **Fix:** add code signing so electron-updater's
  signature check has a trust root; keep HTTPS GitHub feed; consider gating install on user action.

- **M9 — Remote extension registry trusted without integrity**  ◩ DEFERRED — needs infra
  Manifest pinning/signing requires a signing-key + publishing process (key custody, a signed
  manifest format, client-side verification key) that doesn't exist yet — a design+infra task, not
  an in-app code change. Mitigated meanwhile by existing `shell:false` install + npm-name/GitHub-URL
  validation (remote entries can't yet run arbitrary install commands). Tracked separately.
  `src/main/extension-manager/registry.ts:70-153` plain-`fetch`es a GitHub raw URL
  (`constants.ts:6`) and merges remote `npm`/`repo` entries into the installable catalog with no
  signature/hash pinning. Installs themselves use `shell:false` + name validation (good), but a
  MITM/compromised registry steers users to a name-valid malicious package wired in as an MCP
  server. **Fix:** pin/sign the registry manifest, verify a hash before merge, treat remote
  `npm`/`repo` as untrusted suggestions requiring explicit confirmation of the exact package.

- **M10 — `X-Forwarded-For` trusted from loopback (IP-class spoof)**  ☑ FIXED (batch 5)
  XFF is now honored only when `CT_TRUST_PROXY === '1'` is explicitly set (and the direct socket is
  still localhost); otherwise the socket address is always used. No reverse-proxy mode → no spoof.
  `src/main/mobile-security/ip-classification.ts:73-84` honors `X-Forwarded-For` whenever the
  socket is localhost; since the server binds `0.0.0.0`, any local process connecting via loopback
  can forge its IP class (rate-limit/audit evasion; downgrade-only). **Fix:** only trust XFF when an
  explicit reverse-proxy mode is configured; otherwise always use the socket address.

- **M11 — Static assets served before auth**  ☑ FIXED (batch 5)
  Added a gate ahead of `express.static`: localhost serves freely; non-localhost must present a
  valid token via `?token=` (first load) — which sets an HttpOnly SameSite=Strict `ct_token` cookie
  (no Secure flag, plain HTTP) so subsequent asset requests authenticate — else 401. The Capacitor
  app loads bundled assets over `capacitor://` and never hits this path, so onboarding is unaffected.
  `mobile-server/middleware.ts:119-135` mounts static serving before auth and `next()`s for any
  `isStaticPath` (`utils.ts:48-59`) even with no token → unauthenticated LAN retrieval of the
  renderer bundle (version/internals leak). **Fix:** require a valid token for assets, or bind
  static serving to localhost.

- **M12 — SSRF via `extensions:fetchFromUrl`**  ☑ FIXED (batch 5)
  Added `assertSafePublicUrl()` (requires `https://`; rejects localhost/loopback/`0.0.0.0`/`::1` and
  IPv4 literals in private ranges 10/127/192.168/172.16-31/169.254/100.64-127), called in both
  `extensions:fetchFromUrl` and `extensions:addCustomUrl`. DNS-rebinding documented as residual.
  `src/main/ipc/extension-handlers.ts:14-16` fetches an arbitrary renderer-supplied URL from the
  main process → can hit localhost/LAN services. **Fix:** allowlist trusted registry hosts (https
  only); reject loopback/RFC1918 targets.

---

## LOW

- **L1 — Route handlers leak raw error text**  ☑ FIXED (batch 5) `mobile-server/routes/*.ts` catch blocks return
  `String(error)`/`err.message` (absolute paths, internals) to clients. **Fixed:** all 500-level
  responses now return `error: 'Internal server error'`; server-side `log(..., { error })` detail
  kept. Controlled 400-level validation text (e.g. `pathValidation.error`) left intact.
- **L2 — OCR MCP arbitrary local file read**  ☑ FIXED (batch 5) `mcp-servers/ocr/server.mjs:36-41` passes
  caller `imagePath` to Tesseract.js (in-process, no shell) with no base-dir constraint → arbitrary
  image read for MCP clients. **Fixed:** `resolveImagePath()` enforces null-byte check, image
  extension allowlist, `realpathSync` containment within `OCR_BASE` (`CT_OCR_BASE` or `homedir()`),
  and isFile check before OCR.
- **L3 — Weak DoS limits**  ☑ FIXED (batch 5) Per-IP-only rate limits; no global connection/PTY cap in the active
  server (`mobile-server`); each `/api/pty/spawn` (10/min/IP) starts a real process. **Fixed:**
  global `MAX_WS_CONNECTIONS = 64` cap (rejects WS upgrade with 503 once exceeded, summed across
  clients + pty streams) and `MAX_MOBILE_PTYS = 16` cap (429 on `/api/pty/spawn` once exceeded).
- **L4 — Mobile token stored in plaintext Preferences**  ◩ DEFERRED — needs infra
  `renderer/components/ConnectionScreen/storage.ts:24-32` (desktop side correctly AES-256-GCM +
  0600). Rooted-device/backup risk. **Deferred:** requires adding a Capacitor Keychain/Keystore
  secure-storage plugin + a native Android/iOS rebuild — outside this source-only batch. Residual
  risk is bounded to a rooted/backed-up device; tracked for the mobile-native workstream.
- **L5 — No-op symlink check**  ☑ FIXED (batch 5) `app/ipc-handlers/window-handlers.ts:29-31`
  `resolve(resolved,'.claude').startsWith(resolved)` is a tautology — doesn't catch symlink escape.
  **Fixed:** `validateProjectPath()` now `realpathSync`-resolves an existing target and verifies the
  real path is within an allowed root (home / `/tmp` / `/var/tmp`), throwing on escape.
- **L6 — Dead, weaker legacy server tree**  ☑ FIXED (batch 5) `src/server/*` (`origin:'*'`+`credentials:true`,
  token-in-`?token=`, `host:'0.0.0.0'` default) had **no importers** in production. **Fixed:** the
  entire `src/server/` tree was deleted (zero importers confirmed repo-wide; git-tracked so
  recoverable). Shrinks attack surface and prevents accidental future wiring.

---

## Verified-good (don't regress these)

- 256-bit `crypto.randomBytes` tokens / 128-bit nonces / `getRandomValues`; **no `Math.random()`
  in any security path**. Desktop token at rest: AES-256-GCM, machine-bound key, `chmod 0600`.
- No `shell:true` / string-concat exec anywhere; PTY uses `spawn(exe, args[])` with a resolved
  executable. Extension installs `shell:false` + npm-name/GitHub-URL validation.
- Electron: `contextIsolation:true`, `nodeIntegration:false`, no `@electron/remote`, production
  loads `file://` (dev `localhost:5173` gated on `NODE_ENV`), `setWindowOpenHandler` denies all,
  DevTools behind debug flag, a CSP is present (just too loose — M7). `claudemd`/`commands` IPC
  handlers validate paths against home + reject null bytes/traversal.
- Orchestrator API correctly bound to `127.0.0.1` and rejects non-loopback (its weakness is *local*
  lack of auth — M2). Nonce single-use + TTL + TOFU fingerprint pinning w/ MITM warning.

---

## Suggested fix order

1. **C1 + H4** — Electron IPC validation + `sandbox:true`. Small, self-contained, closes the
   renderer→host RCE path. Low breakage risk.
2. **H2 + M1** — project-path allowlist on spawn `cwd` and on file `/info`,`/send`. Closes the two
   network-reachable RCE/exfil holes. Needs care not to break legitimate project spawns.
3. **H1** — add the "Enable mobile access" setting (default off). Biggest exposure reduction;
   verify localhost + opt-in LAN/QR still work.
4. **H3** — per-device token + approval + working revoke. Largest change; touches the QR flow, so
   do last among the highs and test pairing end-to-end.
5. **M2-M12 / L1-L6** — batch the hardening (timing-safe compare, CORS creds, CSP narrowing,
   query-string tokens, XFF, static-auth, updater signing, registry/SSRF, legacy-server deletion).

Status legend: ☐ open · ◩ partial · ☑ done.
