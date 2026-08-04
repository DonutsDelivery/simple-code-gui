import { app, ipcMain, safeStorage, session } from 'electron'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { connect as connectTls } from 'tls'

const CREDENTIAL_REF_PATTERN = /^[A-Za-z0-9:._-]{1,256}$/
const serverCertificatePins = new Map<string, string>()

function certificateEndpointKey(url: URL): string {
  return `${url.hostname.toLowerCase()}:${url.port || '443'}`
}

function normalizeFingerprint(value: string): string {
  const trimmed = value.trim()
  if (/^sha256\//i.test(trimmed)) {
    return Buffer.from(trimmed.slice(7), 'base64').toString('hex')
  }
  return trimmed.replace(/^sha256:/i, '').replace(/:/g, '').toLowerCase()
}

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
  void app.whenReady().then(() => {
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
      const hostPrefix = `${request.hostname.toLowerCase()}:`
      const expected = new Set([...serverCertificatePins]
        .filter(([endpoint]) => endpoint.startsWith(hostPrefix))
        .map(([, fingerprint]) => fingerprint))
      if (expected.size === 0) return callback(-3)
      const actual = normalizeFingerprint(request.certificate.fingerprint || '')
      callback(expected.has(actual) ? 0 : -2)
    })
  })

  ipcMain.handle('server-certificates:trust', (_event, endpoint: unknown, fingerprint: unknown) => {
    if (typeof endpoint !== 'string' || typeof fingerprint !== 'string') throw new Error('Invalid certificate pin')
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || !url.hostname) throw new Error('Certificate pins require HTTPS')
    const normalized = normalizeFingerprint(fingerprint)
    if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error('Invalid SHA-256 certificate fingerprint')
    serverCertificatePins.set(certificateEndpointKey(url), normalized)
  })
  ipcMain.handle('server-certificates:probe', async (_event, endpoint: unknown) => {
    if (typeof endpoint !== 'string') throw new Error('Invalid Server endpoint')
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || !url.hostname) throw new Error('Certificate probing requires HTTPS')
    return await new Promise<string>((resolve, reject) => {
      const socket = connectTls({ host: url.hostname, port: Number(url.port) || 443, rejectUnauthorized: false })
      const timer = setTimeout(() => socket.destroy(new Error('Certificate probe timed out')), 5_000)
      socket.once('secureConnect', () => {
        clearTimeout(timer)
        const fingerprint = normalizeFingerprint(socket.getPeerCertificate().fingerprint256 || '')
        socket.end()
        if (!/^[0-9a-f]{64}$/.test(fingerprint)) reject(new Error('Server did not present a SHA-256 certificate fingerprint'))
        else resolve(fingerprint)
      })
      socket.once('error', error => { clearTimeout(timer); reject(error) })
    })
  })
  ipcMain.handle('server-certificates:remove', (_event, endpoint: unknown) => {
    if (typeof endpoint !== 'string') return
    try {
      serverCertificatePins.delete(certificateEndpointKey(new URL(endpoint)))
    } catch { /* ignore invalid endpoint */ }
  })

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
