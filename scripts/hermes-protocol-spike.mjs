#!/usr/bin/env node
/**
 * DonutCode Phase-1 protocol spike: a minimal, standalone stdio JSON-RPC
 * client for line-delimited JSON-RPC 2.0 gateways (the installed Hermes
 * stdio gateway wire format: `python -m tui_gateway.entry`).
 *
 * Scope (Phase 1 only — review-correction revision):
 *   - JSON-RPC framing with byte-accurate line reassembly (split UTF-8 safe)
 *   - request/response correlation with strict envelope validation
 *   - finite startup + per-request timeouts, NO automatic resubmission
 *   - truthful completion: every settle cites its actual cause
 *       * spawn errors reject startup with SpawnError (never misreported as
 *         a readiness timeout)
 *       * a child that closes stdin while staying alive settles pending ops
 *         with StdioWriteError and never crashes the client with EPIPE
 *       * process exit settles startup + pending once with ProcessExitedError
 *   - stdin writes/streams carry error listeners; lost pipes are captured
 *     protocol errors, not unhandled exceptions
 *   - bounded, redaction-safe diagnostics: count/byte caps on protocol-error
 *     and unknown-event records, capped text samples, stderr ring buffer with
 *     content redaction, aggregate dropped counters. Raw frames/stderr are
 *     NOT persisted by default (samples are capped and scrubbed).
 *   - oversized frames fail explicitly (no unbounded buffering)
 *   - stop() is idempotent and bounded and reports one of three states:
 *       { observed: true,  code, signal }  — child exit was actually observed
 *       { observed: false, code: null, signal: null } — nothing was running
 *         (never started / already reaped) — no signal is invented
 *       { observed: false, code: null, signal: 'SIGKILL', confirmed: false,
 *         note } — escalation was sent but exit was NOT observed; the result
 *         is labeled unconfirmed, never fabricated into an observed exit
 *     Signals are only sent to a live child with a valid positive pid.
 *   - cleanup of EXACTLY the process this client spawned; never any other
 *   - fail closed: caller must pass an explicit command AND an explicit
 *     child environment. Omitted `env` is a construction error — the parent
 *     environment is never inherited by default.
 *
 * This module is NOT imported by DonutCode production startup and does not
 * import DonutCode production modules. It is exercised by
 * scripts/__tests__/hermes-protocol-spike.test.mjs (synthetic fixture only)
 * and by the Phase-1 native read-only probe.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class ProtocolError extends Error {
  constructor(message, info) { super(message); this.name = 'ProtocolError'; this.info = info ?? null; }
}
export class StartupTimeoutError extends ProtocolError { constructor(info) { super('startup timeout: gateway.ready not observed', info); this.name = 'StartupTimeoutError'; } }
export class RequestTimeoutError extends ProtocolError { constructor(method, id) { super(`request timed out: ${method} (id=${id})`); this.name = 'RequestTimeoutError'; this.method = method; this.id = id; } }
export class ProcessExitedError extends ProtocolError {
  constructor(code, signal) { super(`gateway process exited (code=${code}, signal=${signal})`); this.name = 'ProcessExitedError'; this.code = code; this.signal = signal; }
}
export class FrameTooLargeError extends ProtocolError {
  constructor(bytes, limit) { super(`frame too large: ${bytes}B > limit ${limit}B`); this.name = 'FrameTooLargeError'; }
}
export class SpawnError extends ProtocolError {
  constructor(message, info) { super(`spawn failed: ${message}`, info); this.name = 'SpawnError'; }
}
export class StdioWriteError extends ProtocolError {
  constructor(message) { super(`stdin write failed: ${message}`); this.name = 'StdioWriteError'; }
}

const DEFAULTS = Object.freeze({
  startupTimeoutMs: 15_000,
  requestTimeoutMs: 10_000,
  stopGraceMs: 3_000,
  maxFrameBytes: 1 << 20,
  maxStderrLines: 200,
  maxDiagnosticRecords: 100,   // per-array cap (protocolErrors, unknownEventKinds)
  maxDiagnosticBytes: 64 * 1024, // total bytes of retained diagnostic text
  maxTextSample: 160,          // per-record text sample cap (chars)
  readyEventType: 'gateway.ready',
});

/** Regex scrub applied to any retained diagnostic text (stderr, samples). */
const SENSITIVE_TEXT = /(sk-[A-Za-z0-9_-]{6,}|Bearer\s+\S+|BEGIN [A-Z ]*PRIVATE KEY|TOPSECRET\S*)/g;

function scrubText(text, cap) {
  let out = String(text).replace(SENSITIVE_TEXT, '[REDACTED]');
  if (out.length > cap) out = out.slice(0, cap);
  return out;
}

/**
 * Minimal allowlisted child environment. Never clones process.env: anything
 * not listed here (credentials, proxies, HERMES_* config, shell state) is
 * absent from the child by construction.
 */
export function buildChildEnv({ home, hermesHome, tmpDir, cwd, extraEnv = {} } = {}) {
  const env = {
    PATH: '/usr/bin:/bin:/usr/local/bin',
    LANG: 'C.UTF-8',
    TMPDIR: tmpDir ?? os.tmpdir(),
    HOME: home ?? os.tmpdir(),
  };
  if (hermesHome) env.HERMES_HOME = hermesHome;
  if (cwd) env.PWD = cwd;
  Object.assign(env, extraEnv);
  return env;
}

/** Wrap argv in an unprivileged network namespace (outbound + loopback denied). */
export function netnsArgv(argv) {
  return ['unshare', '--user', '--map-root-user', '--net', ...argv];
}

export class HermesProtocolClient {
  /**
   * @param {object} opts
   * @param {string[]} opts.command REQUIRED explicit argv. No fallback exists.
   * @param {object} opts.env REQUIRED allowlisted child env (see buildChildEnv).
   *        Omitted env is a TypeError — the parent environment is never
   *        inherited by default (fail-closed; regression-tested with a marker).
   * @param {number} [opts.startupTimeoutMs]
   * @param {number} [opts.requestTimeoutMs]
   * @param {number} [opts.stopGraceMs]
   * @param {number} [opts.maxFrameBytes]
   * @param {number} [opts.maxStderrLines]
   * @param {number} [opts.maxDiagnosticRecords]
   * @param {number} [opts.maxDiagnosticBytes]
   * @param {number} [opts.maxTextSample]
   * @param {string} [opts.readyEventType]
   */
  constructor(opts = {}) {
    if (!Array.isArray(opts.command) || opts.command.length === 0 || typeof opts.command[0] !== 'string') {
      throw new ProtocolError('explicit command argv is required (fail-closed: no PATH fallback)');
    }
    if (opts.env === undefined || opts.env === null || typeof opts.env !== 'object') {
      // Fail closed: an omitted environment must never mean "inherit parent".
      throw new TypeError('explicit child env is required (fail-closed: parent env is never inherited); use buildChildEnv()');
    }
    this.command = opts.command;
    this.cwd = opts.cwd;
    this.env = opts.env;
    this.startupTimeoutMs = opts.startupTimeoutMs ?? DEFAULTS.startupTimeoutMs;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
    this.stopGraceMs = opts.stopGraceMs ?? DEFAULTS.stopGraceMs;
    this.maxFrameBytes = opts.maxFrameBytes ?? DEFAULTS.maxFrameBytes;
    this.maxStderrLines = opts.maxStderrLines ?? DEFAULTS.maxStderrLines;
    this.maxDiagnosticRecords = opts.maxDiagnosticRecords ?? DEFAULTS.maxDiagnosticRecords;
    this.maxDiagnosticBytes = opts.maxDiagnosticBytes ?? DEFAULTS.maxDiagnosticBytes;
    this.maxTextSample = opts.maxTextSample ?? DEFAULTS.maxTextSample;
    this.readyEventType = opts.readyEventType ?? DEFAULTS.readyEventType;

    this.child = null;
    this.ready = false;
    this.exitInfo = null; // { code, signal } once actually observed
    this.stopped = false;
    this.spawnCount = 0;
    this.spawnError = null; // { message } when spawn itself failed
    this.signalLog = []; // every signal this client sent, for test/cleanup evidence
    this.pending = new Map(); // id -> { resolve, reject, timer, method }
    this.eventHandlers = new Map(); // type -> Set<fn>
    this.stderrLines = []; // bounded ring buffer, scrubbed
    this.diagnostics = {
      protocolErrors: [],    // { kind, sample(capped+scrubbed) } — malformed JSON / nonconforming
      unknownEventKinds: [], // event types with no handler (still delivered)
      orphanResponses: 0,    // responses after timeout/exit (never re-sent requests)
      responseEnvelopesRejected: 0, // malformed response envelopes (never resolve)
      framesReceived: 0,
      bytesReceived: 0,
      droppedProtocolErrors: 0,   // records dropped by the count/byte bound
      droppedUnknownEvents: 0,
    };
    this._diagBytes = 0;
    this._seq = 0;
    this._buf = []; // pending stdout bytes (per-frame only; bounded by maxFrameBytes)
    this._bufBytes = 0;
    this._readyWaiters = [];
    this._readySettled = false;
    this._startupTimer = null;
    this._stopPromise = null;
    this._stopWaiters = [];
    this._stopKillTimer = null;
    this._stopUnconfirmedTimer = null;
    this._stdioBroken = false;
    this._stdioError = null;
    this._stdinEnded = false;
    this._onStdoutChunk = this._onStdoutChunk.bind(this);
    this._onStderrChunk = this._onStderrChunk.bind(this);
  }

  /** Spawn the explicitly configured command and wait for readiness. */
  start() {
    if (this.child || this._readySettled || this._readyPromise) {
      return this._readyPromise ?? Promise.resolve();
    }
    this.spawnCount += 1;
    let child;
    try {
      child = spawn(this.command[0], this.command.slice(1), {
        cwd: this.cwd,
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      // spawn() throws synchronously for e.g. invalid argv — same contract as
      // the async 'error' event below.
      this.spawnError = { message: err?.message ?? String(err) };
      this._failStartup(new SpawnError(this.spawnError.message, { command: this.command[0] }));
      return this._readyPromise;
    }
    this.child = child;
    child.stdout.on('data', this._onStdoutChunk);
    child.stderr.on('data', this._onStderrChunk);
    // R1: stdin stream errors (EPIPE etc.) are captured protocol failures,
    // never unhandled 'error' events on the stream.
    child.stdin.on('error', (err) => this._onStdioError(err));
    child.on('error', (err) => {
      // Async spawn failure: ENOENT, EACCES, E2BIG ... (never a readiness
      // timeout — report the actual failure).
      this.spawnError = { message: err?.message ?? String(err) };
      this._failAll(new SpawnError(this.spawnError.message, { command: this.command[0] }));
      this._failStartup(new SpawnError(this.spawnError.message, { command: this.command[0] }));
      // Nothing was (successfully) started; do not signal anything.
      this.stopped = true;
    });
    child.on('exit', (code, signal) => {
      this.exitInfo = { code, signal };
      if (this._stopKillTimer) { clearTimeout(this._stopKillTimer); this._stopKillTimer = null; }
      if (this._stopUnconfirmedTimer) { clearTimeout(this._stopUnconfirmedTimer); this._stopUnconfirmedTimer = null; }
      this._failAll(new ProcessExitedError(code, signal));
      this._failStartup(new ProcessExitedError(code, signal));
      this._resolveStopWaiters({ observed: true, code, signal });
    });
    this._readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._startupTimer = null;
        this._failStartup(new StartupTimeoutError({
          timeoutMs: this.startupTimeoutMs,
          stderrTail: this.stderrLines.slice(-5),
        }));
        this.stop().catch(() => {});
      }, this.startupTimeoutMs);
      this._startupTimer = timer;
      this._readyWaiters.push({ resolve, reject, timer });
    });
    return this._readyPromise;
  }

  _onStderrChunk(chunk) {
    for (const line of String(chunk).split('\n')) {
      if (!line) continue;
      this.stderrLines.push(scrubText(line, this.maxTextSample));
      if (this.stderrLines.length > this.maxStderrLines) this.stderrLines.shift();
    }
  }

  _onStdioError(err) {
    // Lost pipe (child closed its stdin but may still be alive) or any other
    // stdio failure: settle pending + startup once with the actual cause and
    // mark the transport broken. No unhandled EPIPE can crash the client.
    if (this._stdioBroken) return;
    this._stdioBroken = true;
    this._stdioError = { message: err?.message ?? String(err), code: err?.code ?? null };
    const cause = new StdioWriteError(this._stdioError.message);
    this._failAll(cause);
    this._failStartup(cause);
  }

  _resolveReadyWaiters(ok, err) {
    for (const w of this._readyWaiters.splice(0)) {
      clearTimeout(w.timer);
      if (ok) w.resolve(); else w.reject(err);
    }
  }

  /** Settle startup exactly once with the given error (success path: _onReady). */
  _failStartup(err) {
    if (this._readySettled) return;
    this._readySettled = true;
    if (this._startupTimer) { clearTimeout(this._startupTimer); this._startupTimer = null; }
    this._resolveReadyWaiters(false, err);
    // A failed startup must not leave a live child behind.
    if (!this.stopped) this.stop().catch(() => {});
  }

  _onReady() {
    if (this._readySettled) return;
    this._readySettled = true;
    if (this._startupTimer) { clearTimeout(this._startupTimer); this._startupTimer = null; }
    this._resolveReadyWaiters(true);
  }

  _onStdoutChunk(chunk) {
    this.diagnostics.bytesReceived += chunk.length;
    // Byte-accurate line reassembly: UTF-8 multi-byte sequences split across
    // chunks are preserved until the line's newline arrives, then decoded whole.
    let idx;
    let start = 0;
    while ((idx = chunk.indexOf(0x0A, start)) !== -1) {
      const piece = chunk.subarray(start, idx);
      start = idx + 1;
      this._pushLine(piece);
    }
    if (start < chunk.length) {
      const rest = chunk.subarray(start);
      this._buf.push(rest);
      this._bufBytes += rest.length;
      if (this._bufBytes > this.maxFrameBytes) {
        this._failAll(new FrameTooLargeError(this._bufBytes, this.maxFrameBytes));
        this.stop().catch(() => {});
      }
    }
  }

  /** Bounded diagnostic record store with aggregate dropped counters. */
  _pushDiagnostic(list, droppedKey, record) {
    const size = (record.sample?.length ?? 0) + 8;
    if (list.length >= this.maxDiagnosticRecords || this._diagBytes + size > this.maxDiagnosticBytes) {
      this.diagnostics[droppedKey] += 1;
      return;
    }
    this._diagBytes += size;
    list.push(record);
  }

  _pushLine(bytesPiece) {
    let lineBuf;
    if (this._buf.length) {
      this._buf.push(bytesPiece);
      lineBuf = Buffer.concat(this._buf);
      this._buf = [];
      this._bufBytes = 0;
    } else {
      lineBuf = bytesPiece;
    }
    if (lineBuf.length > this.maxFrameBytes) {
      this._failAll(new FrameTooLargeError(lineBuf.length, this.maxFrameBytes));
      this.stop().catch(() => {});
      return;
    }
    const line = lineBuf.toString('utf8').trim();
    if (!line) return;
    this.diagnostics.framesReceived += 1;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this._pushDiagnostic(this.diagnostics.protocolErrors, 'droppedProtocolErrors', {
        kind: 'parse-error',
        sample: scrubText(line, this.maxTextSample),
      });
      return;
    }
    // Event frames: {jsonrpc, method:'event', params:{type, payload}}
    if (msg && typeof msg === 'object' && msg.method === 'event' && msg.params && typeof msg.params === 'object') {
      const type = msg.params.type;
      if (typeof type !== 'string') {
        this._pushDiagnostic(this.diagnostics.protocolErrors, 'droppedProtocolErrors', {
          kind: 'malformed-event',
          sample: scrubText(line, this.maxTextSample),
        });
        return;
      }
      if (!this.eventHandlers.has(type)) {
        this._pushDiagnostic(this.diagnostics.unknownEventKinds, 'droppedUnknownEvents', { kind: type });
      }
      if (type === this.readyEventType && !this.ready) {
        this.ready = true;
        this._onReady();
      }
      for (const fn of this.eventHandlers.get(type) ?? []) {
        try { fn(msg.params); } catch { /* handler errors are isolated */ }
      }
      return;
    }
    // Response frames: strict envelope validation. A frame must carry a valid
    // id present in the pending map AND a result OR error — malformed
    // envelopes are rejected explicitly and never resolve a request.
    if (msg && typeof msg === 'object' && 'id' in msg && msg.id !== null) {
      const id = String(msg.id);
      const entry = this.pending.get(id);
      const hasResult = Object.prototype.hasOwnProperty.call(msg, 'result');
      const hasError = msg.error !== undefined && msg.error !== null;
      if (!entry || (!hasResult && !hasError)) {
        if (!entry) this.diagnostics.orphanResponses += 1; // late/unknown id: never re-sent
        this.diagnostics.responseEnvelopesRejected += 1;
        return;
      }
      this.pending.delete(id);
      clearTimeout(entry.timer);
      if (hasError) entry.reject(new ProtocolError(`rpc error ${msg.error.code}: ${msg.error.message}`, msg.error));
      else entry.resolve(msg.result);
      return;
    }
    this._pushDiagnostic(this.diagnostics.protocolErrors, 'droppedProtocolErrors', {
      kind: 'nonconforming-frame',
      sample: scrubText(line, this.maxTextSample),
    });
  }

  /**
   * Send one request. Exactly one attempt: a timeout settles the returned
   * promise once with RequestTimeoutError and the request is NEVER re-sent.
   * A broken stdin (lost pipe) settles with StdioWriteError.
   */
  request(method, params, { timeoutMs } = {}) {
    if (this._stdioBroken) {
      return Promise.reject(new StdioWriteError(this._stdioError?.message ?? 'stdio closed'));
    }
    if (this.spawnError) {
      return Promise.reject(new SpawnError(this.spawnError.message));
    }
    if (!this.child || this.exitInfo || this.stopped) {
      return Promise.reject(new ProcessExitedError(this.exitInfo?.code ?? null, this.exitInfo?.signal ?? null));
    }
    const id = String(++this._seq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); // late response becomes an orphan, not a retry
        reject(new RequestTimeoutError(method, id));
      }, timeoutMs ?? this.requestTimeoutMs);
      const entry = { resolve, reject, timer, method };
      this.pending.set(id, entry);
      const frame = JSON.stringify({ jsonrpc: '2.0', id: Number(id), method, params: params ?? {} });
      this.child.stdin.write(`${frame}\n`, (err) => {
        if (err && this.pending.get(id) === entry) {
          // Write-level failure: settle THIS request immediately with the
          // actual cause; the stream error listener handles the rest.
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new StdioWriteError(err.message));
        }
      });
    });
  }

  on(eventType, fn) {
    if (!this.eventHandlers.has(eventType)) this.eventHandlers.set(eventType, new Set());
    this.eventHandlers.get(eventType).add(fn);
    return () => this.eventHandlers.get(eventType)?.delete(fn);
  }

  _failAll(err) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  _resolveStopWaiters(result) {
    const waiters = this._stopWaiters.splice(0);
    for (const w of waiters) w(result);
  }

  /**
   * Orderly shutdown of EXACTLY the spawned process: close stdin, SIGTERM,
   * wait graceMs, then SIGKILL scoped to this child's pid as a last resort.
   * Idempotent. The resolved result distinguishes:
   *   - observed exit            { observed: true, code, signal }
   *   - nothing running          { observed: false, code: null, signal: null }
   *   - sent SIGKILL, exit NOT
   *     observed within the bound{ observed: false, signal: 'SIGKILL',
   *                               confirmed: false, note }
   * No exit/kill is ever fabricated, and no signal is sent to an invalid pid.
   */
  stop({ graceMs } = {}) {
    if (this._stopPromise) return this._stopPromise;
    this._stopWaiters = [];
    const grace = graceMs ?? this.stopGraceMs;
    this.stopped = true;

    // Nothing was ever started, or the child already exited: report the
    // observed state, signal nothing.
    if (!this.child || this.exitInfo || this.spawnError) {
      this._stopPromise = Promise.resolve(
        this.exitInfo
          ? { observed: true, ...this.exitInfo }
          : { observed: false, code: null, signal: null, note: this.spawnError ? 'spawn failed; nothing to signal' : 'not started' },
      );
      return this._stopPromise;
    }

    this._stopPromise = new Promise((resolve) => {
      this._stopWaiters.push(resolve);
      const child = this.child;
      const pid = child.pid;
      try { child.stdin.end(); } catch { /* already closed */ }

      if (!Number.isInteger(pid) || pid <= 0) {
        // Cannot signal anything — report honestly and wait for the exit event.
        this.signalLog.push({ pid: pid ?? null, signal: null, skipped: 'invalid pid' });
      } else {
        this.signalLog.push({ pid, signal: 'SIGTERM' });
        try { child.kill('SIGTERM'); } catch { /* exited between checks */ }
      }

      const prevExit = this.exitInfo;
      child.once('exit', (code, signal) => {
        if (!this.exitInfo) {
          this.exitInfo = { code, signal };
          this._failAll(new ProcessExitedError(code, signal));
        }
        if (this._stopUnconfirmedTimer) { clearTimeout(this._stopUnconfirmedTimer); this._stopUnconfirmedTimer = null; }
        if (this._stopKillTimer) { clearTimeout(this._stopKillTimer); this._stopKillTimer = null; }
        this._resolveStopWaiters({ observed: true, code, signal });
      });

      this._stopKillTimer = setTimeout(() => {
        this._stopKillTimer = null;
        if (this.exitInfo) return; // already reaped; nothing to do
        if (Number.isInteger(pid) && pid > 0) {
          this.signalLog.push({ pid, signal: 'SIGKILL' });
          let sent = false;
          try { sent = child.kill('SIGKILL'); } catch { sent = false; }
          if (!sent) { this._resolveStopWaiters({ observed: true, ...prevExit ?? { code: null, signal: null } }); return; }
        }
        // Bounded unconfirmed window: if the kernel reaps the child but the
        // exit event is somehow lost, report UNCONFIRMED — never invent an
        // observed exit.
        this._stopUnconfirmedTimer = setTimeout(() => {
          this._stopUnconfirmedTimer = null;
          this._resolveStopWaiters({
            observed: false,
            code: null,
            signal: 'SIGKILL',
            confirmed: false,
            note: 'SIGKILL sent; exit not observed within bound',
          });
        }, Math.max(grace, 1_000));
      }, grace);
    });
    return this._stopPromise;
  }

  /**
   * Bounded, redaction-safe diagnostics. Raw frames are never included;
   * text samples are capped and scrubbed; stderr is a scrubbed ring buffer;
   * per-array count/byte bounds hold with aggregate dropped counters.
   */
  snapshot() {
    return {
      spawnCount: this.spawnCount,
      spawnError: this.spawnError,
      exitInfo: this.exitInfo,
      signalLog: [...this.signalLog],
      stderrLines: [...this.stderrLines],
      pendingCount: this.pending.size,
      stdioBroken: this._stdioBroken,
      stdioError: this._stdioError,
      ...this.diagnostics,
      unknownEventKinds: [...new Set(this.diagnostics.unknownEventKinds)],
      bounds: {
        maxDiagnosticRecords: this.maxDiagnosticRecords,
        maxDiagnosticBytes: this.maxDiagnosticBytes,
        maxTextSample: this.maxTextSample,
        maxStderrLines: this.maxStderrLines,
      },
    };
  }
}

/** Probe marker so logs can always distinguish synthetic from native runs. */
export function fixtureArgv(scriptName, { fixturePath, nodeBin = process.execPath, extra = [] } = {}) {
  return [nodeBin, fixturePath, '--script', scriptName, ...extra];
}

/** Small helper for tests/probes: a temp workspace with fresh HOME/HERMES_HOME. */
export function makeIsolatedDirs(rootPrefix = 'dc-phase1-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), rootPrefix));
  const home = path.join(root, 'home');
  const hermesHome = path.join(root, 'hermes-home');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  return { root, home, hermesHome, tmp };
}
