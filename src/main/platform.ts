import * as os from 'os'
import * as path from 'path'

export const isWindows = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'
export const PATH_SEP = isWindows ? ';' : ':'
export const homeDir = os.homedir()

export function getDefaultShell(): string {
  if (isWindows) {
    return process.env.COMSPEC || 'cmd.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

export function getPowerShell(): string {
  return process.env.PROGRAMFILES
    ? path.join(process.env.PROGRAMFILES, 'PowerShell', '7', 'pwsh.exe')
    : 'powershell.exe'
}

export function getAdditionalPaths(): string[] {
  if (isWindows) {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')
    return [
      path.join(appData, 'npm'),
      path.join(localAppData, 'Programs', 'nodejs'),
      path.join(homeDir, '.local', 'bin'),
      path.join(homeDir, '.cargo', 'bin'),
    ]
  }

  return [
    ...(isMac ? ['/opt/homebrew/bin', '/opt/homebrew/sbin'] : []),
    path.join(homeDir, '.nvm/versions/node/v20.18.1/bin'),
    path.join(homeDir, '.nvm/versions/node/v22.11.0/bin'),
    path.join(homeDir, '.local/bin'),
    path.join(homeDir, '.npm-global/bin'),
    path.join(homeDir, '.cargo', 'bin'),
    '/usr/local/bin',
  ]
}

export function getEnhancedPath(): string {
  const additionalPaths = getAdditionalPaths()
  const currentPath = process.env.PATH || ''
  return [...additionalPaths, currentPath].join(PATH_SEP)
}

let portableBinDirs: string[] = []

export function setPortableBinDirs(dirs: string[]): void {
  portableBinDirs = dirs
}

// Portable deps are shipped as x64 binaries (portable-deps.ts hardcodes
// *-x64 URLs on every platform). Prepending an x64 node to the PATH of a
// backend running on an arm64 host forces Rosetta for any node-driven
// build step — e.g. Hermes's TUI build, whose esbuild ships only
// darwin-arm64 — and that build then fails, killing the session. Only
// prepend portable dirs whose architecture matches the host.
function portableDirsMatchingHost(dirs: string[]): string[] {
  const hostIsArm = process.arch === 'arm64' || process.arch === 'arm'
  return dirs.filter(dir => {
    const isX64Dir = /x64|x86_64/i.test(dir)
    return !(hostIsArm && isX64Dir)
  })
}

export function getEnhancedPathWithPortable(): string {
  const additionalPaths = getAdditionalPaths()
  const currentPath = process.env.PATH || ''
  const matchingPortable = portableDirsMatchingHost(portableBinDirs)
  return [...matchingPortable, ...additionalPaths, currentPath].join(PATH_SEP)
}
