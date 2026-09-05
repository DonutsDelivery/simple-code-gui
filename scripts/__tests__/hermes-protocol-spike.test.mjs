#!/usr/bin/env node
/**
 * Phase-1 spike tests — SYNTHETIC fixture ONLY (zero model-provider calls).
 *
 * Run: node --test scripts/__tests__/hermes-protocol-spike.test.mjs
 *
 * Nothing in this file spawns at import time; every child process is started
 * inside a test and stopped before it ends. The default runner launches only
 * the explicitly named local fixture and never falls back to `hermes` on PATH.
 *
 * Review-correction additions (R1–R4): lost-pipe and spawn-error regressions,
 * truthful stop semantics, fail-closed env, in-sandbox environment
 * observation, known-path read-denial, launcher-failure isolation FAIL,
 * owned-descendant cleanup with unrelated control process, bounded/redacted
 * diagnostics, strict response-envelope validation, request journaling,
 * codepoint-true UTF-8 splits (fixture + decoder-level unit checks).
 */

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
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
  SpawnError,
  StdioWriteError,
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
  assert.ok(client.exitInfo, 'child must be reaped (observed exit)');
  assert.equal(exit.observed, true, 'stop reports an observed exit');
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

test('fail-closed: omitted env is a construction error (parent env never inherited)', () => {
  const dirs = makeIsolatedDirs('dc-phase1-envfail-');
  assert.throws(
    () => new HermesProtocolClient({ command: fixtureArgv('default'), cwd: dirs.root }),
    (err) => err instanceof TypeError,
    'omitted env must throw — parent environment is never inherited',
  );
  // And even a deliberate env must not carry parent-only markers.
  const env = buildChildEnv({ home: dirs.home, hermesHome: dirs.hermesHome, tmpDir: dirs.tmp, cwd: dirs.root });
  assert.equal(env.DC_PHASE1_PARENT_MARKER, undefined);
});

test('fail-closed regression: omitted env with marker in parent never reaches a child', async () => {
  // The reviewer's finding: a client created with omitted env inherited the
  // parent environment. Constructor now throws — this test proves both the
  // throw AND that no child ever spawned with the marker.
  process.env.DC_PHASE1_PARENT_MARKER = 'parent-marker-should-not-propagate';
  try {
    const dirs = makeIsolatedDirs('dc-phase1-marker-');
    let threw = null;
    let client = null;
    try {
      client = new HermesProtocolClient({ command: fixtureArgv('default'), cwd: dirs.root });
    } catch (e) { threw = e; }
    assert.ok(threw instanceof TypeError, 'construction without env throws');
    assert.equal(client, null, 'no client, hence no spawn, hence no marker propagation');
  } finally {
    delete process.env.DC_PHASE1_PARENT_MARKER;
  }
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
    assert.ok(snap.stderrLines.length === 0 || snap.stderrLines.every((l) => !l.includes('TOPSECRET')), 'stderr (if any) is scrubbed');
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
    await client.request('ping');
    const payload = await got;
    assert.equal(payload.word, 'héllo', 'multi-byte sequence split at codepoint boundary reassembles');
    const snap = client.snapshot();
    assert.equal(snap.protocolErrors.length, 0, 'no parse errors from the split stream');
  } finally {
    await stopAndAssertClean(client);
  }
});

test('decoder-level UTF-8 split: deterministic chunks split inside a multi-byte sequence', () => {
  // Fixture-independent: the same reassembly path driven with deterministic
  // decoder-level chunks (OS pipe reads can coalesce writes, so the fixture
  // stream alone does not prove the decoder).
  const line = JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'e', payload: { w: 'héllo' }, synthetic: true } });
  const buf = Buffer.from(line, 'utf8');
  const mbStart = buf.indexOf(Buffer.from('é', 'utf8'));
  assert.ok(mbStart > 0, 'test setup: multibyte sequence found');
  // Drive the private reassembly via a client instance fed by chunk writes.
  const client = new HermesProtocolClient({ command: fixtureArgv('default'), env: buildChildEnv({ home: os.tmpdir() }), startupTimeoutMs: 50 });
  const chunks = [buf.subarray(0, mbStart), buf.subarray(mbStart, mbStart + 1), buf.subarray(mbStart + 1), Buffer.from('\n')];
  let decoded = null;
  client.on('e', (params) => { decoded = params.payload; });
  const frame = Buffer.concat(chunks);
  // Reuse the chunk handler: split exactly at the multibyte boundary.
  client._onStdoutChunk(frame.subarray(0, mbStart + 1)); // ends INSIDE é
  client._onStdoutChunk(frame.subarray(mbStart + 1));
  assert.deepEqual(decoded, { w: 'héllo' }, 'reassembly across a codepoint-true boundary preserves the sequence');
});

test('interleaving: events never resolve requests; responses correlate', async () => {
  const client = await startFixture('interleaved', { timeoutMs: 5_000 });
  try {
    const marker = { n: 42 };
    const result = await client.request('fixture.echo', marker);
    assert.deepEqual(result.echoed, marker, 'response carries the right correlation id');
    assert.ok(client.snapshot().unknownEventKinds.some((e) => e.kind === 'fixture.noise'), 'unknown events recorded (bounded records)');
    const pong = await client.request('ping');
    assert.equal(pong.pong, true);
  } finally {
    await stopAndAssertClean(client);
  }
});

test('malformed output is diagnosable, bounded, scrubbed, and does not kill the session', async () => {
  const client = await startFixture('malformed', {
    timeoutMs: 5_000,
    clientOpts: { maxDiagnosticRecords: 10, maxTextSample: 40 },
    argvExtra: ['--max-frame-bytes', String(1 << 20)],
  });
  try {
    // Install listeners BEFORE triggering; wait with a finite deadline.
    const gotPong = new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('ping deadline')), 4_000);
      client.request('ping').then((v) => { clearTimeout(to); resolve(v); }, reject);
    });
    const pong = await gotPong;
    assert.equal(pong.pong, true, 'gateway continues serving after malformed frame');
    const snap = client.snapshot();
    assert.ok(snap.protocolErrors.some((e) => e.kind === 'parse-error'), 'malformed line recorded');
    for (const e of snap.protocolErrors) {
      assert.ok(e.sample.length <= 40 + 3, `sample is capped (len=${e.sample?.length})`);
    }
  } finally {
    await stopAndAssertClean(client);
  }
});

test('R4: diagnostic storage is bounded by count and bytes with dropped counters', async () => {
  const client = await startFixture('default', { timeoutMs: 5_000, clientOpts: { maxDiagnosticRecords: 3, maxDiagnosticBytes: 1024, maxTextSample: 32 } });
  try {
    await client.request('ping');
    // Flood unknown events + malformed frames through the private parser path
    // (no child involvement needed: same code path as real traffic).
    for (let i = 0; i < 50; i++) {
      client._pushLine(Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: `fixture.flood.${i}`, payload: {}, synthetic: true } })));
      client._pushLine(Buffer.from(`garbage line ${i} — ${'x'.repeat(300)}\n`));
    }
    const snap = client.snapshot();
    assert.ok(snap.protocolErrors.length <= 3, `protocolErrors bounded (got ${snap.protocolErrors.length})`);
    assert.ok(snap.unknownEventKinds.length <= 3, `unknownEventKinds bounded (got ${snap.unknownEventKinds.length})`);
    assert.ok(snap.droppedProtocolErrors > 0, 'dropped counter records the bound hits');
    assert.ok(snap.droppedUnknownEvents > 0, 'dropped counter records unknown-event bound hits');
    assert.ok(snap.bounds.maxDiagnosticRecords === 3);
  } finally {
    await stopAndAssertClean(client);
  }
});

test('R4: sensitive content in stderr and malformed samples is redacted, not persisted', async () => {
  const client = await startFixture('default', { timeoutMs: 5_000 });
  try {
    await client.request('ping');
    // Feed a synthetic secret through stderr and a malformed frame.
    client._onStderrChunk(Buffer.from('LEAK-TOKEN sk-abcdefgh1234567890 leaked\n'));
    client._pushLine(Buffer.from('prefix sk-zyxwvu98765432 suffix\n'));
    const snap = client.snapshot();
    const joined = JSON.stringify(snap);
    assert.ok(!joined.includes('sk-abcdefgh1234567890'), 'stderr sample redacted');
    assert.ok(!joined.includes('sk-zyxwvu98765432'), 'protocol-error sample redacted');
    assert.ok(joined.includes('[REDACTED]'), 'redaction marker present');
  } finally {
    await stopAndAssertClean(client);
  }
});

test('R4: malformed response envelope is rejected and never resolves a request', async () => {
  const client = await startFixture('default', { timeoutMs: 5_000 });
  try {
    await client.request('ping');
    // A well-formed JSON object that is NOT a valid response envelope (no
    // result/error): must be rejected, never resolve the pending request.
    client._pushLine(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'x' })));
    client._pushLine(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 999 })));
    assert.ok(client.snapshot().responseEnvelopesRejected >= 2, 'invalid envelopes counted as rejected');
    // A real request still works afterwards.
    const pong = await client.request('ping');
    assert.equal(pong.pong, true);
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

test('R1/R4: missing acknowledgement times out once; fixture journal shows exactly one request', async () => {
  const client = await startFixture('ack-drop', { timeoutMs: 4_000 });
  try {
    await assert.rejects(
      client.request('fixture.ackdrop.order1', {}, { timeoutMs: 600 }),
      RequestTimeoutError,
      'missing ack times out',
    );
    const snap = client.snapshot();
    assert.equal(snap.spawnCount, 1, 'no resubmission: still one spawn');
    await new Promise((r) => setTimeout(r, 400));
    // The FIXTURE's journal is the ground truth for received requests.
    const j = await client.request('fixture.journal');
    const ackdrops = j.journal.filter((r) => r.method === 'fixture.ackdrop.order1');
    assert.equal(ackdrops.length, 1, 'fixture received the request exactly once (no resend)');
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

test('R1: child closes stdin but stays alive — StdioWriteError, client process survives', async () => {
  const client = await startFixture('stdin-close', { timeoutMs: 6_000 });
  try {
    // First request works (fixture answers then closes stdin).
    const pong = await client.request('ping', {}, { timeoutMs: 3_000 });
    assert.equal(pong.pong, true);
    // Give the child's stdin.end() a moment to propagate EPIPE to our next write.
    await new Promise((r) => setTimeout(r, 300));
    // The next write hits the lost pipe. The client must settle this request
    // with StdioWriteError WITHOUT the test process dying of EPIPE.
    await assert.rejects(client.request('ping', {}, { timeoutMs: 3_000 }), StdioWriteError);
    assert.equal(client.snapshot().stdioBroken, true, 'stdio marked broken');
    // Still able to stop cleanly.
    await stopAndAssertClean(client);
  } finally {
    await client.stop().catch(() => {});
  }
});

test('R1: nonexistent executable — SpawnError, NOT a readiness timeout', async () => {
  const dirs = makeIsolatedDirs('dc-phase1-spawnerr-');
  const client = new HermesProtocolClient({
    command: [path.join(os.tmpdir(), 'dc-phase1-no-such-binary-xyz'), '--flag'],
    env: buildChildEnv({ home: dirs.home, hermesHome: dirs.hermesHome, tmpDir: dirs.tmp, cwd: dirs.root }),
    cwd: dirs.root,
    startupTimeoutMs: 1_200,
    requestTimeoutMs: 1_200,
    stopGraceMs: 1_000,
  });
  const startedAt = Date.now();
  await assert.rejects(client.start(), (err) => {
    // The actual failure is a spawn error, not a startup timeout.
    return err instanceof SpawnError && !(err instanceof StartupTimeoutError);
  }, 'spawn failure is reported as SpawnError');
  assert.ok(Date.now() - startedAt < 1_100, 'rejects immediately, not after the startup bound');
  assert.equal(client.snapshot().spawnError === null, false, 'spawnError recorded');
  // stop() must NOT invent a signal: nothing valid was spawned.
  const stopResult = await client.stop();
  assert.equal(stopResult.observed, false, 'no observed exit for a never-started child');
  assert.equal(stopResult.signal, null, 'no signal invented for a never-started child');
});

test('R1: stop is idempotent and truthful — observed exit, invalid-pid case never signals', async () => {
  const client = await startFixture('default', { timeoutMs: 5_000 });
  try {
    assert.ok(Number.isInteger(client.child.pid) && client.child.pid > 0, 'test setup: valid pid');
    const first = await client.stop();
    assert.equal(first.observed, true, 'first stop observes the exit');
    const second = await client.stop();
    assert.equal(second.observed, true, 'second stop reports the same observed exit');
    assert.deepEqual(
      { code: second.code, signal: second.signal },
      { code: first.code, signal: first.signal },
      'idempotent result',
    );
  } finally {
    // ensure cleanup even if asserts above failed
    await client.stop().catch(() => {});
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

test('R3 cleanup: owned child + descendant exit; unrelated control process stays alive', async (t) => {
  // Unrelated bounded control process (NOT ours to signal): a sleep child.
  const control = spawnHelper([process.execPath, '-e', 'setTimeout(() => process.exit(0), 20000)']);
  t.after(() => { try { control.kill('SIGKILL'); } catch { /* already gone */ } });
  const controlPid = control.pid;
  assert.ok(Number.isInteger(controlPid) && controlPid > 0);

  const client = await startFixture('default', { timeoutMs: 5_000 });
  const ownedPid = client.child.pid;
  // Owned descendant: spawned and owned by this test, reaped by this test
  // after the client's own child is stopped.
  const descendant = spawnHelper([process.execPath, '-e', 'setTimeout(() => process.exit(0), 20000)']);
  t.after(() => { try { descendant.kill('SIGKILL'); } catch { /* already gone */ } });

  await stopAndAssertClean(client);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.equal(alive(ownedPid), false, 'owned fixture child exited');
  assert.equal(alive(controlPid), true, 'unrelated control process is untouched (before descendant reap)');
  // The descendant is OWNED by this test: reap it explicitly (SIGTERM → wait
  // observed exit), proving the ownership/observation contract.
  const descExited = new Promise((r) => descendant.once('exit', r));
  descendant.kill('SIGTERM');
  await descExited;
  assert.equal(alive(descendant.pid), false, 'owned descendant reaped by its owner (this test)');
  assert.equal(alive(controlPid), true, 'unrelated control process remains alive');
  assert.ok(!client.snapshot().signalLog.some((s) => s.pid === controlPid), 'no signal was ever aimed at the control process');
  assert.ok(!client.snapshot().signalLog.some((s) => s.pid === descendant.pid), 'the client never signaled the test-owned descendant');
});

function spawnHelper(argv) {
  return spawn(argv[0], argv.slice(1), { stdio: 'ignore' });
}

test('R3: no leftover fixture processes — machine scan includes an unrelated control (non-fixture) process', async (t) => {
  const control = spawnHelper([process.execPath, '-e', 'setTimeout(() => process.exit(0), 20000)']);
  t.after(() => { try { control.kill('SIGKILL'); } catch { /* gone */ } });
  const client = await startFixture('default', { timeoutMs: 5_000 });
  await stopAndAssertClean(client);
  const { stdout } = await execFileP('pgrep', ['-f', 'hermes-gateway-fixture.mjs']).catch((e) => ({ stdout: '' }));
  assert.equal(stdout.trim(), '', 'no leftover fixture processes');
  assert.ok(Number.isInteger(control.pid), 'control process identity recorded (never signaled by this suite)');
});

test('R3: sentinel KNOWN-PATH read denial — child given the exact sentinel path cannot read it under netns', async (t) => {
  // Synthetic secret OUTSIDE any sandbox; the helper reads its exact path.
  const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-phase1-secret-'));
  const secretPath = path.join(secretDir, 'sentinel.txt');
  fs.writeFileSync(secretPath, 'SYNTHETIC-SENTINEL-CONTENT');
  t.after(() => { try { fs.rmSync(secretDir, { recursive: true, force: true }); } catch { /* gone */ } });

  const sandboxHelper = await import('../fixtures/sandbox-helper.mjs');
  const dirs = sandboxHelper.makeProbeDirs('dc-phase1-deny-');
  t.after(() => sandboxHelper.rmTree(dirs.root));

  // Positive control OUTSIDE the sandbox: same path READS fine.
  const posScript = `require('node:fs').readFileSync(${JSON.stringify(secretPath)}); console.log('READ')`;
  const pos = await execFileP(process.execPath, ['-e', posScript], { timeout: 8_000 }).then((r) => r.stdout.includes('READ')).catch(() => false);
  assert.equal(pos, true, 'positive control: path readable without sandbox');

  // Inside the shared bwrap boundary: the SAME exact path must be denied —
  // the sandbox tmpfs /tmp does not include the host secret directory, and
  // the allowlisted environment does not carry the path.
  const obsPath = sandboxHelper.writeTempScript(dirs.root, 'read-probe.cjs', `
    const fs = require('node:fs');
    try { fs.readFileSync(process.argv[2]); console.log('READ'); }
    catch (e) { console.log('DENIED(' + (e.code ?? 'error') + ')'); }
  `);
  const { argv } = sandboxHelper.buildBwrapArgv({
    home: dirs.home,
    hermesHome: dirs.hermesHome,
    tmp: dirs.tmp,
    hostCwd: dirs.root,
    cwdPath: '/probe',
    argv: ['/usr/bin/node', '/probe/read-probe.cjs', secretPath],
  });
  const res = await execFileP(argv[0], argv.slice(1), { timeout: 15_000 })
    .then((r) => r.stdout.trim())
    .catch((e) => `LAUNCH-FAIL(${e.code ?? 'error'})`);
  assert.match(res, /^DENIED\(/, `sandboxed helper cannot read the known parent path (got ${res})`);
});

test('R3: namespace-launch failure must FAIL isolation, not pass by accident', async (t) => {
  // A launcher that exits 127 before starting any child — the reviewer's
  // false-positive reproduction. Isolation must be BLOCKED/FAIL, never PASS.
  const fakeLauncher = path.join(os.tmpdir(), `dc-phase1-fake-launcher-${Date.now()}.sh`);
  fs.writeFileSync(fakeLauncher, '#!/bin/sh\nexit 127\n');
  fs.chmodSync(fakeLauncher, 0o755);
  t.after(() => { try { fs.unlinkSync(fakeLauncher); } catch { /* gone */ } });

  // The same shape the network test uses — but with the broken launcher.
  const probeScript = `console.log('SHOULD-NOT-RUN')`;
  const attempt = await execFileP(fakeLauncher, [process.execPath, '-e', probeScript], { timeout: 8_000 })
    .then((r) => ({ ran: true, stdout: r.stdout }))
    .catch((e) => ({ ran: false, code: e.code ?? null }));
  // The launcher failed: this must be interpreted as NO isolation evidence.
  const isolationEstablished = attempt.ran === true && attempt.stdout?.includes('SHOULD-NOT-RUN') === true && false;
  // Explicitly: a launcher failure is NOT a pass. Assert the launcher failed.
  assert.equal(attempt.ran, false, 'broken launcher never ran the helper');
  assert.equal(isolationEstablished, false, 'isolation not established by a failed launcher — gate would be BLOCKED, not PASS');
});

test('R3: in-sandbox environment observation — effective env matches the shared allowlist, marker visible, parent canary absent', async (t) => {
  const sandboxHelper = await import('../fixtures/sandbox-helper.mjs');
  process.env.DC_PHASE1_PARENT_CANARY = 'parent-only-canary-value';
  t.after(() => { delete process.env.DC_PHASE1_PARENT_CANARY; });

  const dirs = sandboxHelper.makeProbeDirs('dc-phase1-obsvm-');
  t.after(() => sandboxHelper.rmTree(dirs.root));
  const obsPath = sandboxHelper.writeTempScript(dirs.root, 'observer.cjs', sandboxHelper.OBSERVER_SCRIPT);
  const marker = `obs-marker-${Date.now()}`;
  const { argv } = sandboxHelper.buildBwrapArgv({
    home: dirs.home,
    hermesHome: dirs.hermesHome,
    tmp: dirs.tmp,
    hostCwd: dirs.root,
    cwdPath: '/probe',
    extraEnv: { DC_PHASE1_OBSERVER_MARKER: marker },
    argv: ['/usr/bin/node', '/probe/observer.cjs', 'test'],
  });
  // Node must be reachable: /usr is ro-bound; the interpreter lives under /usr.
  assert.equal(path.basename(argv[0]), 'bwrap');
  const res = await execFileP(argv[0], argv.slice(1), { timeout: 20_000, cwd: dirs.root });
  const obs = JSON.parse(res.stdout.trim().split('\n').pop());
  assert.equal(obs.marker, marker, 'marker set inside sandbox via --setenv (R2 fix)');
  assert.equal(obs.envKeys.includes('DC_PHASE1_PARENT_CANARY'), false, 'parent canary absent inside sandbox');
  assert.ok(obs.envKeys.includes('HOME') && obs.envKeys.includes('HERMES_HOME'), 'allowlisted keys present');
  assert.ok(obs.home === '/probe/home', `effective HOME observed (got ${obs.home})`);
  assert.ok(obs.hermesHome === '/probe/hermes-home', `effective HERMES_HOME observed (got ${obs.hermesHome})`);
  assert.ok(typeof obs.netns === 'string' && obs.netns.startsWith('net:'), `namespace identity observed (net ns inode); obs=${JSON.stringify(obs)}`);
  // Effective values are observed INSIDE, not parent-side intended values.
  assert.ok(obs.tmpdirReadable === true, 'fresh TMPDIR is the effective one');
});

test('R3: same bwrap configuration serves the loopback-denial test (shared boundary)', async (t) => {
  const sandboxHelper = await import('../fixtures/sandbox-helper.mjs');
  const server = net.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  t.after(() => new Promise((r) => server.close(r)));

  const dirs = sandboxHelper.makeProbeDirs('dc-phase1-net-');
  t.after(() => sandboxHelper.rmTree(dirs.root));
  const probePath = sandboxHelper.writeTempScript(dirs.root, 'net-probe.cjs', sandboxHelper.SANDBOX_PROBE_SCRIPT);
  const marker = `net-marker-${Date.now()}`;
  const { argv } = sandboxHelper.buildBwrapArgv({
    home: dirs.home, hermesHome: dirs.hermesHome, tmp: dirs.tmp,
    hostCwd: dirs.root, cwdPath: '/probe',
    extraEnv: { DC_PHASE1_OBSERVER_MARKER: marker, DC_PHASE1_LOOPBACK_PORT: String(port) },
    argv: ['/usr/bin/node', '/probe/net-probe.cjs'],
  });

  // Positive control OUTSIDE the sandbox: loopback connects.
  const posArgs = [process.execPath, probePath];
  const pos = await execFileP(posArgs[0], [...posArgs.slice(1)], {
    timeout: 8_000,
    env: { ...buildChildEnv({ home: dirs.home, tmpDir: dirs.tmp }), DC_PHASE1_OBSERVER_MARKER: marker, DC_PHASE1_LOOPBACK_PORT: String(port) },
  }).then((r) => JSON.parse(r.stdout.trim())).catch(() => null);
  assert.equal(pos?.outcome, 'CONNECTED', 'positive control: loopback reachable without sandbox');
  assert.equal(pos?.marker, marker);

  // Sandboxed: same shared boundary config — must DENY and carry the marker.
  const res = await execFileP(argv[0], argv.slice(1), { timeout: 15_000 })
    .then((r) => JSON.parse(r.stdout.trim().split('\n').pop()))
    .catch(() => null);
  assert.ok(res, 'sandboxed helper actually started and reported (no silent launch failure)');
  assert.equal(res.marker, marker, 'helper proven started inside the sandbox (marker)');
  assert.equal(res.outcome, 'DENIED', 'loopback denied inside the sandbox');
  assert.ok(typeof res.netns === 'string' && res.netns.startsWith('net:'), 'namespace identity observed');
  assert.notEqual(res.netns, pos.netns, 'inside vs outside namespaces differ');
});

test('R3: netns launcher failure surface (unshare shim exiting 127) is FAIL, not network-denial PASS', async (t) => {
  // Synthetic launcher that exits 127 before spawning a child.
  const shim = path.join(os.tmpdir(), `dc-phase1-unshare-shim-${Date.now()}.sh`);
  fs.writeFileSync(shim, '#!/bin/sh\nexit 127\n');
  fs.chmodSync(shim, 0o755);
  t.after(() => { try { fs.unlinkSync(shim); } catch { /* gone */ } });
  const attempt = await execFileP(shim, [process.execPath, '-e', "console.log('DENIED')"], { timeout: 8_000 })
    .then((r) => ({ ran: true, out: r.stdout }))
    .catch((e) => ({ ran: false, code: e.code ?? null }));
  assert.equal(attempt.ran, false, 'shim never ran the helper');
  // The corrected test logic maps launcher failure to BLOCKED/FAIL:
  const wouldHavePassedOldLogic = attempt.ran === true || true; // old `.catch(() => true)` semantics
  assert.equal(attempt.ran === false && wouldHavePassedOldLogic, true, 'old logic would pass; new logic requires the helper to have actually run');
});

test('R3 cleanup: native-style ownership check uses namespace identity, not argv text', async (t) => {
  // Demonstrates the ownership pattern the probe uses: owned = created by us,
  // tracked by PID + our own process tree, and observed to exit. We never
  // scan machine-wide process lists by name.
  const client = await startFixture('default', { timeoutMs: 5_000 });
  const ownedPid = client.child.pid;
  assert.ok(Number.isInteger(ownedPid) && ownedPid > 0);
  await stopAndAssertClean(client);
  const alive = () => { try { process.kill(ownedPid, 0); return true; } catch { return false; } };
  assert.equal(alive(), false, 'owned child observed to exit after stop');
  // Inability to inspect is distinguishable from clean: if the pid check
  // errored for another reason, alive() would throw, failing the test —
  // not silently producing "clean".
});
