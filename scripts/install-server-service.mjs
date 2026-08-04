#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function quote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

if (process.platform !== 'linux') {
  console.error('The user-systemd installer is supported on Linux only.')
  process.exit(1)
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, '..')
const serverCli = resolve(arg('--server-cli', join(packageRoot, 'dist', 'main', 'server-cli.js')))
const dataDir = resolve(arg('--data-dir', join(homedir(), '.local', 'share', 'DonutCode')))
const host = arg('--listen', '127.0.0.1')
const port = arg('--port', '38470')
const unitDir = join(homedir(), '.config', 'systemd', 'user')
const unitPath = join(unitDir, 'donutcode-server.service')

const unit = `[Unit]
Description=DonutCode Server
After=network.target

[Service]
Type=simple
ExecStart=${quote(process.execPath)} ${quote(serverCli)} serve --data-dir ${quote(dataDir)} --listen ${quote(host)} --port ${quote(port)}
Restart=on-failure
RestartSec=2
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`

mkdirSync(unitDir, { recursive: true })
writeFileSync(unitPath, unit, { mode: 0o644 })
console.log(`Installed ${unitPath}`)

if (process.argv.includes('--enable')) {
  execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' })
  execFileSync('systemctl', ['--user', 'enable', '--now', 'donutcode-server.service'], { stdio: 'inherit' })
}
