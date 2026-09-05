#!/usr/bin/env node
/**
 * SYNTHETIC Hermes stdio-gateway fixture — NOT the installed Hermes.
 *
 * Purpose
 *   Emits documented, protocol-shaped frames matching the observed wire format
 *   of the installed Hermes stdio gateway (`python -m tui_gateway.entry`,
 *   Hermes Agent v0.20.6, tui_gateway/entry.py + server.py dispatch):
 *
 *     stdout: one JSON-RPC 2.0 object per line
 *       -> response : {"jsonrpc":"2.0","id":<echo>,"result":{...}}
 *       -> error    : {"jsonrpc":"2.0","id":<echo|null>,"error":{"code":N,"message":S}}
 *       -> event    : {"jsonrpc":"2.0","method":"event","params":{"type":S,"payload":O}}
 *     stderr: free-form diagnostic text (never part of the protocol)
 *     first stdout frame: event gateway.ready {skin, change_events, replay_epoch}
 *
 *   Frame shapes here mirror the installed gateway's observable output. The
 *   fixture implements none of the real gateway's agent behavior; every
 *   response body is a documented stub labeled SYNTHETIC. Validation against
 *   the installed version is limited to the observable wire shapes above.
 *
 * Failure modes (deterministic, selected by --script <name>):
 *   default       normal serving: gateway.ready, ping responses, unknown
 *                 methods get JSON-RPC error -32601
 *   no-ready      never emits gateway.ready (readiness timeout path)
 *   slow-ready    emits gateway.ready after a delay (startup timeout margin)
 *   ack-drop      accepts a request but never answers it (missing-ack timeout
 *                 path; the spike must time out once and NOT resubmit)
 *   early-exit    exits with the given code after gateway.ready
 *   stdin-close   answers one ping, then closes stdin but STAYS ALIVE
 *                 (lost-pipe path; the client must settle with
 *                 StdioWriteError, not crash with an unhandled EPIPE)
 *   split-utf8    streams one multi-byte-UTF-8 event in byte slices with
 *                 pauses at deterministic codepoint-true boundaries (split
 *                 UTF-8 decode path; cuts computed from the encoded bytes)
 *   interleaved   emits a burst of events while a request is in flight, then
 *                 answers the request last (correlation path)
 *   oversize      sends one line longer than --max-frame-bytes (bounded
 *                 buffering path)
 *   malformed     sends one line of invalid JSON, then continues serving
 *   journal       default behavior + counts/journals every received request;
 *                 `fixture.journal` RPC returns the observed request log
 *
 * Stdin: one JSON-RPC request per line. Blank input is ignored; stdin close
 * exits after the script's deterministic work is done (except stdin-close).
 *
 * Isolation: this fixture reads no credentials and performs no network I/O.
 * It optionally reports (to stderr only) whether sentinel files are visible,
 * so tests can assert the sandbox denied profile access.
 *
 * Usage:
 *   node scripts/fixtures/hermes-gateway-fixture.mjs [--script NAME] [--exit-code N]
 *        [--ready-delay-ms N] [--max-frame-bytes N] [--slices N]
 */

import { once } from 'node:events';
import fs from 'node:fs';
import readline from 'node:readline';

const args = process.argv.slice(2);
function argOf(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

const script = argOf('--script', 'default');
const exitCode = Number(argOf('--exit-code', '7'));
const readyDelayMs = Number(argOf('--ready-delay-ms', '0'));
const maxFrameBytes = Number(argOf('--max-frame-bytes', String(1 << 20)));
const slices = Math.max(2, Number(argOf('--slices', '3')));

const sentinels = {
  'HERMES_SENTINEL_CONFIG': `${process.env.FIXTURE_SENTINEL_HOME ?? ''}/.config/secret-sentinel`.replace('//', '/'),
};

function writeOut(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}
function writeErr(line) {
  process.stderr.write(`[fixture] ${line}\n`);
}

/** One documented stub event. */
function emitEvent(type, payload) {
  writeOut({ jsonrpc: '2.0', method: 'event', params: { type, payload, synthetic: true } });
}

function emitReady() {
  // Shape mirrors the installed gateway's gateway.ready event payload keys.
  emitEvent('gateway.ready', { skin: 'synthetic', change_events: true, replay_epoch: 1 });
}

const inflight = new Set();
const journal = []; // every received request: {id, method, params}

function handleRequest(req) {
  const { id, method, params } = req;
  if (method === 'ping') {
    writeOut({ jsonrpc: '2.0', id, result: { pong: true, synthetic: true } });
    return;
  }
  if (method === 'fixture.echo') {
    writeOut({ jsonrpc: '2.0', id, result: { echoed: params ?? null, synthetic: true } });
    return;
  }
  if (method === 'fixture.journal') {
    writeOut({ jsonrpc: '2.0', id, result: { journal, synthetic: true } });
    return;
  }
  if (method === 'fixture.sentinels') {
    // Diagnostics only: report visibility of sentinel paths. Never reads them.
    const seen = Object.entries(sentinels).filter(([, p]) => fs.existsSync(p)).map(([k]) => k);
    writeOut({ jsonrpc: '2.0', id, result: { visible: seen, synthetic: true } });
    return;
  }
  if (typeof method === 'string' && method.startsWith('fixture.ackdrop.')) {
    // Deliberately never answered (missing-ack script path).
    return;
  }
  writeOut({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32601, message: `unknown method: ${String(method)}` },
  });
}

async function main() {
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  switch (script) {
    case 'no-ready': {
      // Serve requests normally but never announce readiness.
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.on('line', (l) => {
        try { handleRequest(JSON.parse(l)); } catch { writeOut({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
      });
      once(rl, 'close').then(() => process.exit(0));
      return;
    }
    case 'slow-ready': {
      await new Promise((r) => setTimeout(r, readyDelayMs));
      emitReady();
      break;
    }
    case 'early-exit': {
      emitReady();
      process.exit(exitCode);
      return; // unreachable
    }
    case 'ack-drop': {
      emitReady();
      break;
    }
    case 'stdin-close': {
      // Answer the FIRST request, then close stdin (fd 0) while staying alive.
      emitReady();
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.once('line', (l) => {
        try { handleRequest(JSON.parse(l)); } catch { /* not json: ignore */ }
        // Truly close fd 0 (end() only ends the readable stream). The parent's
        // next write must then fail (EPIPE/EIO), pending requests settle with
        // StdioWriteError, and the client must NOT crash with an unhandled
        // EPIPE. The process stays alive until the test stops it.
        try { fs.closeSync(0); } catch { /* already closed */ }
      });
      once(rl, 'close').then(() => {
        // Stay alive ~10s after stdin closed; the test stops us earlier.
        setTimeout(() => process.exit(0), 10_000);
      });
      return;
    }
    case 'split-utf8': {
      emitReady();
      // Multi-byte-true slices: cuts computed from the ENCODED bytes so at
      // least one cut lands strictly inside a multi-byte sequence.
      const line = JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'fixture.utf8', payload: { word: 'héllo' }, synthetic: true } });
      const buf = Buffer.from(line, 'utf8');
      const mbStart = buf.indexOf(Buffer.from('é', 'utf8')); // 0xC3 0xA9 begins here
      const cuts = [Math.max(1, mbStart), mbStart + 1]; // one cut before, one INSIDE the 2-byte sequence
      let last = 0;
      const pieces = [];
      for (const c of cuts) { pieces.push(buf.subarray(last, c)); last = c; }
      pieces.push(buf.subarray(last));
      pieces.push(Buffer.from('\n', 'utf8'));
      for (const p of pieces) {
        process.stdout.write(p);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
      }
      break;
    }
    case 'interleaved': {
      emitReady();
      break;
    }
    case 'oversize': {
      emitReady();
      const big = 'x'.repeat(maxFrameBytes + 1024);
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'fixture.oversize', payload: { blob: big } } })}\n`);
      break;
    }
    case 'malformed': {
      emitReady();
      process.stdout.write('this is not json\n');
      break;
    }
    default: {
      emitReady();
      break;
    }
  }

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let req;
    try { req = JSON.parse(line); } catch {
      writeOut({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      return;
    }
    journal.push({ id: String(req.id ?? null), method: req.method, params: req.params ?? null });
    if (script === 'ack-drop') {
      // Only ackdrop-prefixed requests are silently dropped; everything else
      // (e.g. the journal query) is answered normally.
      if (typeof req.method === 'string' && req.method.startsWith('fixture.ackdrop.')) {
        inflight.add(String(req.id));
        return;
      }
      handleRequest(req);
      return;
    }
    if (script === 'interleaved' && req.method === 'fixture.echo') {
      // Emit a burst of events now; answer the request after them.
      emitEvent('fixture.noise', { n: 1 });
      emitEvent('fixture.noise', { n: 2 });
      setImmediate(() => writeOut({ jsonrpc: '2.0', id: req.id, result: { echoed: req.params ?? null, synthetic: true } }));
      return;
    }
    if (script === 'stdin-close') return; // only the first request is handled above
    handleRequest(req);
  });
  once(rl, 'close').then(() => process.exit(0));
}

main().catch((err) => {
  writeErr(`fixture crashed: ${err?.message ?? err}`);
  process.exit(70);
});
