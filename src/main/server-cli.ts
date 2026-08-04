#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { HeadlessServer, isRuntimeInfoLive, readRuntimeInfo } from './headless-server.js'
import { configureRuntimePaths } from './runtime-paths.js'
import { loadOrCreateToken } from './mobile-server/token-manager.js'

interface ServeOptions {
  dataDir: string
  host: string
  port: number
  appPath: string
  version: string
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function defaultDataDir(): string {
  return process.env.DONUTCODE_DATA_DIR || join(homedir(), '.local', 'share', 'DonutCode')
}

function readVersion(appPath: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(appPath, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return process.env.npm_package_version || 'unknown'
  }
}

function parseServeOptions(args: string[]): ServeOptions {
  const appPath = resolve(valueAfter(args, '--app-path') || process.env.DONUTCODE_APP_PATH || process.cwd())
  const port = Number(valueAfter(args, '--port') || '38470')
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('--port must be 0-65535')
  return {
    dataDir: resolve(valueAfter(args, '--data-dir') || defaultDataDir()),
    host: valueAfter(args, '--listen') || '127.0.0.1',
    port,
    appPath,
    version: readVersion(appPath),
  }
}

function printUsage(): void {
  console.log(`Usage:
  donutcode-server serve [--data-dir PATH] [--listen HOST] [--port PORT]
  donutcode-server status [--data-dir PATH]
  donutcode-server stop [--data-dir PATH]
  donutcode-server pairing-offer [--data-dir PATH] [--output FILE]`)
}

async function serve(args: string[]): Promise<void> {
  const options = parseServeOptions(args)
  const server = new HeadlessServer(options)
  const info = await server.start()
  console.log(JSON.stringify(info))

  let stopping = false
  const stop = async (): Promise<void> => {
    if (stopping) return
    stopping = true
    await server.stop()
    process.exitCode = 0
  }
  process.once('SIGINT', () => { void stop() })
  process.once('SIGTERM', () => { void stop() })
}

async function status(args: string[]): Promise<void> {
  const dataDir = resolve(valueAfter(args, '--data-dir') || defaultDataDir())
  const info = readRuntimeInfo(dataDir)
  const running = Boolean(info && await isRuntimeInfoLive(info))
  console.log(JSON.stringify({ running, ...(info || {}) }))
  if (!running) process.exitCode = 1
}

async function stop(args: string[]): Promise<void> {
  const dataDir = resolve(valueAfter(args, '--data-dir') || defaultDataDir())
  const info = readRuntimeInfo(dataDir)
  if (!info || !await isRuntimeInfoLive(info)) {
    console.error('DonutCode Server is not running')
    process.exitCode = 1
    return
  }
  process.kill(info.pid, 'SIGTERM')
  console.log(JSON.stringify({ stopping: true, pid: info.pid, serverId: info.serverId }))
}

async function pairingOffer(args: string[]): Promise<void> {
  const dataDir = resolve(valueAfter(args, '--data-dir') || defaultDataDir())
  const info = readRuntimeInfo(dataDir)
  if (!info || !await isRuntimeInfoLive(info)) throw new Error('DonutCode Server is not running')

  configureRuntimePaths({ dataDir, appPath: process.cwd() })
  const token = loadOrCreateToken()
  const response = await fetch(`${info.endpoint.replace(/\/$/, '')}/api/auth/pairing-offer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`Pairing offer request failed (${response.status})`)
  const payload = await response.json() as { offer: string; expiresAt: number }
  const output = valueAfter(args, '--output')
  if (output) {
    const path = resolve(output)
    writeFileSync(path, `${JSON.stringify(payload)}\n`, { mode: 0o600 })
    chmodSync(path, 0o600)
    console.log(JSON.stringify({ written: path, expiresAt: payload.expiresAt }))
    return
  }
  console.log(JSON.stringify(payload))
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  switch (command) {
    case 'serve': await serve(args); break
    case 'status': await status(args); break
    case 'stop': await stop(args); break
    case 'pairing-offer': await pairingOffer(args); break
    default:
      printUsage()
      process.exitCode = command ? 1 : 0
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
