import { homedir } from 'os'
import { join, resolve } from 'path'

export interface RuntimePaths {
  dataDir: string
  appPath: string
}

let configuredPaths: RuntimePaths | null = null

export function configureRuntimePaths(paths: RuntimePaths): void {
  configuredPaths = {
    dataDir: resolve(paths.dataDir),
    appPath: resolve(paths.appPath),
  }
}

export function getRuntimeDataDir(): string {
  return configuredPaths?.dataDir
    ?? resolve(process.env.DONUTCODE_DATA_DIR || join(homedir(), '.local', 'share', 'DonutCode'))
}

export function getRuntimeAppPath(): string {
  return configuredPaths?.appPath ?? resolve(process.env.DONUTCODE_APP_PATH || process.cwd())
}
