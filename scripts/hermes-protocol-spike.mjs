#!/usr/bin/env node
/**
 * DonutCode Phase-1 protocol spike: a minimal, standalone stdio JSON-RPC
 * client for line-delimited JSON-RPC 2.0 gateways (the installed Hermes
 * stdio gateway wire format: `python -m tui_gateway.entry`).
 *
 * Scope (Phase 1 only):
 *   - JSON-RPC framing with byte-accurate line reassembly (split UTF-8 safe)
 *   - request/response correlation, event demux (events never resolve requests)
 *   - finite startup + per-request timeouts, NO automatic resubmission
 *   - explicit process-exit handling (pending ops settle once, no restart)
 *   - protocol output kept separate from stderr; bounded stderr ring buffer
 *   - oversized frames fail explicitly (no unbounded buffering)
 *   - cleanup of EXACTLY the process this client spawned: orderly SIGTERM
 *     first, scoped SIGKILL last resort; never touches any other process
 *   - fail closed: the caller must pass an explicit command; there is no
 *     fallback to `hermes` from PATH and no default host
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

const DEFAULTS = Object.freeze({
  startupTimeoutMs: 15_000,
  requestTimeoutMs: 10_000,
  stopGraceMs: 3_000,
  maxFrameBytes: 1 << 20,
  maxStderrLines: 200,
  readyEventType: 'gateway.ready',
});

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
   * @param {string} [opts.cwd]
   * @param {object} [opts.env] allowlisted child env (see buildChildEnv)
   * @param {number} [opts.startupTimeoutMs]
   * @param {number} [opts.requestTimeoutMs]
   * @param {number} [opts.stopGraceMs]
   * @param {number} [opts.maxFrameBytes]
   * @param {number} [opts.maxStderrLines]
   * @param {string} [opts.readyEventType]
   */
  constructor(opts = {}) {
    if (!Array.isArray(opts.command) || opts.command.length === 0 || typeof opts.command[0] !== 'string') {
      throw new ProtocolError('explicit command argv is required (fail-closed: no PATH fallback)');
    }
    this.command = opts.command;
    this.cwd = opts.cwd;
    this.env = opts.env;
    this.startupTimeoutMs = opts.startupTimeoutMs ?? DEFAULTS.startupTimeoutMs;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
    this.stopGraceMs = opts.stopGraceMs ?? DEFAULTS.stopGraceMs;
    this.maxFrameBytes = opts.maxFrameBytes ?? DEFAULTS.maxFrameBytes;
    this.maxStderrLines = opts.maxStderrLines ?? DEFAULTS.maxStderrLines;
    this.readyEventType = opts.readyEventType ?? DEFAULTS.readyEventType;

    this.child = null;
    this.ready = false;
    this.exitInfo = null; // { code, signal } once reaped
    this.stopped = false;
    this.spawnCount = 0;
    this.signalLog = []; // every signal this client sent, for test/cleanup evidence
    this.pending = new Map(); // id -> { resolve, reject, timer, method }
    this.eventHandlers = new Map(); // type -> Set<fn>
    this.stderrLines = []; // bounded ring buffer, protocol-separated
    this.diagnostics = {
      protocolErrors: [],   // { kind, sample } — malformed JSON / nonconforming frames
      unknownEventKinds: [],// event types with no handler (still delivered)
      orphanResponses: 0,   // responses after timeout/exit (never re-sent requests)
      framesReceived: 0,
      bytesReceived: 0,
    };
    this._seq = 0;
    this._buf = []; // pending stdout bytes (per-frame only; bounded by maxFrameBytes)
    this._bufBytes = 0;
    this._readyWaiters = [];
    this._stopPromise = null;
    this._onStdoutChunk = this._onStdoutChunk.bind(this);
  }

  /** Spawn the explicitly configured command and wait for readiness. */
  start() {
    if (this.child) return this._readyPromise ?? Promise.resolve();
    this.spawnCount += 1;
    const child = spawn(this.command[0], this.command.slice(1), {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout.on('data', this._onStdoutChunk);
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (!line) continue;
        this.stderrLines.push(line);
        if (this.stderrLines.length > this.maxStderrLines) this.stderrLines.shift();
      }
    });
    child.on('error', (err) => this._failAll(new ProcessExitedError(null, `spawn-error: ${err.message}`)));
    child.on('exit', (code, signal) => {
      this.exitInfo = { code, signal };
      this._failAll(new ProcessExitedError(code, signal));
      this._resolveReadyWaiters(false, new ProcessExitedError(code, signal));
    });
    this._readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new StartupTimeoutError({ timeoutMs: this.startupTimeoutMs, stderrTail: this.stderrLines.slice(-5) }));
        this.stop().catch(() => {});
      }, this.startupTimeoutMs);
      this._readyWaiters.push({ resolve, reject, timer });
    });
    return this._readyPromise;
  }

  _resolveReadyWaiters(ok, err) {
    for (const w of this._readyWaiters.splice(0)) {
      clearTimeout(w.timer);
      if (ok) w.resolve(); else w.reject(err);
    }
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
      this.diagnostics.protocolErrors.push({ kind: 'parse-error', sample: line.slice(0, 200) });
      return;
    }
    if (msg && typeof msg === 'object' && msg.method === 'event' && msg.params) {
      const type = msg.params.type;
      if (!this.eventHandlers.has(type)) this.diagnostics.unknownEventKinds.push(type);
      if (type === this.readyEventType && !this.ready) {
        this.ready = true;
        this._resolveReadyWaiters(true);
      }
      for (const fn of this.eventHandlers.get(type) ?? []) {
        try { fn(msg.params); } catch { /* handler errors are isolated */ }
      }
      return;
    }
    if (msg && typeof msg === 'object' && 'id' in msg && (msg.result !== undefined || msg.error !== undefined)) {
      const id = String(msg.id);
      const entry = this.pending.get(id);
      if (!entry) { this.diagnostics.orphanResponses += 1; return; } // late/unknown id: never re-sent
      this.pending.delete(id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new ProtocolError(`rpc error ${msg.error.code}: ${msg.error.message}`, msg.error));
      else entry.resolve(msg.result);
      return;
    }
    this.diagnostics.protocolErrors.push({ kind: 'nonconforming-frame', sample: line.slice(0, 200) });
  }

  /**
   * Send one request. Exactly one attempt: a timeout settles the returned
   * promise once with RequestTimeoutError and the request is NEVER re-sent.
   */
  request(method, params, { timeoutMs } = {}) {
    if (!this.child || this.exitInfo || this.stopped) {
      return Promise.reject(new ProcessExitedError(this.exitInfo?.code ?? null, this.exitInfo?.signal ?? null));
    }
    const id = String(++this._seq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); // late response becomes an orphan, not a retry
        reject(new RequestTimeoutError(method, id));
      }, timeoutMs ?? this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      const frame = JSON.stringify({ jsonrpc: '2.0', id: Number(id), method, params: params ?? {} });
      this.child.stdin.write(`${frame}\n`, () => { /* written */ });
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

  /**
   * Orderly shutdown of EXACTLY the spawned process: close stdin, SIGTERM,
   * wait stopGraceMs, then SIGKILL scoped to this child's pid as a last
   * resort. Never signals any other process. Idempotent.
   */
  stop({ graceMs } = {}) {
    if (this._stopPromise) return this._stopPromise;
    const grace = graceMs ?? this.stopGraceMs;
    this.stopped = true;
    this._stopPromise = new Promise((resolve) => {
      const child = this.child;
      if (!child || this.exitInfo) { resolve(this.exitInfo ?? { code: null, signal: null }); return; }
      try { child.stdin.end(); } catch { /* already closed */ }
      const term = () => {
        this.signalLog.push({ pid: child.pid, signal: 'SIGTERM' });
        try { child.kill('SIGTERM'); } catch { /* exited */ }
      };
      term();
      const killer = setTimeout(() => {
        if (!this.exitInfo) {
          this.signalLog.push({ pid: child.pid, signal: 'SIGKILL' });
          try { child.kill('SIGKILL'); } catch { /* exited */ }
        }
      }, grace);
      child.on('exit', (code, signal) => {
        clearTimeout(killer);
        resolve({ code, signal });
      });
      // Safety net if exit event raced us.
      setTimeout(() => resolve(this.exitInfo ?? { code: null, signal: 'SIGKILL' }), grace + 5_000);
    });
    return this._stopPromise;
  }

  /** Bounded, redaction-safe diagnostics (never includes env or full frames). */
  snapshot() {
    return {
      spawnCount: this.spawnCount,
      exitInfo: this.exitInfo,
      signalLog: [...this.signalLog],
      stderrLines: [...this.stderrLines],
      pendingCount: this.pending.size,
      ...this.diagnostics,
      unknownEventKinds: [...new Set(this.diagnostics.unknownEventKinds)],
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
