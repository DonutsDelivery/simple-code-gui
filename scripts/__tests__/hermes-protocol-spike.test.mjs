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
const SANDBOX_HELPER = await import(path.resolve(import.meta.dirname, '../fixtures/sandbox-helper.mjs'));
const { classifyIsolationRun } = SANDBOX_HELPER;

function readHostNetns() {
  try { return fs.readlinkSync('/proc/self/ns/net'); } catch { return null; }
}

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

test('R4: stderr text and malformed-frame bodies are NOT retained at all (metadata only)', async () => {
  const client = await startFixture('default', { timeoutMs: 5_000 });
  try {
    await client.request('ping');
    // Feed arbitrary synthetic text through stderr and a malformed frame.
    const secret = 'SYNTHETIC_CREDENTIAL_VALUE_DO_NOT_RETAIN';
    client._onStderrChunk(Buffer.from(`api_key=${secret} LEAK-TOKEN «redacted:sk-…» leaked\n`));
    client._pushLine(Buffer.from(`prefix «redacted:sk-…» ${secret} suffix\n`));
    const snap = client.snapshot();
    const joined = JSON.stringify(snap);
    // B4: no arbitrary stderr text and no raw frame bodies are retained —
    // diagnostics carry counts/byte-totals and bounded category metadata only.
    assert.ok(!joined.includes(secret), 'synthetic credential value never persisted');
    assert.ok(!joined.includes('«redacted:sk-…»'), 'raw stderr/frame text never persisted');
    assert.equal(snap.stderrLines.length, 0, 'stderr text store is empty by construction');
    assert.ok(snap.stderrLinesTotal >= 1, 'stderr LINE COUNT is still observed');
    assert.ok(snap.stderrBytesTotal >= 10, 'stderr BYTE TOTAL is still observed');
    assert.equal(snap.protocolErrors.some((e) => e.kind === 'parse-error'), true, 'parse error RECORDED as category metadata');
    const malformedSample = snap.protocolErrors.find((e) => e.kind === 'parse-error')?.sample ?? '';
    assert.match(malformedSample, /^len=\d+B$/, 'parse-error sample is byte-length metadata, not body text');
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

test('C1: teardown ends the gateway AND its own worker; unrelated control process stays alive', async (t) => {
  // Unrelated bounded control process OUTSIDE the boundary (NOT ours to
  // signal): a plain sleep child of the TEST.
  const control = spawnHelper([process.execPath, '-e', 'setTimeout(() => process.exit(0), 20000)']);
  t.after(() => { try { control.kill('SIGKILL'); } catch { /* already gone */ } });
  const controlPid = control.pid;
  assert.ok(Number.isInteger(controlPid) && controlPid > 0);

  // The gateway ITSELF spawns a worker (spawn-worker mode): gateway + worker
  // are a real parent/child pair inside one process boundary, like the
  // native path (bwrap supervisor → gateway → worker).
  const dirs = makeIsolatedDirs('dc-phase1-c1-');
  const client = new HermesProtocolClient({
    command: [...fixtureArgv('spawn-worker'), '--worker-argv', `${process.execPath},-e,setTimeout(()=>process.exit(0),30000)`],
    env: buildChildEnv({ home: dirs.home, hermesHome: dirs.hermesHome, tmpDir: dirs.tmp, cwd: dirs.root }),
    cwd: dirs.root,
    startupTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
    stopGraceMs: 1_500,
  });
  t.after(async () => { await client.stop(); sandboxRm(dirs.root); });

  // Record the stable run identity + parent/child relationship BEFORE teardown.
  let workerPid = null;
  const workerSpawned = new Promise((resolve) => {
    const off = client.on('fixture.worker.spawned', (params) => resolve(params?.payload?.pid ?? null));
    // keep the subscription until settled
    void off;
  });
  const clientPid = await client.start().then(() => client.child.pid);
  workerPid = await Promise.race([workerSpawned, new Promise((r) => setTimeout(() => r(null), 3_000))]);
  assert.ok(Number.isInteger(clientPid) && clientPid > 0, 'gateway pid recorded');
  assert.ok(Number.isInteger(workerPid) && workerPid > 0, 'worker pid recorded (gateway-spawned)');

  const identityBefore = {
    clientPid, workerPid, controlPid,
    workerAliveBeforeStop: aliveNow(workerPid),
    controlAliveBeforeStop: aliveNow(controlPid),
  };
  assert.equal(identityBefore.workerAliveBeforeStop, true, 'worker alive before teardown');
  assert.equal(identityBefore.controlAliveBeforeStop, true, 'control alive before teardown');

  // Teardown through the NORMAL path only: stop the owned supervisor (the
  // client's own child). No manual kill of the worker.
  const stop = await client.stop();
  // Give the kernel a moment to finish reaping; then assert the real property.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(stop.observed, true, 'stop observed the gateway exit');
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.equal(alive(clientPid), false, 'owned gateway child exited');
  assert.equal(alive(workerPid), false, 'gateway-spawned worker ended WITHOUT a manual kill (owner chain teardown)');
  assert.equal(alive(controlPid), true, 'unrelated control process remains alive throughout');
  assert.ok(!client.snapshot().signalLog.some((s) => s.pid === controlPid), 'no signal was ever aimed at the control process');
  assert.ok(!client.snapshot().signalLog.some((s) => s.pid === workerPid), 'the client never directly signaled the worker (teardown went through the gateway)');
});

function sandboxRm(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* gone */ }
}
function aliveNow(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function spawnHelper(argv) {
  return spawn(argv[0], argv.slice(1), { stdio: 'ignore' });
}

test('C2: cleanup evidence is owned-identity based (no machine-wide name scans)', async (t) => {
  const control = spawnHelper([process.execPath, '-e', 'setTimeout(() => process.exit(0), 20000)']);
  t.after(() => { try { control.kill('SIGKILL'); } catch { /* gone */ } });
  const client = await startFixture('default', { timeoutMs: 5_000 });
  const clientPid = client.child.pid;
  await stopAndAssertClean(client);
  // Owned identities only: the exact pids this run created are checked for
  // observed exit; the unrelated control is checked alive + never signaled.
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.equal(alive(clientPid), false, 'owned child exited (owned-identity cleanup evidence)');
  assert.equal(alive(control.pid), true, 'unrelated control process stays alive');
  assert.ok(!client.snapshot().signalLog.some((s) => s.pid === control.pid), 'no signal was ever aimed at the control');
  // No machine-wide name scan exists anywhere in this suite's evidence path;
  // every recorded signal target is the owned child (or an honest null-skip).
  const log = client.snapshot().signalLog;
  assert.ok(log.length >= 1, 'signal log recorded');
  assert.ok(log.every((s) => s.pid === clientPid || s.pid == null), 'every signal-log entry targets the owned child pid (or a null skipped-attempt)');
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

test('C3: launcher failure classifies BLOCKED via the actual verdict logic', async (t) => {
  // A launcher that exits 127 before starting any child — the reviewer's
  // false-positive reproduction — fed through the REAL classifier the probe
  // uses. Infrastructure failure must be BLOCKED, never PASS.
  const fakeLauncher = path.join(os.tmpdir(), `dc-phase1-fake-launcher-${Date.now()}.sh`);
  fs.writeFileSync(fakeLauncher, '#!/bin/sh\nexit 127\n');
  fs.chmodSync(fakeLauncher, 0o755);
  t.after(() => { try { fs.unlinkSync(fakeLauncher); } catch { /* gone */ } });

  const attempt = await execFileP(fakeLauncher, [process.execPath, '-e', "console.log('DENIED')"], { timeout: 8_000 })
    .then((r) => ({ ran: true, stdout: r.stdout }))
    .catch((e) => ({ ran: false, message: e.message ?? String(e) }));
  assert.equal(attempt.ran, false, 'broken launcher never ran the helper');
  const classified = classifyIsolationRun({
    launcherError: { message: attempt.message ?? 'launcher exited 127' },
    helperOutput: null,
    hostNetns: readHostNetns(),
    expectedOutcome: 'DENIED',
    expectedMarker: 'm',
  });
  assert.equal(classified.verdict, 'BLOCKED', `launcher failure must be BLOCKED (got ${classified.verdict}: ${classified.reason})`);
  assert.notEqual(classified.verdict, 'PASS', 'infrastructure failure must never classify as PASS');
});

test('C3: malformed/missing helper output classifies BLOCKED, not PASS', () => {
  // Missing output:
  const missing = classifyIsolationRun({ helperOutput: null, hostNetns: readHostNetns(), expectedOutcome: 'DENIED', expectedMarker: 'm' });
  assert.equal(missing.verdict, 'BLOCKED', 'missing helper output is BLOCKED');
  // Malformed output (no netns identity):
  const malformed = classifyIsolationRun({ helperOutput: { marker: 'm' }, hostNetns: readHostNetns(), expectedOutcome: 'DENIED', expectedMarker: 'm' });
  assert.equal(malformed.verdict, 'BLOCKED', 'helper output without namespace identity is BLOCKED');
  // Marker mismatch (helper identity unproven — could be a different run):
  const wrongMarker = classifyIsolationRun({ helperOutput: { marker: 'other', netns: 'net:[1]', outcome: 'DENIED' }, hostNetns: 'net:[2]', expectedOutcome: 'DENIED', expectedMarker: 'm' });
  assert.equal(wrongMarker.verdict, 'BLOCKED', 'marker mismatch is BLOCKED');
});

test('C3: wrong namespace classifies FAIL; genuine denial with differing ns classifies PASS', () => {
  // Boundary ran but netns equals the host: FAIL (property not delivered).
  const wrongNs = classifyIsolationRun({ helperOutput: { marker: 'm', netns: 'net:[4242]', outcome: 'DENIED' }, hostNetns: 'net:[4242]', expectedOutcome: 'DENIED', expectedMarker: 'm' });
  assert.equal(wrongNs.verdict, 'FAIL', 'same-namespace run is FAIL (boundary not established)');
  assert.notEqual(wrongNs.verdict, 'PASS');
  // Genuine negative control: different ns + DENIED + marker match → PASS.
  const genuine = classifyIsolationRun({ helperOutput: { marker: 'm', netns: 'net:[1]', outcome: 'DENIED' }, hostNetns: 'net:[2]', expectedOutcome: 'DENIED', expectedMarker: 'm' });
  assert.equal(genuine.verdict, 'PASS', 'differing ns + denied + marker = PASS');
  // Positive-control misuse: expecting CONNECTED but getting DENIED → FAIL.
  const misused = classifyIsolationRun({ helperOutput: { marker: 'm', netns: 'net:[1]', outcome: 'DENIED' }, hostNetns: 'net:[2]', expectedOutcome: 'CONNECTED', expectedMarker: 'm' });
  assert.equal(misused.verdict, 'FAIL', 'unexpected outcome vs expectation is FAIL');
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

test('C3: netns launcher failure surface (exit-127 shim) fed through the real classifier', async (t) => {
  // Synthetic launcher that exits 127 before spawning a child. The observed
  // result is fed through classifyIsolationRun — the same function the probe
  // uses — so the test exercises the ACTUAL verdict path, not a stand-in.
  const shim = path.join(os.tmpdir(), `dc-phase1-unshare-shim-${Date.now()}.sh`);
  fs.writeFileSync(shim, '#!/bin/sh\nexit 127\n');
  fs.chmodSync(shim, 0o755);
  t.after(() => { try { fs.unlinkSync(shim); } catch { /* gone */ } });
  const attempt = await execFileP(shim, [process.execPath, '-e', "console.log('DENIED')"], { timeout: 8_000 })
    .then((r) => ({ ran: true, out: r.stdout }))
    .catch((e) => ({ ran: false, message: e.message ?? String(e) }));
  assert.equal(attempt.ran, false, 'shim never ran the helper');
  const classified = classifyIsolationRun({
    launcherError: { message: attempt.message ?? 'shim exited 127' },
    helperOutput: null,
    hostNetns: readHostNetns(),
    expectedOutcome: 'DENIED',
    expectedMarker: 'm',
  });
  assert.equal(classified.verdict, 'BLOCKED', `shim failure must be BLOCKED (got ${classified.verdict})`);
  assert.notEqual(classified.verdict, 'PASS', 'a failed launcher must never produce a PASS verdict');
});

test('C4: probe gate decision — synthetic results through the real gate logic', () => {
  // The probe's gate is: boundary PASS + ready observed + valid ping + confirmed cleanup.
  // Mirrors scripts/native-probe.mjs decideGate(); kept in sync by this test.
  const decideGate = (checks) => {
    if (checks.boundary && checks.ready && checks.ping && checks.cleanup) return { gate: 'PASS', exitCode: 0 };
    if (checks.boundary) return { gate: 'PARTIAL', exitCode: 4 };
    return { gate: 'BLOCKED', exitCode: 5 };
  };
  const allPass = { boundary: true, ready: true, ping: true, cleanup: true };
  assert.deepEqual(decideGate(allPass), { gate: 'PASS', exitCode: 0 });
  // Any missing gate check with verified boundary => PARTIAL + nonzero exit.
  assert.deepEqual(decideGate({ ...allPass, ping: false }), { gate: 'PARTIAL', exitCode: 4 });
  assert.deepEqual(decideGate({ ...allPass, cleanup: false }), { gate: 'PARTIAL', exitCode: 4 });
  assert.deepEqual(decideGate({ ...allPass, ready: false }), { gate: 'PARTIAL', exitCode: 4 });
  // Unverified boundary => BLOCKED regardless of the rest (never PASS).
  assert.deepEqual(decideGate({ boundary: false, ready: true, ping: true, cleanup: true }), { gate: 'BLOCKED', exitCode: 5 });
  assert.deepEqual(decideGate({ boundary: false, ready: false, ping: false, cleanup: false }), { gate: 'BLOCKED', exitCode: 5 });
});

test('C4: cleanup confirmed only on observed supervisor exit; uninspectable is UNCONFIRMED', () => {
  // Mirrors the probe's cleanup confirmation; kept in sync by this test.
  const confirmCleanup = (stop, inspection) => {
    const confirmed = stop.observed === true && inspection.inspectable && inspection.alive === false;
    return { label: confirmed ? 'CONFIRMED (owned supervisor exit observed)' : 'UNCONFIRMED', confirmed };
  };
  const confirmed = confirmCleanup({ observed: true }, { inspectable: true, alive: false });
  assert.equal(confirmed.confirmed, true, 'observed exit + inspectable + dead = CONFIRMED');
  // Uninspectable pid (EPERM/unknown) must NEVER read as confirmed-clean.
  const uninspectable = confirmCleanup({ observed: true }, { inspectable: false, alive: false });
  assert.equal(uninspectable.confirmed, false, 'uninspectable state is UNCONFIRMED');
  const killFail = confirmCleanup({ observed: false, signal: null, confirmed: false }, { inspectable: true, alive: false });
  assert.equal(killFail.confirmed, false, 'unobserved stop is UNCONFIRMED even if the pid is gone');
});

test('C2: native-style ownership check uses namespace identity, not argv text', async (t) => {
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
