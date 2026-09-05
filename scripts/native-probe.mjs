#!/usr/bin/env node
/**
 * Phase-1 native read-only probe — review-correction revision.
 *
 * The ONLY non-fixture executable this phase launches, and only with the
 * SHARED sandbox configuration from scripts/fixtures/sandbox-helper.mjs (the
 * same boundary the isolation tests certify).
 *
 * What it does (bounded, redacted evidence only):
 *   1. Snapshots production-profile file METADATA (config.yaml/state.db/
 *      auth.json size + rounded mtime). Labeled as metadata observation, NOT
 *      a content-integrity proof.
 *   2. Builds the shared bwrap boundary:
 *        --unshare-net (outbound+loopback denied) --unshare-pid --die-with-parent
 *        --clearenv THEN explicit --setenv of only the allowlisted values
 *        production /home and /home/user/.hermes are NEVER bound
 *        installed Hermes source + venv are read-only-bound (code only)
 *        fresh HOME/HERMES_HOME/TMPDIR come from a temp root
 *   3. FIRST runs the tiny observer INSIDE the same configuration to OBSERVE
 *      the effective environment (HOME/HERMES_HOME/TMPDIR/PWD/env keys,
 *      namespace identities) — the report records observed values, never
 *      parent-side intended values.
 *   4. Spawns ONLY the explicitly named installed gateway:
 *        <venv>/bin/python -m tui_gateway.entry   (Hermes Agent v0.20.6)
 *      No prompts, no provider calls, no session mutations.
 *   5. Waits for native `gateway.ready`; records the payload (redacted).
 *   6. Metadata-only RPCs: `ping`, then `session.list` against the fresh
 *      empty profile (result or error recorded; neither is a probe failure).
 *   7. Stops orderly; cleanup evidence comes from the process tree the
 *      bwrap supervisor owns: the bwrap child exits (observed by this
 *      process), and the namespace is gone — checked via the observer's
 *      recorded netns identity vs. this process's own (different = boundary
 *      existed), and bwrap's exit proves the contained tree died with it.
 *      A machine-wide `pgrep -f` name scan is NOT used as cleanup evidence.
 *   8. Re-checks the metadata fingerprints and writes the corrected evidence
 *      to docs/reports/native-probe-evidence-review-fix.json. The original
 *      evidence file is preserved untouched as the historical artifact.
 *
 * Version metadata is read from installed SOURCE (pyproject.toml version +
 * git HEAD) — labeled SOURCE-VERIFIED; no production-profile CLI is executed
 * outside the boundary.
 *
 * This script is NOT run by the test suite and not imported by app startup.
 * Run manually:  node scripts/native-probe.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { HermesProtocolClient, buildChildEnv } from './hermes-protocol-spike.mjs';
import { buildBwrapArgv, OBSERVER_SCRIPT, writeTempScript, rmTree, makeProbeDirs } from './fixtures/sandbox-helper.mjs';

const execFileP = promisify(execFile);

const HERMES_SRC = '/home/user/.hermes/hermes-agent';
const GATEWAY_ARGV = [path.join(HERMES_SRC, 'venv/bin/python'), '-m', 'tui_gateway.entry'];
const EVIDENCE_PATH = 'docs/reports/native-probe-evidence-review-fix.json';

function fingerprint(p) {
  try {
    const st = fs.statSync(p);
    return { path: p, size: st.size, mtimeMs: Math.round(st.mtimeMs) };
  } catch {
    return { path: p, missing: true };
  }
}

function redact(value) {
  return JSON.parse(JSON.stringify(value, (k, v) => {
    if (typeof v === 'string' && /(token|key|secret|credential|authorization)/i.test(k)) return '[REDACTED]';
    return v;
  }));
}

/** Read installed-source version metadata (no production CLI execution). */
async function sourceVerifiedVersion() {
  const out = { label: 'SOURCE-VERIFIED', pyprojectVersion: null, gitHead: null, gitDescribe: null };
  try {
    const py = fs.readFileSync(path.join(HERMES_SRC, 'pyproject.toml'), 'utf8');
    const m = py.match(/^version\s*=\s*"([^"]+)"/m);
    if (m) out.pyprojectVersion = m[1];
  } catch { /* recorded as null */ }
  try {
    const { stdout } = await execFileP('git', ['-C', HERMES_SRC, 'rev-parse', '--short', 'HEAD'], { timeout: 10_000 });
    out.gitHead = stdout.trim();
  } catch { /* recorded as null */ }
  return out;
}

/** Run the observer inside the SAME sandbox configuration; return parsed JSON. */
async function observeInsideSandbox(dirs, extraEnv = {}) {
  const obsPath = writeTempScript(dirs.root, 'observer.cjs', OBSERVER_SCRIPT);
  const { argv } = buildBwrapArgv({
    home: dirs.home,
    hermesHome: dirs.hermesHome,
    tmp: dirs.tmp,
    hostCwd: dirs.root, // bind the temp root so /probe/observer.cjs exists
    cwdPath: '/probe',
    extraEnv: { DC_PHASE1_OBSERVER_MARKER: `probe-obs-${Date.now()}`, ...extraEnv },
    argv: ['/usr/bin/node', '/probe/observer.cjs', 'probe'],
  });
  const { stdout } = await execFileP(argv[0], argv.slice(1), { timeout: 30_000 });
  return { parsed: JSON.parse(stdout.trim().split('\n').pop()), argvCount: argv.length };
}

/** Host-side namespace identity for the boundary-differs comparison. */
function hostNetns() {
  try { return fs.readlinkSync('/proc/self/ns/net'); } catch { return null; }
}

/** Is the given PID alive (errno-safe; throws only on unexpected errors). */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { alive: false, inspectable: false };
  try {
    process.kill(pid, 0);
    return { alive: true, inspectable: true };
  } catch (e) {
    if (e?.code === 'ESRCH') return { alive: false, inspectable: true };
    if (e?.code === 'EPERM') return { alive: true, inspectable: true };
    return { alive: false, inspectable: false, error: e?.code ?? 'unknown' };
  }
}

async function main() {
  const results = {
    runId: `dc-phase1-probe-${Date.now()}-${process.pid}`,
    startedAt: new Date().toISOString(),
    testedSource: { spike: import.meta.filename, hermesSrc: HERMES_SRC },
    hermesVersion: null,
    sandbox: null,
    observedEnv: null,
    ready: null,
    ping: null,
    sessionList: null,
    stop: null,
    cleanup: null,
    productionProfile: null,
    verdict: null,
    finishedAt: null,
  };

  results.hermesVersion = await sourceVerifiedVersion();

  const prodFp = [
    fingerprint('/home/user/.hermes/config.yaml'),
    fingerprint('/home/user/.hermes/state.db'),
    fingerprint('/home/user/.hermes/auth.json'),
  ];

  const dirs = makeProbeDirs('dc-phase1-probe-');

  // ---- Step A: observe the effective environment INSIDE the shared boundary
  let observed;
  try {
    observed = await observeInsideSandbox(dirs);
    results.observedEnv = {
      label: 'OBSERVED (inside sandbox)',
      home: observed.parsed.home,
      hermesHome: observed.parsed.hermesHome,
      tmpdir: observed.parsed.tmpdir,
      pwd: observed.parsed.pwd,
      envKeys: observed.parsed.envKeys,
      netns: observed.parsed.netns,
      userns: observed.parsed.userns,
      tmpdirReadable: observed.parsed.tmpdirReadable,
    };
  } catch (e) {
    results.observedEnv = { label: 'BLOCKED', error: String(e.message).slice(0, 300) };
  }
  const boundaryEstablished =
    results.observedEnv?.label === 'OBSERVED (inside sandbox)' &&
    results.observedEnv.home === '/probe/home' &&
    results.observedEnv.hermesHome === '/probe/hermes-home' &&
    typeof results.observedEnv.netns === 'string' &&
    results.observedEnv.netns.startsWith('net:') &&
    results.observedEnv.netns !== hostNetns();

  results.sandbox = {
    tool: 'bwrap (shared configuration via sandbox-helper.buildBwrapArgv)',
    flags: ['unshare-net', 'unshare-pid', 'die-with-parent', 'clearenv-then-setenv'],
    productionHomeBound: false,
    hermesSourceBind: `${HERMES_SRC} (read-only)`,
    freshHomes: { home: '/probe/home', hermesHome: '/probe/hermes-home' },
    boundaryEstablished,
  };

  if (!boundaryEstablished) {
    results.verdict = {
      readyObserved: false,
      pingObserved: false,
      cleanup: 'NOT RUN',
      production: 'METADATA-ONLY',
      gate: 'BLOCKED',
      reason: 'sandbox boundary could not be established/observed; no native launch attempted',
    };
    results.finishedAt = new Date().toISOString();
    fs.mkdirSync('docs/reports', { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    process.exitCode = 3; // BLOCKED, per review §4 (nonzero exit for unmet conditions)
    return;
  }

  // ---- Step B: the native gateway inside the SAME boundary
  const { argv: bwrapArgv } = buildBwrapArgv({
    home: dirs.home,
    hermesHome: dirs.hermesHome,
    tmp: dirs.tmp,
    cwdPath: '/probe',
    // The fresh profile must be writable for session.list to open its
    // state.db; the directory is probe-owned and discarded after the run.
    hermesHomeMode: 'rw',
    // The gateway imports from the repo root: bind the source tree at its
    // real absolute path (read-only) and run from it.
    roBinds: [[HERMES_SRC, HERMES_SRC]],
    hostCwd: undefined,
    extraEnv: { PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: HERMES_SRC },
    argv: GATEWAY_ARGV,
  });
  // NOTE: cwd must be the REAL source path (host-side) for `python -m` —
  // bwrap resolves the child cwd inside the sandbox, where HERMES_SRC exists
  // read-only at the same path.
  const client = new HermesProtocolClient({
    command: bwrapArgv,
    env: buildChildEnv({
      home: '/probe/home',
      hermesHome: '/probe/hermes-home',
      tmpDir: '/tmp',
      cwd: '/probe',
      extraEnv: { PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: HERMES_SRC },
    }),
    cwd: HERMES_SRC,
    startupTimeoutMs: 45_000,
    requestTimeoutMs: 15_000,
    stopGraceMs: 4_000,
  });

  // Capture the native gateway.ready payload via the normal event API
  // (initialized local; no prototype monkey-patch, no swallowed exceptions).
  let readyPayload = null;
  client.on('gateway.ready', (params) => { readyPayload = params?.payload ?? null; });

  try {
    await client.start();
    results.ready = {
      observed: true,
      label: 'OBSERVED (native)',
      payloadKeys: Object.keys(readyPayload ?? {}),
      payload: redact(readyPayload),
    };

    const ping = await client.request('ping');
    results.ping = { observed: true, result: redact(ping) };

    try {
      const list = await client.request('session.list', {});
      results.sessionList = {
        observed: true,
        note: 'metadata-only listing against the FRESH empty profile inside the sandbox; NO resume claim',
        sessionCount: Array.isArray(list?.sessions) ? list.sessions.length : null,
        resultShape: Object.keys(list ?? {}),
      };
    } catch (e) {
      results.sessionList = { observed: true, error: String(e.message).slice(0, 200), note: 'recorded; not a probe failure' };
    }
  } catch (e) {
    results.ready = results.ready ?? { observed: false, label: 'BLOCKED', error: String(e.message).slice(0, 300) };
  } finally {
    const stop = await client.stop();
    results.stop = stop;
    // Cleanup evidence from OWNED identities only:
    //   - bwrap (the sandbox supervisor) exit was observed by this process,
    //   - the pid-ns dies with it (--die-with-parent), so the whole gateway
    //     tree ended with it. We do NOT scan machine process lists by name.
    const bwrapPid = client.child?.pid ?? null;
    const bwrapState = bwrapPid == null ? { alive: false, inspectable: false } : pidAlive(bwrapPid);
    results.cleanup = {
      label: stop.observed ? 'OBSERVED (child exit observed)' : 'UNCONFIRMED',
      bwrapSupervisorPid: bwrapPid,
      bwrapSupervisorAliveAfterStop: bwrapState.alive,
      inspectionError: bwrapState.error ?? null,
      pidNamespace: 'dies with bwrap (--unshare-pid --die-with-parent)',
      stopResult: stop,
      method: 'owned-supervisor exit observation; no machine-wide name scan',
    };
  }

  const afterFp = prodFp.map((f) => fingerprint(f.path));
  const metadataSame = JSON.stringify(prodFp) === JSON.stringify(afterFp);
  results.productionProfile = {
    label: 'METADATA OBSERVATION (size + rounded mtime) — not a content-integrity proof',
    before: prodFp,
    after: afterFp,
    metadataSame,
  };

  results.verdict = {
    readyObserved: results.ready?.observed === true,
    pingObserved: results.ping?.observed === true,
    cleanup: results.cleanup.label,
    productionMetadataSame: metadataSame,
    gate: results.ready?.observed === true && results.ping?.observed === true && results.cleanup.label === 'OBSERVED (child exit observed)'
      ? 'PASS'
      : 'PARTIAL',
  };
  results.root = dirs.root;
  results.finishedAt = new Date().toISOString();

  fs.mkdirSync('docs/reports', { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));

  rmTree(dirs.root);
  console.error(`[probe] evidence written to ${EVIDENCE_PATH}; temp tree removed`);
}

main().catch((err) => {
  console.error('probe failed:', err?.message ?? err);
  process.exit(1);
});
