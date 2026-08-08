import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir, platform } from 'os'
import { dirname, join, resolve } from 'path'
import { spawnSync } from 'child_process'

export type ServicePlatform = 'linux' | 'darwin' | 'win32'

export interface NativeServiceOptions {
  executable: string
  dataDir: string
  host?: string
  port?: number
  homeDir?: string
}

export interface NativeServiceDefinition {
  platform: ServicePlatform
  definitionPath: string
  logPath: string
  contents: string
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function systemdQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function createNativeServiceDefinition(target: ServicePlatform, options: NativeServiceOptions): NativeServiceDefinition {
  const home = options.homeDir ?? homedir()
  const executable = resolve(options.executable)
  const dataDir = resolve(options.dataDir)
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 38470
  const logDir = join(dataDir, 'logs')
  const logPath = join(logDir, 'server.log')

  if (target === 'linux') {
    const definitionPath = join(home, '.config', 'systemd', 'user', 'donutcode-server.service')
    return {
      platform: target,
      definitionPath,
      logPath,
      contents: `[Unit]\nDescription=DonutCode Server\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=${systemdQuote(executable)} serve --data-dir ${systemdQuote(dataDir)} --listen ${systemdQuote(host)} --port ${port}\nRestart=on-failure\nRestartSec=3\nNoNewPrivileges=true\nPrivateTmp=true\nStandardOutput=append:${logPath}\nStandardError=append:${logPath}\n\n[Install]\nWantedBy=default.target\n`,
    }
  }

  if (target === 'darwin') {
    const definitionPath = join(home, 'Library', 'LaunchAgents', 'com.donutcode.server.plist')
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return {
      platform: target,
      definitionPath,
      logPath,
      contents: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.donutcode.server</string>\n<key>ProgramArguments</key><array><string>${escape(executable)}</string><string>serve</string><string>--data-dir</string><string>${escape(dataDir)}</string><string>--listen</string><string>${escape(host)}</string><string>--port</string><string>${port}</string></array>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n<key>StandardOutPath</key><string>${escape(logPath)}</string><key>StandardErrorPath</key><string>${escape(logPath)}</string>\n<key>ProcessType</key><string>Background</string>\n</dict></plist>\n`,
    }
  }

  const definitionPath = join(home, 'AppData', 'Local', 'DonutCode', 'server-service.cmd')
  return {
    platform: target,
    definitionPath,
    logPath,
    contents: `@echo off\r\n"${executable}" serve --data-dir "${dataDir}" --listen "${host}" --port ${port} >> "${logPath}" 2>&1\r\n`,
  }
}

export function installNativeService(options: NativeServiceOptions, target: ServicePlatform = platform() as ServicePlatform): NativeServiceDefinition {
  if (!['linux', 'darwin', 'win32'].includes(target)) throw new Error(`Unsupported service platform: ${target}`)
  const definition = createNativeServiceDefinition(target, options)
  mkdirSync(dirname(definition.definitionPath), { recursive: true })
  mkdirSync(dirname(definition.logPath), { recursive: true })
  writeFileSync(definition.definitionPath, definition.contents, { mode: 0o600 })
  if (target === 'win32') chmodSync(definition.definitionPath, 0o700)

  if (target === 'linux') {
    run('systemctl', ['--user', 'daemon-reload'])
    run('systemctl', ['--user', 'enable', '--now', 'donutcode-server.service'])
  } else if (target === 'darwin') {
    run('launchctl', ['bootstrap', `gui/${process.getuid?.() ?? 0}`, definition.definitionPath])
    run('launchctl', ['enable', `gui/${process.getuid?.() ?? 0}/com.donutcode.server`])
  } else {
    run('schtasks.exe', ['/Create', '/F', '/TN', 'DonutCode Server', '/SC', 'ONLOGON', '/RL', 'LIMITED', '/TR', definition.definitionPath])
    run('schtasks.exe', ['/Run', '/TN', 'DonutCode Server'])
  }
  return definition
}

export function uninstallNativeService(options: NativeServiceOptions, target: ServicePlatform = platform() as ServicePlatform): void {
  const definition = createNativeServiceDefinition(target, options)
  if (target === 'linux') {
    run('systemctl', ['--user', 'disable', '--now', 'donutcode-server.service'], true)
    rmSync(definition.definitionPath, { force: true })
    run('systemctl', ['--user', 'daemon-reload'])
  } else if (target === 'darwin') {
    run('launchctl', ['bootout', `gui/${process.getuid?.() ?? 0}`, definition.definitionPath], true)
    rmSync(definition.definitionPath, { force: true })
  } else {
    run('schtasks.exe', ['/Delete', '/F', '/TN', 'DonutCode Server'], true)
    rmSync(definition.definitionPath, { force: true })
  }
}

export function nativeServiceInstalled(options: NativeServiceOptions, target: ServicePlatform = platform() as ServicePlatform): boolean {
  return existsSync(createNativeServiceDefinition(target, options).definitionPath)
}

function run(command: string, args: string[], allowFailure = false): void {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || '').trim()}`)
  }
}

export function describeServiceCommand(options: NativeServiceOptions): string {
  return `${shellQuote(options.executable)} serve --data-dir ${shellQuote(options.dataDir)}`
}
