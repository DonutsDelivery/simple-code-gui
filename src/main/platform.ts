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

export function getEnhancedPathWithPortable(): string {
  const additionalPaths = getAdditionalPaths()
  const currentPath = process.env.PATH || ''
  return [...portableBinDirs, ...additionalPaths, currentPath].join(PATH_SEP)
}
