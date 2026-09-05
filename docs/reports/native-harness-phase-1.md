# Native Harness Phase 1 — Foundation Report

**Branch:** `feat/native-harness-phase-1` (isolated worktree from verified base `dc5af18` = published `feat/donutcode-unified-runtime` tip)
**Status:** Phase 1 complete. Stopped for review per plan §8 (no `dev-plan`/`acceptance` execution).
**Date:** 2026-09-06 (Europe/Copenhagen)

---

## 1. Scope executed (plan §4–§8)

Executed exactly: baseline (§4), seam inspection (§5), synthetic fixture + protocol
spike + tests + isolation checks (§6), installed-interface inspection and native
read-only probe inside an isolated boundary (§7), report + scoped commit (§8).
Not executed: integration phases 2–3, any `dev-plan`/`acceptance` tasks, any
changes to app runtime code.

## 2. Environment baseline (as measured)

| Item | Value |
| --- | --- |
| Repo HEAD | `dc5af18472eb20969fa91d1aebca9ad320e0efc8` ("docs: record reconnect-loop closure") |
| Primary tree branch | `feat/donutcode-unified-runtime` (12 modified, 12 untracked — verified shutdown-fix WIP, untouched) |
| New worktree | `/home/user/Programs/DonutCode-phase1-native-harness` |
| Node / npm | v22.22.3 / 10.9.8 |
| Hermes executable | `/home/user/.local/bin/hermes` → venv shim → **Hermes Agent v0.20.6 (2026.8.27), upstream 7cd91114**, git install at `/home/user/.hermes/hermes-agent` (venv python 3.12) |
| Sandboxing | `bwrap` ✓ (works, incl. `--unshare-net`), `unshare --user --map-root-user --net` ✓ (userns enabled), `firejail` absent |
| `npm run build` | **pass** (exit 0) in the phase worktree |
| `npm run test` (baseline, HEAD) | **3 files / 5 tests fail at HEAD in BOTH trees** (identical failures; pre-existing, not introduced by this phase): `orchestrator-agent-signals.test.ts` (suite import error: `app.isPackaged` undefined via `debug-api.ts:24`), `pty-manager.test.ts` (3 signal-dedup assertions), `workspace-authority.test.ts` (2 merge assertions). 71/74 files, 430/435 tests pass. |
| Tracker (`bd`) | `bd ready` works; `bd doctor` reports **legacy DB (no repo fingerprint, unreadable version) — daemon will fail**. Recorded as a broken-workflow finding; not repaired (out of scope). |

## 3. Installed Hermes native interface (§7 source inspection)

- Launch chain (source-verified): `hermes --tui` → `hermes_cli.main._launch_tui`
  → Ink TUI `ui-tui/dist/entry.js` (Node) → spawns **`python -m tui_gateway.entry`**
  with stdio pipes (entry.js line 90004).
- Wire protocol: newline-delimited JSON-RPC 2.0 over stdio. First outbound
  event: `gateway.ready` `{skin, change_events, replay_epoch}`.
- Dispatch: `tui_gateway/server.py` `dispatch()` → `_methods` registry
  (`@method("...")` decorators across `methods_*.py`); long handlers on a pool.
- ~170 request methods registered (session.*, prompt.submit, config.*,
  tools.list, terminal.*, billing.*, groups.*, …). `ping` → `{"pong": true}`.
- Env contract: `HERMES_HOME` selects the profile home (falls back to
  platform-native `~/.hermes`); missing `config.yaml` tolerated (loads `{}`).

## 4. Phase-1 capability matrix

| Capability | Status | Evidence |
| --- | --- | --- |
| Standalone stdio JSON-RPC client (line-delimited) | **Working** | `scripts/hermes-protocol-spike.mjs` (stdlib-only) |
| Synthetic fixture emulating the gateway wire format | **Working** | `scripts/fixtures/hermes-gateway-fixture.mjs` (labeled SYNTHETIC; modes incl. malformed, no-ready, split-utf8, early-exit) |
| Fixture test suite (no model-provider calls) | **13/13 pass** | `node --test scripts/__tests__/hermes-protocol-spike.test.mjs` |
| Launch installed gateway out-of-app, isolated | **Working** | `scripts/native-probe.mjs`: `bwrap` `--unshare-net --unshare-pid --die-with-parent`, **production `$HOME` NOT bound**, source tree ro-bind, fresh `HERMES_HOME` profile |
| Native `gateway.ready` observed | **Yes** | probe evidence JSON (skin/change_events/replay_epoch payload captured) |
| Native `ping` | **Yes** | `{"pong": true}` — no `synthetic` label ⇒ genuine installed gateway |
| Native `session.list` (metadata-only, fresh profile) | **Yes** | 0 sessions on the sandbox profile; result shape `{sessions}` |
| Profile isolation (sentinel read denial) | **Pass** | fixture child sees allowlisted env only; sentinel `DC_PHASE1_PARENT_SENTINEL` invisible |
| Scoped network denial | **Pass** | loopback connect refused inside netns; same connect succeeds outside |
| Production-profile integrity | **Pass** | `~/.hermes/{config.yaml,state.db,auth.json}` fingerprints (size+mtime) identical before/after probe, `unchanged: true` |
| Cleanup | **Pass** | probe gateway died with its PID namespace; scoped leftover check empty (`treeClean: true`) |
| Redaction | **Applied** | probe JSON output passes values through `[REDACTED]` substitution; no secrets in repo |

## 5. Findings — clearly broken or suspicious

1. **Baseline suite fails at HEAD in both trees** (5 tests / 1 suite import) —
   pre-existing; the phase worktree reproduces the primary tree exactly. The
   published plan's "canonical `npm run test` blocked by Vitest CJS/ESM issue"
   is **resolved** (suite runs); the remaining failures are ordinary red tests.
2. **Leaked `NODE_ENV=production` in the shared shell** made `npm ci` omit
   devDependencies (vitest missing → "command not found"). Environment defect,
   not app defect; workaround `--include=dev` documented. Per plan this stays
   app-side-observation only.
3. **`bd doctor` legacy-DB failure** — Beads daemon cannot start on this repo's
   tracker DB. Blocking the tracker workflow (§4 requirement "update/close tasks
   in Beads") until repaired by a separate task.
4. First probe run misattributed the **user's own live Hermes gateways** as
   "leftover" children (matched by binary name). Fixed to scope by probe tree
   path; user gateways never touched. Lesson encoded in `native-probe.mjs`.

## 6. Reproduction commands

```bash
cd /home/user/Programs/DonutCode-phase1-native-harness
node --test scripts/__tests__/hermes-protocol-spike.test.mjs   # 13/13 pass
node scripts/native-probe.mjs                                   # isolated native probe
npm run build                                                   # pass
export NODE_ENV=test && npm run test                            # baseline: 430/435 pass (pre-existing 5 red)
```

## 7. Phase-owned files (this commit)

- `scripts/hermes-protocol-spike.mjs` — stdio JSON-RPC client spike
- `scripts/fixtures/hermes-gateway-fixture.mjs` — synthetic gateway fixture
- `scripts/__tests__/hermes-protocol-spike.test.mjs` — fixture test suite
- `scripts/native-probe.mjs` — sandboxed native read-only probe
- `docs/reports/native-harness-phase-1.md` — this report
- `docs/reports/native-probe-evidence.json` — probe evidence (redacted)
