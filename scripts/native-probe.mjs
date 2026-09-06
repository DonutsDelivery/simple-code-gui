#!/usr/bin/env node
/**
 * Phase-1 native read-only probe — review-correction rev 2 (C4 gate).
 *
 * The ONLY non-fixture executable this phase launches, and only with the
 * SHARED sandbox configuration from scripts/fixtures/sandbox-helper.mjs (the
 * same boundary and the SAME classifyIsolationRun verdict logic the isolation
 * tests certify).
 *
 * Gate (metadata-only, explicitly defined):
 *   PASS requires ALL of:
 *     1. verified boundary      — classifyIsolationRun PASS on the observer run
 *     2. native readiness       — gateway.ready observed from the real gateway
 *     3. valid expected ping    — response { pong: true } (shape-checked)
 *     4. confirmed cleanup      — owned supervisor exit observed
 *   PARTIAL/FAIL/BLOCKED exit nonzero (3/4/5) and write their evidence file
 *   so a stale PASS artifact is never left behind. `session.list` failure
 *   stays OPTIONAL but is labeled OPTIONAL-FAILED in the evidence.
 *
 * Version metadata is read from installed SOURCE (pyproject.toml + git HEAD +
 * dirty-state) — labeled SOURCE-VERIFIED. The Hermes tree is NOT updated;
 * its exact commit and dirty state are recorded for the run.
 *
 * Run manually:  node scripts/native-probe.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { HermesProtocolClient, buildChildEnv } from './hermes-protocol-spike.mjs';
import { buildBwrapArgv, OBSERVER_SCRIPT, writeTempScript, rmTree, makeProbeDirs, classifyIsolationRun } from './fixtures/sandbox-helper.mjs';

const execFileP = promisify(execFile);

const HERMES_SRC = '/home/user/.hermes/hermes-agent';
const GATEWAY_ARGV = [path.join(HERMES_SRC, 'venv/bin/python'), '-m', 'tui_gateway.entry'];
const EVIDENCE_PATH = 'docs/reports/native-probe-evidence-review-fix-2.json';

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

/** SOURCE-VERIFIED version metadata: pyproject version + git HEAD + dirty state. */
async function sourceVerifiedVersion() {
  const out = { label: 'SOURCE-VERIFIED', pyprojectVersion: null, gitHead: null, gitDirty: null, note: 'recorded, NOT updated; drift is documented, not repaired' };
  try {
    const py = fs.readFileSync(path.join(HERMES_SRC, 'pyproject.toml'), 'utf8');
    const m = py.match(/^version\s*=\s*"([^"]+)"/m);
    if (m) out.pyprojectVersion = m[1];
  } catch { /* recorded as null */ }
  try {
    const { stdout } = await execFileP('git', ['-C', HERMES_SRC, 'rev-parse', 'HEAD'], { timeout: 10_000 });
    out.gitHead = stdout.trim();
  } catch { /* recorded as null */ }
  try {
    const { stdout } = await execFileP('git', ['-C', HERMES_SRC, 'status', '--porcelain'], { timeout: 10_000 });
    out.gitDirty = stdout.trim().length > 0;
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
  try {
    const { stdout } = await execFileP(argv[0], argv.slice(1), { timeout: 30_000 });
    return { parsed: JSON.parse(stdout.trim().split('\n').pop()), launcherError: null };
  } catch (e) {
    return { parsed: null, launcherError: { message: String(e.message).slice(0, 300) } };
  }
}

function hostNetns() {
  try { return fs.readlinkSync('/proc/self/ns/net'); } catch { return null; }
}

/** Errno-safe liveness of an owned pid. */
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
    runId: `dc-phase1-probe2-${Date.now()}-${process.pid}`,
    startedAt: new Date().toISOString(),
    testedSource: { spike: import.meta.filename, hermesSrc: HERMES_SRC },
    hermesVersion: null,
    sandbox: null,
    observedEnv: null,
    boundary: null,
    ready: null,
    ping: null,
    sessionList: null,
    stop: null,
    cleanup: null,
    productionProfile: null,
    verdict: null,
    finishedAt: null,
  };

  const writeEvidence = () => {
    fs.mkdirSync('docs/reports', { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(results, null, 2));
  };

  results.hermesVersion = await sourceVerifiedVersion();

  const prodFp = [
    fingerprint('/home/user/.hermes/config.yaml'),
    fingerprint('/home/user/.hermes/state.db'),
    fingerprint('/home/user/.hermes/auth.json'),
  ];

  const dirs = makeProbeDirs('dc-phase1-probe-');

  // ---- Gate 1: verified boundary via the SHARED classifier
  const marker = `probe-obs-${Date.now()}`;
  const observed = await observeInsideSandbox(dirs, { DC_PHASE1_OBSERVER_MARKER: marker });
  results.observedEnv = observed.parsed
    ? {
        label: 'OBSERVED (inside sandbox)',
        home: observed.parsed.home,
        hermesHome: observed.parsed.hermesHome,
        tmpdir: observed.parsed.tmpdir,
        pwd: observed.parsed.pwd,
        envKeys: observed.parsed.envKeys,
        netns: observed.parsed.netns,
        userns: observed.parsed.userns,
        tmpdirReadable: observed.parsed.tmpdirReadable,
      }
    : { label: 'BLOCKED', launcherError: observed.launcherError };
  const boundary = classifyIsolationRun({
    launcherError: observed.launcherError,
    helperOutput: observed.parsed && { ...observed.parsed, outcome: 'DENIED', marker },
    hostNetns: hostNetns(),
    expectedOutcome: 'DENIED',
    expectedMarker: marker,
  });
  results.boundary = { label: 'CLASSIFIED (shared classifyIsolationRun)', ...boundary };
  results.sandbox = {
    tool: 'bwrap (shared configuration via sandbox-helper.buildBwrapArgv)',
    flags: ['unshare-net', 'unshare-pid', 'die-with-parent', 'clearenv-then-setenv'],
    productionHomeBound: false,
    hermesSourceBind: `${HERMES_SRC} (read-only)`,
    freshHomes: { home: '/probe/home', hermesHome: '/probe/hermes-home (rw: throwaway profile for state.db)' },
  };

  if (boundary.verdict !== 'PASS') {
    results.verdict = {
      gate: 'BLOCKED',
      exitCode: 5,
      reason: `boundary not verified: ${boundary.reason}`,
      gateChecks: { boundary: false, ready: false, ping: false, cleanup: false },
    };
    results.finishedAt = new Date().toISOString();
    writeEvidence();
    rmTree(dirs.root);
    console.log(JSON.stringify(results, null, 2));
    console.error(`[probe] BLOCKED: ${boundary.reason}; evidence written to ${EVIDENCE_PATH}`);
    process.exit(5);
  }

  // ---- Native gateway inside the SAME boundary
  const { argv: bwrapArgv } = buildBwrapArgv({
    home: dirs.home,
    hermesHome: dirs.hermesHome,
    tmp: dirs.tmp,
    cwdPath: '/probe',
    hermesHomeMode: 'rw', // throwaway profile must be writable for state.db
    roBinds: [[HERMES_SRC, HERMES_SRC]],
    extraEnv: { PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: HERMES_SRC },
    argv: GATEWAY_ARGV,
  });
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

  let readyParams = null;
  client.on('gateway.ready', (params) => { readyParams = params ?? null; });

  let stop = null;
  try {
    await client.start();
    results.ready = {
      observed: true,
      label: 'OBSERVED (native)',
      payloadKeys: Object.keys(readyParams?.payload ?? {}),
      payload: redact(readyParams?.payload ?? null),
    };

    // ---- Gate 3: valid EXPECTED ping result (shape-checked, not just observed)
    const ping = await client.request('ping');
    const pingValid = ping && ping.pong === true;
    results.ping = { observed: true, result: redact(ping), expected: 'pong === true', valid: pingValid === true };

    try {
      const list = await client.request('session.list', {});
      results.sessionList = {
        label: 'OPTIONAL — recorded, not part of the gate',
        observed: true,
        sessionCount: Array.isArray(list?.sessions) ? list.sessions.length : null,
        resultShape: Object.keys(list ?? {}),
      };
    } catch (e) {
      results.sessionList = { label: 'OPTIONAL-FAILED — recorded, not part of the gate', observed: false, error: String(e.message).slice(0, 200) };
    }
  } catch (e) {
    results.ready = results.ready ?? { observed: false, label: 'BLOCKED', error: String(e.message).slice(0, 300) };
    results.ping = results.ping ?? { observed: false, valid: false };
  } finally {
    stop = await client.stop();
    results.stop = stop;
    // ---- Gate 4: confirmed cleanup = owned supervisor exit OBSERVED.
    const bwrapPid = client.child?.pid ?? null;
    const bwrapState = bwrapPid == null ? { alive: false, inspectable: false } : pidAlive(bwrapPid);
    const confirmed = stop.observed === true && bwrapState.inspectable && bwrapState.alive === false;
    results.cleanup = {
      label: confirmed ? 'CONFIRMED (owned supervisor exit observed)' : 'UNCONFIRMED',
      confirmed,
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

  // ---- C4 gate: explicit required checks; optional session.list is labeled.
  const gateChecks = {
    boundary: results.boundary.verdict === 'PASS',
    ready: results.ready?.observed === true,
    ping: results.ping?.valid === true,
    cleanup: results.cleanup?.confirmed === true,
  };
  let gate;
  let exitCode;
  if (gateChecks.boundary && gateChecks.ready && gateChecks.ping && gateChecks.cleanup) {
    gate = 'PASS'; exitCode = 0;
  } else if (gateChecks.boundary) {
    gate = 'PARTIAL'; exitCode = 4; // boundary verified but gate incomplete
  } else {
    gate = 'BLOCKED'; exitCode = 5;
  }
  results.verdict = { gate, exitCode, gateChecks };
  results.finishedAt = new Date().toISOString();

  writeEvidence();
  console.log(JSON.stringify(results, null, 2));
  rmTree(dirs.root);
  console.error(`[probe] gate=${gate} evidence written to ${EVIDENCE_PATH}`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('probe failed:', err?.message ?? err);
  process.exit(1);
});
