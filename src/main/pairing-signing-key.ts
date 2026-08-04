import { generateKeyPairSync } from 'crypto'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getRuntimeDataDir } from './runtime-paths.js'

export interface PairingSigningKeyPair {
  publicKey: string
  privateKey: string
}

export function loadOrCreatePairingSigningKeyPair(): PairingSigningKeyPair {
  const path = join(getRuntimeDataDir(), 'pairing-signing-key.json')
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PairingSigningKeyPair
    if (parsed.publicKey && parsed.privateKey) return parsed
    throw new Error('Invalid pairing signing key file')
  }

  const generated = generateKeyPairSync('ed25519')
  const pair = {
    publicKey: generated.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    privateKey: generated.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(pair)}\n`, { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  chmodSync(path, 0o600)
  return pair
}
