import { app, ipcMain, safeStorage } from 'electron'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const CREDENTIAL_REF_PATTERN = /^[A-Za-z0-9:._-]{1,256}$/

function credentialPath(): string {
  return join(app.getPath('userData'), 'secure-device-credentials.json')
}

function readCredentialMap(): Record<string, string> {
  const path = credentialPath()
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeCredentialMap(value: Record<string, string>): void {
  const path = credentialPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

function validateRef(ref: unknown): asserts ref is string {
  if (typeof ref !== 'string' || !CREDENTIAL_REF_PATTERN.test(ref)) throw new Error('Invalid credential reference')
}

export function registerSecureCredentialHandlers(): void {
  ipcMain.handle('credentials:isAvailable', () => safeStorage.isEncryptionAvailable())
  ipcMain.handle('credentials:store', (_event, ref: unknown, credential: unknown) => {
    validateRef(ref)
    if (typeof credential !== 'string' || credential.length === 0 || credential.length > 16_384) {
      throw new Error('Invalid credential')
    }
    if (!safeStorage.isEncryptionAvailable()) return false
    const values = readCredentialMap()
    values[ref] = safeStorage.encryptString(credential).toString('base64')
    writeCredentialMap(values)
    return true
  })
  ipcMain.handle('credentials:load', (_event, ref: unknown) => {
    validateRef(ref)
    if (!safeStorage.isEncryptionAvailable()) return null
    const encoded = readCredentialMap()[ref]
    if (typeof encoded !== 'string') return null
    try {
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
    } catch {
      return null
    }
  })
  ipcMain.handle('credentials:remove', (_event, ref: unknown) => {
    validateRef(ref)
    const values = readCredentialMap()
    if (!(ref in values)) return
    delete values[ref]
    writeCredentialMap(values)
  })
}
