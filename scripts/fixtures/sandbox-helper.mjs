#!/usr/bin/env node
/**
 * Shared sandbox-configuration helper (Phase 1 review correction).
 *
 * ONE source of truth for the bwrap boundary used by BOTH the safety
 * validation tests and the native probe, plus the in-sandbox observer the
 * tests use to prove the effective (not intended) environment.
 *
 * bwrap flags (same in every consumer):
 *   --unshare-net            outbound AND loopback network denied
 *   --unshare-pid            own PID namespace (owned-tree containment)
 *   --die-with-parent        bwrap (and thus the namespace) dies with us
 *   --clearenv               unset ALL environment variables, THEN the exact
 *                            allowed values are set via --setenv (R2 fix)
 *   production /home and /home/user/.hermes are NEVER bound
 *   installed Hermes source + venv are read-only-bound (code only, no
 *   profile secrets are included in those trees)
 *
 * The env contract: --setenv arguments are derived from the SAME buildChildEnv
 * allowlist the client uses, so the observed child environment is identical
 * across the safety tests and the native probe.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildChildEnv } from '../hermes-protocol-spike.mjs';

export const BWRAP_BIN = 'bwrap';

/**
 * Build the bwrap argv for a sandbox.
 * @param {object} o
 * @param {string} o.home      host path of the fresh HOME directory
 * @param {string} o.hermesHome host path of the fresh HERMES_HOME directory
 * @param {string} o.tmp       host path of the fresh TMPDIR
 * @param {string} [o.cwdPath] in-sandbox working directory (default /probe)
 * @param {string} [o.hostCwd] host path to bind read-write at cwdPath
 * @param {string[]} [o.roBinds] additional [host, sandbox] read-only bind pairs
 * @param {object} [o.extraEnv] additional allowlisted env vars (e.g. PYTHONDONTWRITEBYTECODE)
 * @param {string[]} [o.argv]  command to run inside the sandbox
 */
export function buildBwrapArgv({
  home, hermesHome, tmp, cwdPath = '/probe', hostCwd, roBinds = [], extraEnv = {}, argv = [], hermesHomeMode = 'ro',
}) {
  const env = buildChildEnv({
    home: path.join(cwdPath, 'home'),
    hermesHome: path.join(cwdPath, 'hermes-home'),
    tmpDir: '/tmp',
    cwd: cwdPath,
    extraEnv,
  });
  const hermesBind = hermesHomeMode === 'rw' ? '--bind' : '--ro-bind';
  const parts = [
    BWRAP_BIN,
    '--unshare-net', '--unshare-pid', '--die-with-parent',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--tmpfs', '/run',
    '--ro-bind', '/usr', '/usr',
    // Dynamic-linker paths: on Arch the host /lib and /lib64 are symlinks to
    // usr/lib. Without these, executables bound under /usr cannot find their
    // ELF interpreter (execvp ENOENT) inside the sandbox.
    '--symlink', '/usr/lib', '/lib64',
    '--symlink', '/usr/lib', '/lib',
    '--ro-bind-try', '/etc', '/etc',
  ];
  for (const [h, s] of roBinds) parts.push('--ro-bind', h, s);
  parts.push(
    '--ro-bind', home, path.join(cwdPath, 'home'),
    hermesBind, hermesHome, path.join(cwdPath, 'hermes-home'),
  );
  if (hostCwd) parts.push('--ro-bind', hostCwd, cwdPath);
  // /proc mount goes AFTER all binds (a /proc mounted before the /usr bind is
  // shadowed on this bwrap version — /proc/self/ns/* would be unreadable).
  parts.push('--proc', '/proc');
  // R2 fix: clear the environment, THEN explicitly set the allowed values.
  parts.push('--clearenv');
  for (const [k, v] of Object.entries(env)) parts.push('--setenv', k, String(v));
  parts.push(...argv);
  return { argv: parts, env };
}

/**
 * Observer script executed INSIDE the sandbox (as `node observer.js <key>`).
 * Prints one JSON line with the effective environment and markers the tests
 * assert on. Synthetic only; reads no real credentials.
 */
export const OBSERVER_SCRIPT = String.raw`
const fs = require('node:fs');
const key = process.argv[2] ?? '';
const out = {
  key,
  marker: process.env.DC_PHASE1_OBSERVER_MARKER ?? null,
  home: process.env.HOME ?? null,
  hermesHome: process.env.HERMES_HOME ?? null,
  tmpdir: process.env.TMPDIR ?? null,
  pwd: process.env.PWD ?? null,
  path: process.env.PATH ?? null,
  lang: process.env.LANG ?? null,
  envKeys: Object.keys(process.env).sort(),
  netns: (() => { try { return fs.readlinkSync('/proc/self/ns/net'); } catch { return null; } })(),
  userns: (() => { try { return fs.readlinkSync('/proc/self/ns/user'); } catch { return null; } })(),
  tmpdirReadable: (() => { try { fs.readdirSync(process.env.TMPDIR ?? '/tmp'); return true; } catch { return false; } })(),
  sentinelProbe: (() => {
    const p = process.env.DC_PHASE1_SENTINEL_PATH ?? '';
    if (!p) return 'no-path-given';
    try { fs.readFileSync(p); return 'READ'; } catch (e) { return 'DENIED(' + (e.code ?? 'error') + ')'; }
  })(),
};
process.stdout.write(JSON.stringify(out) + '\n');
`;

/** Sandbox identity test node script (network + namespace identity). */
export const SANDBOX_PROBE_SCRIPT = String.raw`
const fs = require('node:fs');
const net = require('node:net');
const out = {
  marker: process.env.DC_PHASE1_OBSERVER_MARKER ?? null,
  netns: (() => { try { return fs.readlinkSync('/proc/self/ns/net'); } catch { return null; } })(),
};
const port = Number(process.env.DC_PHASE1_LOOPBACK_PORT ?? 0);
const s = net.connect(port, '127.0.0.1');
s.setTimeout(2000);
s.on('connect', () => { s.destroy(); process.stdout.write(JSON.stringify({ ...out, outcome: 'CONNECTED' }) + '\n'); process.exit(0); });
s.on('error', () => { process.stdout.write(JSON.stringify({ ...out, outcome: 'DENIED' }) + '\n'); process.exit(0); });
s.on('timeout', () => { process.stdout.write(JSON.stringify({ ...out, outcome: 'TIMEOUT' }) + '\n'); process.exit(0); });
`;

/** Write a temp .js file for the observer/probe scripts. */
export function writeTempScript(dir, name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

/** Best-effort deletion of a probe tree. */
export function rmTree(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
}

export function makeProbeDirs(prefix = 'dc-phase1-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(root, 'home');
  const hermesHome = path.join(root, 'hermes-home');
  const tmp = path.join(root, 'tmp');
  for (const d of [home, hermesHome, tmp]) fs.mkdirSync(d, { recursive: true });
  return { root, home, hermesHome, tmp };
}
