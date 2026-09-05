#!/usr/bin/env node
/**
 * Phase-1 native read-only probe — the ONLY non-fixture executable this phase
 * launches, and only after the fixture isolation suite passes.
 *
 * What it does (bounded, redacted evidence only):
 *   1. Snapshots production-profile fingerprints (config.yaml/state.db size +
 *      mtime) — read-only, to prove nothing under the real profile changes.
 *   2. Builds a scoped sandbox with bubblewrap:
 *        - --unshare-net  : outbound AND loopback network denied for the probe
 *          process tree only (no machine-wide firewall change).
 *        - --unshare-pid + --die-with-parent : the gateway's whole process tree
 *          is contained; teardown kills exactly that namespace.
 *        - The production profile (/home/user, /home/user/.hermes) is NOT
 *          bound into the sandbox at all — physically invisible.
 *        - The installed Hermes source tree + venv are bound READ-ONLY.
 *        - Fresh HOME / HERMES_HOME / TMPDIR bind mounts from a temp root.
 *   3. Spawns ONLY the explicitly named installed gateway:
 *        <venv>/bin/python -m tui_gateway.entry   (Hermes Agent v0.20.6)
 *      No prompts, no provider config, no compression, no retries.
 *   4. Waits for the native `gateway.ready` event; records its payload shape.
 *   5. Sends metadata-only RPCs: `ping` (source-verified liveness), and
 *      `session.list` against the FRESH empty profile (records the observed
 *      result or error; neither is a failure).
 *   6. Stops orderly (SIGTERM → grace → SIGKILL last resort, scoped to the
 *      owned bwrap pid), verifies the process tree is gone, and re-checks the
 *      production fingerprints.
 *
 * This script is NOT run by the test suite and not imported by app startup.
 * Run manually:  node scripts/native-probe.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HermesProtocolClient, buildChildEnv } from './hermes-protocol-spike.mjs';

const execFileP = promisify(execFile);

const HERMES_SRC = '/home/user/.hermes/hermes-agent';
const GATEWAY_ARGV = [path.join(HERMES_SRC, 'venv/bin/python'), '-m', 'tui_gateway.entry'];

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

async function main() {
  const results = {
    startedAt: new Date().toISOString(),
    gatewayArgv: GATEWAY_ARGV,
    hermesVersion: null,
    sandbox: null,
    ready: null,
    ping: null,
    sessionList: null,
    stop: null,
    leftovers: null,
    productionProfile: null,
    verdict: null,
  };

  // Hermes version from the installed CLI (source-verified metadata, no network).
  try {
    const { stdout } = await execFileP('/home/user/.local/bin/hermes', ['--version'], { timeout: 20_000 });
    results.hermesVersion = stdout.trim().split('\n')[0] ?? null;
  } catch (e) {
    results.hermesVersion = `unavailable: ${e.message.split('\n')[0]}`;
  }

  const prodFp = [
    fingerprint('/home/user/.hermes/config.yaml'),
    fingerprint('/home/user/.hermes/state.db'),
    fingerprint('/home/user/.hermes/auth.json'),
  ];

  // Fresh dirs for the sandbox.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-phase1-probe-'));
  const home = path.join(root, 'home');
  const hermesHome = path.join(root, 'hermes-home');
  const tmp = path.join(root, 'tmp');
  for (const d of [home, hermesHome, tmp]) fs.mkdirSync(d, { recursive: true });

  // Scoped sandbox: production /home is NOT bound; Hermes source is read-only.
  const bwrap = [
    'bwrap',
    '--unshare-net', '--unshare-pid', '--die-with-parent',
    '--proc', '/proc', '--dev', '/dev',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind-try', '/etc', '/etc',
    '--ro-bind-try', '/lib', '/lib',
    '--ro-bind-try', '/lib64', '/lib64',
    '--tmpfs', '/run',
    '--ro-bind', HERMES_SRC, HERMES_SRC,
    '--bind', home, '/home/probe',
    '--bind', hermesHome, '/home/probe/hermes-home',
    '--bind', tmp, '/tmp',
    '--clearenv',
    ...GATEWAY_ARGV,
  ];
  results.sandbox = {
    tool: 'bwrap',
    flags: ['unshare-net', 'unshare-pid', 'die-with-parent'],
    productionHomeBound: false,
    hermesSourceBind: `${HERMES_SRC} (read-only)`,
    freshHomes: { home: '/home/probe', hermesHome: '/home/probe/hermes-home' },
  };

  // Allowlisted env only; PYTHONDONTWRITEBYTECODE keeps the RO venv clean.
  const env = buildChildEnv({
    home: '/home/probe',
    hermesHome: '/home/probe/hermes-home',
    tmpDir: '/tmp',
    extraEnv: { PYTHONDONTWRITEBYTECODE: '1' },
  });

  const client = new HermesProtocolClient({
    command: bwrap,
    env,
    cwd: HERMES_SRC, // `python -m tui_gateway.entry` imports from the repo root
    startupTimeoutMs: 45_000,
    requestTimeoutMs: 15_000,
    stopGraceMs: 4_000,
  });

  // Capture the native gateway.ready payload for evidence.
  client.on('gateway.ready', (params) => {
    results.ready.payload = redact(params?.payload ?? null);
  });

  try {
    await client.start();
    results.ready = {
      observed: true,
      label: 'OBSERVED (native)',
      payloadKeys: redact(Object.keys(client.__readyPayload ?? {})),
      payload: redact(client.__readyPayload ?? null),
    };

    const ping = await client.request('ping');
    results.ping = { observed: true, result: redact(ping) };

    try {
      const list = await client.request('session.list', {});
      const first = Array.isArray(list?.sessions) ? list.sessions.length : null;
      results.sessionList = {
        observed: true,
        note: 'metadata-only listing against the FRESH empty profile inside the sandbox',
        sessionCount: first,
        resultShape: redact(Object.keys(list ?? {})),
      };
    } catch (e) {
      results.sessionList = { observed: true, error: String(e.message).slice(0, 200), note: 'recorded; not a probe failure' };
    }

    // Ready payload was captured by the event handler below before this point.
  } finally {
    results.stop = await client.stop();
    // Cleanup scope check: count ONLY processes that belong to this probe's
    // tree (its temp root). The user's own Hermes gateways on this machine
    // match the same binary name and must never be touched or miscounted.
    const probeRoot = root;
    results.leftovers = await execFileP('pgrep', ['-af', 'tui_gateway.entry'])
      .then((r) => r.stdout.split('\n').filter((l) => l.includes(probeRoot)).join('\n').trim())
      .catch(() => '');
  }

  const afterFp = prodFp.map((f) => fingerprint(f.path));
  const unchanged = JSON.stringify(prodFp) === JSON.stringify(afterFp);
  results.productionProfile = { before: prodFp, after: afterFp, unchanged };
  results.verdict = {
    readyObserved: results.ready?.observed === true,
    pingObserved: results.ping?.observed === true,
    treeClean: results.leftovers === '',
    productionUntouched: unchanged,
  };
  results.root = root;
  results.finishedAt = new Date().toISOString();

  fs.mkdirSync('docs/reports', { recursive: true });
  fs.writeFileSync('docs/reports/native-probe-evidence.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

// Capture the native gateway.ready payload for evidence.
const __origOn = HermesProtocolClient.prototype.on;
HermesProtocolClient.prototype.on = function (type, fn) {
  if (type === 'gateway.ready') {
    const wrapped = (params) => { this.__readyPayload = params?.payload ?? params; fn(params); };
    return __origOn.call(this, type, wrapped);
  }
  return __origOn.call(this, type, fn);
};

main().catch((err) => {
  console.error('probe failed:', err?.message ?? err);
  process.exit(1);
});
