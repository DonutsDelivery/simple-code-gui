# Native Harness Phase 1 — Foundation Report (Review-Correction Revision)

**Commit:** this commit (see git log for exact SHA) — one scoped review-correction
commit on top of `90d6b56498501e9ee4c6211936ce9ead3e17202d`, on branch
`feat/native-harness-phase-1`, worktree `/home/user/Programs/DonutCode-phase1-native-harness`.

## Gate Status

| Gate | Status |
| --- | --- |
| Full suite green | ✅ PASS — `node --test scripts/__tests__/hermes-protocol-spike.test.mjs`: 27/27 pass, 0 fail |
| Synthetic fixture isolation | ✅ PASS — fixture isolation suite included in the 27 |
| Native metadata-only probe | ✅ PASS — gate `PASS` in `docs/reports/native-probe-evidence-review-fix.json` (all conditions verified in-script; no unverified claims) |
| Report published | ✅ PASS — this report; normal (non-force) push to `feat/native-harness-phase-1` |
| Report format | ✅ PASS — Gate Status table + Phase 2/3 checklist, per review §5 |

No phase gate relies on an unverified claim: every PASS above is backed by a
command that ran in this worktree and by an evidence file written by the run.

## What Changed (Review Corrections R1–R4)

- **R1 — Truthful stop/lifecycle state (`scripts/hermes-protocol-spike.mjs`)**
  - `stop()` now reports completion-path truthfully: `result.observed === true`
    iff child exit was observed; `UNCONFIRMED` fallback result is returned
    instead of a fabricated value when observation races the bounded wait.
  - Stop is idempotent (single shared promise; second caller gets the first
    stop's result) and bounded: SIGTERM → `graceMs` → SIGKILL (child-pid only,
    `kill()` on the exact child object; no process-group or other-process signal).
  - All stop timers are cleared exactly once and only on the transition that
    makes them redundant (`_stopKillTimer`, `_stopUnconfirmedTimer`, cleanup on
    observed exit, exit-time and unconfirmed-path hygiene; no unconditional
    `clearTimeout` on a stale id, no stray unref).
  - Child stdin `error` and unexpected parent-side stdio `error` are captured,
    recorded, and surfaced; pending requests fail fast with `StdioWriteError`
    (exact cause), and pending NEVER silently settle as success.
  - Startup spawn failure (ENOENT etc.) rejects deterministically with
    `StartupSpawnError` (exact `spawnSync`-verified cause, no fabricated
    `gateway.ready`).
  - New failing-then-fixed regression tests: stdin-closed-live child
    (`StdioWriteError`, no restart), nonexistent-executable startup
    (`StartupSpawnError`, no phantom ready), stop idempotence + truthfulness
    (including invalid-pid case: recorded `invalid-pid`, never signaled).
- **R2 — Shared sandbox boundary (`scripts/fixtures/sandbox-helper.mjs`)**
  - One `buildBwrapArgv()` builder: `--unshare-net --unshare-pid
    --die-with-parent`, production `$HOME` never bound, installed source
    read-only, fresh `HOME`/`HERMES_HOME` from a probe-owned temp root,
    `--clearenv` followed ONLY by explicit `--setenv` of the allowlist
    (order preserved; the original code's set-before-clear inversion removed).
  - Corrected bwrap ordering/flags discovered by live debugging on this host:
    `/proc` mount after binds (else `/proc/self/ns/*` unreadable on bwrap 0.11.2),
    `--symlink /usr/lib /lib64` + `/lib` (Arch linker path), executable path
    `/usr/bin/node` (host `node` is a shim outside the sandbox).
  - Both the isolation tests and the native probe consume the SAME builder, so
    the tested boundary is the shipped boundary.
- **R3 — Isolation/cleanup tests assert the real property**
  - Namespace identity observed INSIDE the sandbox (`/proc/self/ns/net`
    readlink via observer; differs from host; marker via `--setenv`).
  - Known-path sentinel read denial asserted against the SAME shared boundary
    (positive control outside; DENIED inside; launcher failure = FAIL, not
    network-denial PASS).
  - Machine-wide `pgrep -f tui_gateway.entry` name-scan removed from cleanup
    evidence. Ownership checks use namespace identity + owned PIDs; owned
    child and owned descendant exit observed; an unrelated bounded control
    process is verified alive, never signaled; launcher-failure test keeps the
    boundary honest.
  - No always-true assertions; no `Object.prototype`/prototype monkey-patching;
    no swallowed exceptions in test code.
- **R4 — Client safety hardening (`scripts/hermes-protocol-spike.mjs`)**
  - Diagnostics bounded by count AND bytes (`stderrBounded`, `protocolErrorsBounded`,
    `unknownEventsBounded`, `droppedStderrLines`, `droppedProtocolErrors`,
    `droppedUnknownEvents`); oversized frames fail explicitly
    (`maxLineBytes`); no unbounded buffering.
  - Sensitive content scrubbed at capture: key-based `[REDACTED]`, secret-shaped
    string/value patterns scrubbed everywhere (stderr lines, malformed samples,
    ready payload); `TOPSECRET` sentinel asserted absent from diagnostics.
  - Response envelopes validated (`jsonrpc`/`id`/`result|error`); malformed
    envelope rejected, recorded, never resolves a request.
  - UTF-8 split boundary fixed at REAL multibyte cut points in the fixture
    (byte-offset verified via buffer scan; the previous constant offsets were
    wrong and only accidentally inside a 2-byte sequence).
  - Request journal in the fixture (`fixture.journal`) allows exact-count
    assertions (single-send on timeout verified; no re-send storm).
  - Monkey-patch removed: ready payload is captured through the client's normal
    event API; no `__proto__`/prototype tampering; no silent exception
    swallowing in tests.

## Honest Status of Remaining Limitations

- `native-probe-evidence-review-fix.json` is evidence of a **metadata-only
  native session** (ready/ping/session.list against a fresh empty profile).
  It is NOT an end-to-end prompt verification. Prompt lifecycle is Phase 2.
- `productionProfile.metadataSame === true` proves metadata (size + rounded
  mtime) of production config/state/auth was unchanged across the run. It is
  explicitly labeled METADATA OBSERVATION — not a content-integrity proof.
- The installed-gateway startup banner on stderr, if any, is captured bounded
  and scrubbed; it is not treated as protocol evidence.
- Protocol map below is SOURCE-VERIFIED (read from installed source); runtime
  behavior of mapped methods beyond ping/session.list is Phase 2 work.

## SOURCE-VERIFIED Protocol Map (installed `tui_gateway` @ git 10509b069f, v0.20.6)

Wire format (verified in `tui_gateway/server.py` `_event_frame`, `entry.py`):
newline-delimited JSON-RPC 2.0 over stdio; responses correlate by numeric `id`;
notifications/events use `method:"event"` with `params.type` + `params.session_id`
+ optional `params.payload`; first startup event is `gateway.ready`
(payload: `skin`, `change_events`, `replay_epoch`).

Selected request methods (all verified as registered `@method(...)` handlers):
- Lifecycle: `ping`, `session.create` (params: `cols`, `messages`, `title`,
  `parent_session_id`, `cwd`, `source`, `profile`, `model`, `provider`),
  `session.resume` (`session_id` required, `cols`, `profile`, `defer_history`,
  `omit_messages`), `session.close`, `session.interrupt`
  (optional `expected_hosted_task_id` guard), `session.list`
- Conversation: `prompt.submit` (`session_id`, `text`, `display_kind`),
  `session.history` (persisted rows with `include_row_ids`),
  `session.usage`, `session.steer`, `subagent.interrupt`/`steer`
- Approvals: `approval.respond` (`choice` default `deny`, `all`, `request_id`;
  resolves via `resolve_gateway_approval`), `sudo.respond`, `secret.respond`
- Config/profiles: `config.get`/`config.set`/`config.show` (profile-scoped via
  `_profile_scoped`), `profiles.list` (`include_sessions`), `profiles.create`
- Tools: `tools.list`, `toolsets.list`, `shell.exec`, `process.list`/`stop`/`kill`
- Session identity: durable `session_key` format
  `YYYYMMDD_HHMMSS_<6-hex>` (`_new_session_key`); UI session ids are 8-hex;
  state.db is per-profile at `$HERMES_HOME/state.db`
- Turn events (emitted): `turn.start`, `message.start`, `message.delta`,
  `message.complete`, `reasoning.delta`, `tool.start`, `tool.complete`,
  `approval.request` (`_emit_approval_request`), `session.usage`,
  `usage.bars`, `status.update`

Full parameter/response schemas are Phase 2 (schema extraction per handler);
the map above is identity-level, sufficient for the Phase-2 plan.

## Evidence Files

- `docs/reports/native-probe-evidence-review-fix.json` — corrected-run native
  probe evidence (version, observed in-sandbox env, ready payload keys, ping,
  session.list count, stop truthfulness, cleanup via owned-supervisor exit,
  production metadata before/after). Original `native-probe-evidence.json`
  preserved untouched as the historical first-run artifact.
- Test run: `node --test scripts/__tests__/hermes-protocol-spike.test.mjs` →
  27/27 pass (command quoted above; re-runnable exactly).

## Phase 2 / Phase 3 Checklist (unchanged scope, carried forward)

Phase 2 (unblocked by this revision):
1. Extract per-method request/response schemas from installed source
   (`methods_*.py`) into a fixture-validated contract file.
2. Extend the synthetic fixture with approval-flow + turn-event sequences;
   add client-side event-correlation tests.
3. Implement prompt lifecycle over the native gateway inside the SAME shared
   boundary (session.create → prompt.submit → message.* events → complete),
   still read-only, still no provider calls (model/provider must be
   offline/stub — Phase 2 gate decision).
4. Interrupt/approval paths with deterministic fixtures first; native only
   after fixture parity.

Phase 3 (unchanged): renderer integration behind the existing
`session-runtime-registry`/`environment-runtime` seams; end-to-end gesture
tests per repo policy; no production-profile writes.

Explicitly out of scope (unchanged): production DB writes, credential access,
provider/model configuration changes, Phase-2 implementation.
