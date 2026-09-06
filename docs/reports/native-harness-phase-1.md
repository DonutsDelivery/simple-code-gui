# Native Harness Phase 1 — Foundation Report (rev 3, remaining corrections)

**Commit:** this commit (see git log for exact SHA) — one scoped follow-up on
`bb89f4dba948879ecbec2aa5b5a31b14b3fbac0b`, on branch `feat/native-harness-phase-1`,
worktree `/home/user/Programs/DonutCode-phase1-native-harness`. History retains
`90d6b56` and `bb89f4d`; nothing was reset or force-pushed.

## Gate Status

| Gate | Status |
| --- | --- |
| Standalone Phase 1 suite | ✅ PASS — `node --test scripts/__tests__/hermes-protocol-spike.test.mjs`: 31/31 pass, 0 fail (author-run) |
| Reviewer regressions | ✅ PASS — `reviewer-regressions.test.mjs` (extracted verbatim from the review evidence archive) against the corrected client: 12/12 (4 controls + 8 former failures). Before fixes, on the unchanged client: 4 pass / 8 fail — identical to the reviewer's TAP on Node v22.16.0; this host (Node v22.22.3) shows the same result, no environment-specific differences recorded. |
| Real sandbox checks | ✅ PASS — sentinel-read denial under the shared boundary, in-sandbox env observation (marker visible, canary absent, ns identity), loopback denial with positive control, launcher-failure BLOCKED classification (all author-run on this host, bwrap 0.11.2) |
| Native metadata-only probe | ✅ PASS — gate `PASS`, exit code 0, in `docs/reports/native-probe-evidence-review-fix-2.json` (one run; all four gate checks true) |
| Report published | ✅ PASS — normal (non-force) push to `feat/native-harness-phase-1` |

The application baseline (`npm run test`, 430/435 with 5 pre-existing red at
HEAD) is AUTHOR-REPORTED from the phase-1 session and was NOT rerun in this
correction per scope; it is unchanged from the earlier report.

## Status Vocabulary (used throughout)

- **OBSERVED** — executed and verified on this host in this revision (command
  and artifact named).
- **SOURCE-VERIFIED** — read from installed Hermes source at the pinned commit;
  not executed.
- **NOT RUN / UNVERIFIED** — not executed here; explicitly no claim.

## Reviewer Regressions (A/B/C/D) — resolution

Executed first against the UNCHANGED client, exactly as delivered: **4 pass /
8 fail**, matching the reviewer's TAP byte-for-byte in outcomes (Node v22.22.3
here vs v22.16.0 there; same results, no environment differences recorded).

- **A1 (sync spawn failure returned undefined)** — fixed: `start()` settles
  startup BEFORE any spawn path can fail (`Promise.withResolvers()` settled
  first; sync-throw path rejects with `SpawnError` and marks stopped). The
  spawn-throw path always returns a rejected startup promise; async ENOENT
  behavior and the no-restart rule are preserved (reviewer test 5 now passes).
- **A2 (failed kill fabricated `observed: true`; invalid pid claimed SIGKILL)**
  — fixed: `observed: true` comes ONLY from a real exit event. Kill-send
  results are tracked (`signalLog` entries carry `sent: true/false`); a failed
  send settles UNCONFIRMED after a finite bound with `signal: null` and note
  `SIGKILL send failed`; the invalid-pid branch skips escalation entirely and
  settles UNCONFIRMED with `signal: null`, note `invalid pid; no signal could
  be sent` (reviewer tests 6–7 now pass). Stop remains idempotent, timers are
  cleared on the transitions that make them redundant, and no unrelated
  process is ever signaled.
- **B1 (byte cap advisory; 102,400 bytes retained after stop)** — fixed: the
  fatal-framing path clears the partial-frame buffer immediately, sets a
  fatal-transport flag, and `_onStdoutChunk` returns early for all later
  chunks (retention stays 0 after the cap; reviewer test 10 now passes).
  Behavior stays finite for a peer that keeps writing or ignores SIGTERM.
- **B2 (event-name bytes bypassed the diagnostic budget; counter 80 vs 10,080
  retained)** — fixed: `_pushDiagnostic` accounts the REAL UTF-8 byte length
  of every retained text field (kind and sample each capped at `maxTextSample`
  bytes, byte-safe truncation); count bounds remain a separate limit. The
  budget definition is now explicit: the budget covers retained text bytes
  (kind + sample), not serialized-object overhead (reviewer test 11 passes:
  ≤128 bytes retained under a 128-byte budget).
- **B3 (wrong-version / array-id responses resolved pending requests)** —
  fixed: minimal real wire envelope validated BEFORE pending correlation —
  `jsonrpc === '2.0'`, scalar (string|number) id (no array/object coercion),
  exactly one of result|error, error object shape (`code` integer,
  `message` string). An invalid envelope with a correlating pending id
  REJECTS that pending op with `ProtocolError` (never resolves); with no
  matching id it is counted (`orphanResponses`/`responseEnvelopesRejected`).
  Readiness/event envelope checks are consistent (`type` must be a string)
  (reviewer tests 8–9 now pass, exercised with an ACTUALLY pending id).
- **B4 (arbitrary text such as `api_key=...` retained in snapshot())** —
  fixed per the reviewer's smallest preferred correction: default diagnostics
  are bounded, allowlisted METADATA ONLY. stderr text is never retained
  (line counts + byte totals + bounded, error-shaped metadata records);
  malformed/parse-error samples are byte-length metadata (`len=NB`), not
  bodies; `snapshot()` cannot carry arbitrary text by construction. There is
  no opt-in raw capture. Conversation payload paths are not touched (this is
  diagnostics-only; no TUI-style filtering of message content).
- **C1 (the "descendant" was a sibling)** — fixed: the synthetic gateway now
  has a `spawn-worker` mode where the GATEWAY spawns a bounded worker inside
  the same process boundary; the test records gateway pid + gateway-reported
  worker pid + control pid BEFORE teardown, stops ONLY the owned supervisor
  through the normal path, and proves gateway + worker both ended (owner-chain
  teardown, no manual worker kill) while the unrelated control stays alive and
  is never signaled. The old sibling-kill test is gone.
- **C2 (machine-wide name scan still in the suite)** — fixed: the
  `pgrep -f hermes-gateway-fixture.mjs` test was replaced with owned-identity
  cleanup evidence (owned child observed exit; control alive + never signaled;
  every signal-log entry targets the owned child pid or an honest null-skip).
- **C3 (tautological stand-ins)** — fixed: `classifyIsolationRun()` in
  `sandbox-helper.mjs` is the single verdict classifier (BLOCKED on
  launcher/helper/marker failures, FAIL on wrong-namespace or unexpected
  outcome, PASS only on boundary + differing ns + expected outcome + marker).
  The launcher-failure tests now feed the REAL classifier (BLOCKED, never
  PASS); the malformed-helper, wrong-namespace, and genuine-denial paths are
  tested against the same function. No `&& false` / `|| true` remains.
- **C4 (PARTIAL without nonzero exit; weak PASS condition)** — fixed: the
  probe defines the metadata gate explicitly (verified boundary via the shared
  classifier + native readiness + valid EXPECTED ping `pong === true` +
  CONFIRMED cleanup via observed supervisor exit; uninspectable pid ⇒
  UNCONFIRMED, never confirmed-clean). Exit codes: PASS 0, PARTIAL 4, BLOCKED
  5, crash 1. The gate decision and cleanup-confirmation logic are exercised
  with deterministic synthetic results in the standalone suite BEFORE the
  native run. `session.list` remains optional and is labeled
  OPTIONAL / OPTIONAL-FAILED in the evidence.

## Native probe (one metadata-only run)

- Evidence: `docs/reports/native-probe-evidence-review-fix-2.json`
  (run-specific, separately identified; the earlier
  `native-probe-evidence.json` and `native-probe-evidence-review-fix.json`
  are preserved untouched).
- Result: gate **PASS** (exit 0): boundary PASS via `classifyIsolationRun`
  (observed in-sandbox env: fresh `/probe/home` + `/probe/hermes-home`, allowlist-only env, `net:[…]` differing from host), native `gateway.ready`
  observed from the real installed gateway, valid ping `{pong: true}`,
  CONFIRMED cleanup (owned supervisor exit observed). `session.list` returned
  0 sessions on the throwaway profile (OPTIONAL, not part of the gate).
- Production profile files appear as METADATA OBSERVATION only (size +
  rounded mtime, `metadataSame: true` across the run) — explicitly NOT a
  content-integrity proof.

## Hermes source drift (recorded, not repaired)

The installed Hermes tree changed since the first probe: git HEAD moved from
`7cd91114` (recorded in the phase-1 session's first probe context) to
`10509b069fc0c3ec65dbc5cbbe82cd53068ed06e`, while the pyproject version label
remained **0.20.6**. This probe recorded the full pinned commit AND the
dirty-state observation (`gitDirty: true`) in its evidence file
(SOURCE-VERIFIED, recorded, NOT updated — the tree was not touched to make
tests pass). This drift is not claimed as evidence of a defect.

## Protocol map

SOURCE-VERIFIED from installed `tui_gateway` source at the pinned commit
(rev-2 report content unchanged): newline-delimited JSON-RPC 2.0 over stdio;
`gateway.ready` first event; selected request methods and turn events as
listed in the previous revision's map. Per-method parameter/response schemas
remain NOT RUN (Phase 2 work, pending independent approval).

## Remaining limitations (explicit)

- The probe remains a METADATA-ONLY native session (ready/ping/session.list
  against a throwaway profile). Prompt lifecycle is NOT RUN (Phase 2).
- The suite is STANDALONE (`node --test`); the repo's `npm run test` baseline
  is author-reported from the phase-1 session and NOT RERUN here.
- Author-run claims (suite, sandbox checks, probe) are OBSERVED by the author;
  no independent reviewer has rerun them on this host.

## Phase 2 status

NOT started and NOT authorized by this correction. Phase 2 remains pending
independent review approval; the previous revision's self-authored Phase 2/3
checklist is NOT executed. No production profile hashing/copying/repair was
performed; the usage investigation remains independent.

## Evidence files

- `docs/reports/native-probe-evidence-review-fix-2.json` — this revision's
  single native probe run (gate PASS, exit 0, pinned Hermes commit + dirty
  state).
- Earlier evidence preserved untouched: `native-probe-evidence.json`,
  `native-probe-evidence-review-fix.json`.
- Reviewer regression result (before/after): see the Reviewer Regressions
  section above; the reviewer's harness was executed verbatim from the
  delivered archive (unmodified client first, corrected client after).
