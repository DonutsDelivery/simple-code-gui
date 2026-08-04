import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getRuntimeDataDir } from './runtime-paths.js'

interface ConsumedOfferRecord {
  nonce: string
  expiresAt: number
}

function storePath(): string {
  return join(getRuntimeDataDir(), 'consumed-pairing-offers.json')
}

function readRecords(now: number): ConsumedOfferRecord[] {
  const path = storePath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((record): record is ConsumedOfferRecord =>
      record
      && typeof record.nonce === 'string'
      && typeof record.expiresAt === 'number'
      && record.expiresAt > now
    )
  } catch {
    return []
  }
}

function writeRecords(records: ConsumedOfferRecord[]): void {
  const path = storePath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(records), { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

/** Atomically records one accepted nonce. False means it was already consumed. */
export function consumePairingOfferNonce(nonce: string, expiresAt: number, now = Date.now()): boolean {
  const records = readRecords(now)
  if (records.some(record => record.nonce === nonce)) return false
  records.push({ nonce, expiresAt })
  writeRecords(records)
  return true
}
