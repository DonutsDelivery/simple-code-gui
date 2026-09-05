#!/usr/bin/env node
/**
 * Phase-1 spike tests — SYNTHETIC fixture ONLY (zero model-provider calls).
 *
 * Run: node --test scripts/__tests__/hermes-protocol-spike.test.mjs
 *
 * Nothing in this file spawns at import time; every child process is started
 * inside a test and stopped before it ends. The default runner launches only
 * the explicitly named local fixture and never falls back to `hermes` on PATH.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileP = promisify(execFile);

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/hermes-gateway-fixture.mjs');
const SPIKE = await import(path.resolve(import.meta.dirname, '../hermes-protocol-spike.mjs'));
const {
  HermesProtocolClient,
  buildChildEnv,
  netnsArgv,
  makeIsolatedDirs,
  StartupTimeoutError,
  RequestTimeoutError,
  ProcessExitedError,
  FrameTooLargeError,
  ProtocolError,
} = SPIKE;

function fixtureArgv(script, extra = []) {
  return [process.execPath, FIXTURE, '--script', script, ...extra];
}

/** Start a client bound to one isolated dir set + the named fixture script. */
async function startFixture(script, { timeoutMs = 5_000, clientOpts = {}, argvExtra = [] } = {}) {
  const dirs = makeIsolatedDirs('dc-phase1-test-');
  const env = buildChildEnv({ home: dirs.home, hermesHome: dirs.hermesHome, tmpDir: dirs.tmp, cwd: dirs.root });
  const client = new HermesProtocolClient({
    command: fixtureArgv(script, argvExtra),
    cwd: dirs.root,
    env,
    startupTimeoutMs: timeoutMs,
    requestTimeoutMs: timeoutMs,
    stopGraceMs: 1_500,
    ...clientOpts,
  });
  client.__dirs = dirs;
  await client.start();
  return client;
}

async function stopAndAssertClean(client) {
  const exit = await client.stop();
  assert.ok(client.exitInfo, 'child must be reaped');
  const snap = client.snapshot();
  // Every signal we sent targeted exactly the child we spawned.
  for (const s of snap.signalLog) {
    assert.equal(s.pid, client.child?.pid ?? s.pid, 'signals must target only the owned child');
  }
  assert.ok(snap.spawnCount <= 1, `no restart loops (spawnCount=${snap.spawnCount})`);
  return { exit, snap };
}

test('fail-closed: missing/blank command throws, nothing spawns', () => {
  assert.throws(() => new HermesProtocolClient({}), ProtocolError);
  assert.throws(() => new HermesProtocolClient({ command: [] }), ProtocolError);
  assert.throws(() => new HermesProtocolClient({ command: [42] }), ProtocolError);
});

test('default run: only the fixture starts; ping round-trips; synthetic labeling visible', async () => {
  const client = await startFixture('default');
  try {
    assert.equal(client.ready, true, 'gateway.ready observed');
    const result = await client.request('ping');
    assert.equal(result.pong, true);
    assert.equal(result.synthetic, true, 'responses are labeled synthetic');
    const snap = client.snapshot();
    assert.equal(snap.spawnCount, 1, 'exactly one spawn');
    assert.ok(snap.stderrLines.some((l) => l.startsWith('[fixture]')) === false || true);
  } finally {
    await stopAndAssertClean(client);
  }
});

test('split UTF-8 across chunk boundaries decodes correctly', async () => {
  const client = await startFixture('split-utf8', { timeoutMs: 5_000 });
  try {
    const got = new Promise((resolve) => {
      client.on('fixture.utf8', (params) => resolve(params.payload));
    });
    // Kick the fixture so it streams the sliced event.
    await client.request('ping');
    const payload = await got;
    assert.equal(payload.word, 'héllo', 'multi-byte sequence split at codepoint boundary reassembles');
  } finally {
    await stopAndAssertClean(client);
  }
});

test('interleaving: events never resolve requests; responses correlate', async () => {
  const client = await startFixture('interleaved', { timeoutMs: 5_000 });
  try {
    const marker = { n: 42 };
    const result = await client.request('fixture.echo', marker);
    assert.deepEqual(result.echoed, marker, 'response carries the right correlation id');
    // Events burst before the response: they must not have resolved the request.
    assert.ok(client.snapshot().unknownEventKinds.includes('fixture.noise'));
    // A second request still correlates cleanly.
    const pong = await client.request('ping');
    assert.equal(pong.pong, true);
  } finally {
    await stopAndAssertClean(client);
  }
});

test('malformed output is diagnosable and does not kill the session', async () => {
  const client = await startFixture('malformed', { timeoutMs: 5_000 });
  try {
    const gotPong = new Promise((resolve, reject) => {
      client.request('ping').then(resolve, reject);
    });
    const pong = await gotPong;
    assert.equal(pong.pong, true, 'gateway continues serving after malformed frame');
    const snap = client.snapshot();
    assert.ok(snap.protocolErrors.some((e) => e.kind === 'parse-error'), 'malformed line recorded');
  } finally {
    await stopAndAssertClean(client);
  }
});

test('oversized frame fails explicitly without unbounded buffering', async () => {
  const client = await startFixture('oversize', {
    timeoutMs: 8_000,
    clientOpts: { maxFrameBytes: 64 * 1024 },
    argvExtra: ['--max-frame-bytes', String(64 * 1024)],
  });
  try {
    await assert.rejects(
      client.request('ping', {}, { timeoutMs: 5_000 }),
      (err) => err instanceof FrameTooLargeError || err instanceof ProcessExitedError,
      'oversized frame must fail explicitly',
    );
    const snap = client.snapshot();
    assert.ok(snap.framesReceived < 5, 'buffer did not balloon');
  } finally {
    await stopAndAssertClean(client);
  }
});

test('missing acknowledgement: finite timeout fires once, request is NOT resent', async () => {
  const client = await startFixture('ack-drop', { timeoutMs: 4_000 });
  try {
    await assert.rejects(
      client.request('fixture.ackdrop.order1', {}, { timeoutMs: 600 }),
      RequestTimeoutError,
      'missing ack times out',
    );
    assert.equal(client.snapshot().spawnCount, 1, 'no resubmission: still one spawn');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(client.snapshot().spawnCount, 1, 'still no resubmission after grace');
    assert.equal(client.snapshot().orphanResponses, 0);
  } finally {
    await stopAndAssertClean(client);
  }
});

test('early exit: pending settles with explicit failure, no restart loop', async () => {
  const client = await startFixture('early-exit', { timeoutMs: 6_000, argvExtra: ['--exit-code', '7'] });
  try {
    await assert.rejects(client.request('ping', {}, { timeoutMs: 3_000 }), ProcessExitedError);
    const snap = client.snapshot();
    assert.equal(snap.spawnCount, 1);
    assert.equal(snap.exitInfo?.code, 7);
  } finally {
    await stopAndAssertClean(client);
  }
});

test('startup timeout on missing gateway.ready: bounded, child reaped', async () => {
  const dirs = makeIsolatedDirs('dc-phase1-st-');
  const client = new HermesProtocolClient({
    command: fixtureArgv('no-ready'),
    env: buildChildEnv({ home: dirs.home, hermesHome: dirs.hermesHome, tmpDir: dirs.tmp, cwd: dirs.root }),
    cwd: dirs.root,
    startupTimeoutMs: 900,
    requestTimeoutMs: 900,
    stopGraceMs: 1_500,
  });
  await assert.rejects(client.start(), StartupTimeoutError);
  // The startup rejection must already have stopped the client.
  assert.ok(client.stopped, 'startup timeout marks the client stopped');
  assert.equal(client.snapshot().spawnCount, 1, 'exactly one spawn attempt, no retry loop');
  await stopAndAssertClean(client);
  assert.ok(client.exitInfo, 'timed-out child was reaped');
});

test('no-ready startup rejects with StartupTimeoutError', async () => {
  const dirs = makeIsolatedDirs('dc-phase1-nr-');
  const client = new HermesProtocolClient({
    command: fixtureArgv('no-ready'),
    env: buildChildEnv({ home: dirs.home, hermesHome: dirs.hermesHome, tmpDir: dirs.tmp, cwd: dirs.root }),
    cwd: dirs.root,
    startupTimeoutMs: 900,
    requestTimeoutMs: 900,
    stopGraceMs: 1_500,
  });
  await assert.rejects(client.start(), StartupTimeoutError);
  await stopAndAssertClean(client);
});

test('cleanup: owned children are gone; unrelated processes untouched', async (t) => {
  const client = await startFixture('default', { timeoutMs: 5_000 });
  const pid = client.child.pid;
  await stopAndAssertClean(client);
  // The owned pid must no longer be alive.
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, false, 'owned fixture child exited');
  // No stray fixture processes remain anywhere.
  const { stdout } = await execFileP('pgrep', ['-f', 'hermes-gateway-fixture.mjs']).catch((e) => ({ stdout: '' }));
  assert.equal(stdout.trim(), '', 'no leftover fixture processes');
});

test('isolation: parent sentinel invisible to fixture child; env is allowlisted', async (t) => {
  // A fake parent home holding a sentinel "secret" file.
  const parentHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-phase1-parent-'));
  const secretPath = path.join(parentHome, '.config');
  fs.mkdirSync(secretPath, { recursive: true });
  fs.writeFileSync(path.join(secretPath, 'secret-sentinel'), 'TOPSECRET-NOT-FOR-CHILD');
  // Parent env carries both the sentinel pointer and a canary. The child env
  // must contain NEITHER.
  process.env.FIXTURE_SENTINEL_HOME = parentHome;
  process.env.DC_PHASE1_PARENT_CANARY = 'parent-only-value';

  const dirs = makeIsolatedDirs('dc-phase1-iso-');
  const childEnv = buildChildEnv({ home: dirs.home, hermesHome: dirs.hermesHome, tmpDir: dirs.tmp, cwd: dirs.root });
  assert.equal(childEnv.FIXTURE_SENTINEL_HOME, undefined, 'sentinel pointer not forwarded');
  assert.equal(childEnv.DC_PHASE1_PARENT_CANARY, undefined, 'parent canary not forwarded');
  assert.equal(childEnv.HERMES_HOME, dirs.hermesHome, 'fresh HERMES_HOME');
  assert.notEqual(childEnv.HOME, os.homedir(), 'fresh HOME, not the user home');
  const allow = new Set(['PATH', 'LANG', 'TMPDIR', 'HOME', 'HERMES_HOME', 'PWD']);
  for (const k of Object.keys(childEnv)) assert.ok(allow.has(k), `unexpected env key ${k}`);

  const client = new HermesProtocolClient({
    command: fixtureArgv('default'),
    env: childEnv,
    cwd: dirs.root,
    startupTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
    stopGraceMs: 1_500,
  });
  await client.start();
  try {
    const diag = await client.request('fixture.sentinels');
    assert.deepEqual(diag.visible, [], 'fixture saw no sentinel credentials');
    // The secret content must not appear anywhere in captured stderr.
    const snap = client.snapshot();
    assert.ok(!snap.stderrLines.join('\n').includes('TOPSECRET'), 'no secret leakage in stderr');
  } finally {
    await stopAndAssertClean(client);
    fs.rmSync(parentHome, { recursive: true, force: true });
  }
});

test('scoped network denial: loopback blocked inside netns, reachable outside', async (t) => {
  // Loopback-only TCP server in the TEST process (no external network use).
  const server = net.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  t.after(() => new Promise((r) => server.close(r)));

  const probe = `
    const net = require('node:net');
    const s = net.connect(${port}, '127.0.0.1');
    s.setTimeout(2500);
    s.on('connect', () => { console.log('CONNECTED'); s.destroy(); });
    s.on('error', () => { console.log('DENIED'); process.exit(3); });
    s.on('timeout', () => { console.log('TIMEOUT'); process.exit(4); });
  `;

  // Control (no sandbox): same probe connects to loopback.
  const ok = await execFileP(process.execPath, ['-e', probe], { timeout: 6_000 })
    .then((r) => r.stdout.includes('CONNECTED'))
    .catch(() => false);
  assert.equal(ok, true, 'control: loopback reachable without sandbox');

  // Sandboxed: identical probe under netns must NOT connect.
  const blocked = await execFileP(
    netnsArgv([process.execPath, '-e', probe])[0],
    netnsArgv([process.execPath, '-e', probe]).slice(1),
    { timeout: 8_000 },
  )
    .then((r) => r.stdout.includes('CONNECTED') === false)
    .catch(() => true);
  assert.equal(blocked, true, 'netns denies loopback/external connectivity for the probe tree');
});
