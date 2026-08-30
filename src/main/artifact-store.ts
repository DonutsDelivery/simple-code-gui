import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { createInterface } from 'readline'
import { basename, join } from 'path'
import type { ArtifactKind, ArtifactManifest } from '../common/artifacts.js'

export type { ArtifactKind, ArtifactManifest } from '../common/artifacts.js'

/**
 * Checkpoint 11 — content-addressed artifact store.
 *
 * Immutable artifact bytes are stored by SHA-256 (content-addressed, so the
 * same bytes dedupe across publishers). Manifests carry exact source identity
 * (repositoryId/commit/tree) so build outputs and evidence are traceable to
 * the exact source bytes. Bytes are never auto-run on download.
 */

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['source', 'package', 'log', 'screenshot', 'test-report', 'cache']

export interface ArtifactStoreConfig {
  /** Server-owned data directory. Artifacts live in <dataDir>/artifacts/. */
  dataDir: string
  /** Per-publisher byte quota (default 2 GiB). */
  quotaBytes?: number
  /** Default retention for artifacts without an explicit expiresAt (default 30 days). */
  defaultTtlMs?: number
}

export interface ArtifactStoreInfo {
  totalBytes: number
  artifactCount: number
  quotaBytes: number
}

/** Scan for file paths that could leak credentials/secrets into artifacts. */
export function pathExcluded(filePath: string): boolean {
  const base = basename(filePath).toLowerCase()
  const excludedNames = [
    '.env', '.npmrc', '.pypirc', 'id_rsa', 'id_ed25519', 'id_dsa', 'id_ecdsa',
    'credentials.json', 'service_account.json', '.netrc', 'known_hosts',
  ]
  if (excludedNames.some(name => base === name || base.startsWith(`${name}.`))) return true
  if (base.endsWith('.pem') || base.endsWith('.key') || base.endsWith('.p12') || base.endsWith('.pfx')) return true
  return false
}

export class ArtifactStore {
  private readonly root: string
  private readonly indexFile: string
  private readonly quotaBytes: number
  private readonly defaultTtlMs: number
  private manifests = new Map<string, ArtifactManifest>()

  constructor(config: ArtifactStoreConfig) {
    this.root = join(config.dataDir, 'artifacts')
    this.indexFile = join(this.root, 'index.json')
    this.quotaBytes = config.quotaBytes ?? 2 * 1024 * 1024 * 1024
    this.defaultTtlMs = config.defaultTtlMs ?? 30 * 24 * 60 * 60 * 1000
    mkdirSync(this.root, { recursive: true })
    if (existsSync(this.indexFile)) {
      try {
        const data = JSON.parse(readFileSync(this.indexFile, 'utf8')) as ArtifactManifest[]
        for (const manifest of data) this.manifests.set(manifest.artifactId, manifest)
      } catch {
        this.manifests = new Map()
      }
    }
  }

  private persist(): void {
    writeFileSync(this.indexFile, JSON.stringify([...this.manifests.values()], null, 2), { mode: 0o600 })
  }

  private blobPath(sha256: string): string {
    return join(this.root, sha256)
  }

  sha256Of(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex')
  }

  /** Compute the sha256 of a file on disk without loading it whole. */
  async sha256File(filePath: string): Promise<string> {
    const hash = createHash('sha256')
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createReadStream(filePath)
      stream.on('data', chunk => hash.update(chunk as Buffer))
      stream.on('end', () => resolvePromise())
      stream.on('error', reject)
    })
    return hash.digest('hex')
  }

  /** Publish bytes already on disk (source file). Content-addressed + deduped. */
  async publish(
    filePath: string,
    metadata: Omit<ArtifactManifest, 'artifactId' | 'sha256' | 'size' | 'createdAt'>,
  ): Promise<ArtifactManifest> {
    if (pathExcluded(filePath)) {
      throw new Error(`Refusing to publish excluded path: ${basename(filePath)}`)
    }
    const stat = statSync(filePath)
    if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`)
    if (stat.size > this.quotaBytes) throw new Error(`Artifact exceeds quota (${stat.size} bytes)`)

    const sha256 = await this.sha256File(filePath)
    const blobPath = this.blobPath(sha256)
    if (!existsSync(blobPath)) {
      // Copy into the CAS blob location atomically-ish (copy then rename).
      const tmpPath = `${blobPath}.tmp-${Date.now()}`
      await new Promise<void>((resolvePromise, reject) => {
        const input = createReadStream(filePath)
        const output = createWriteStream(tmpPath, { mode: 0o600 })
        input.pipe(output)
        output.on('finish', () => {
          output.close(() => {
            // Verify the copy before committing it.
            this.sha256File(tmpPath).then(actual => {
              if (actual !== sha256) {
                unlinkSync(tmpPath)
                reject(new Error(`Copy verification failed for ${basename(filePath)}`))
                return
              }
              const finalPath = this.blobPath(sha256)
              try { renameSync(tmpPath, finalPath) } catch { unlinkSync(tmpPath) }
              resolvePromise()
            }).catch(reject)
          })
        })
        input.on('error', reject)
        output.on('error', reject)
      })
    }

    const now = Date.now()
    const manifest: ArtifactManifest = {
      ...metadata,
      artifactId: sha256,
      sha256,
      size: stat.size,
      createdAt: now,
      expiresAt: metadata.expiresAt ?? now + this.defaultTtlMs,
    }
    this.manifests.set(sha256, manifest)
    this.persist()
    return manifest
  }

  get(artifactId: string): ArtifactManifest | undefined {
    return this.manifests.get(artifactId)
  }

  /** Absolute path of the stored blob; undefined when absent. */
  blobPathFor(artifactId: string): string | undefined {
    const manifest = this.manifests.get(artifactId)
    if (!manifest) return undefined
    const path = this.blobPath(manifest.sha256)
    return existsSync(path) ? path : undefined
  }

  /** Per-client staging dir for resumable uploads (inside the store root). */
  stagingDirFor(clientKey: string): string {
    const digest = createHash('sha256').update(clientKey).digest('hex').slice(0, 16)
    return join(this.root, 'staging', digest)
  }

  list(filter?: { producerServerId?: string; kind?: ArtifactKind }): ArtifactManifest[] {
    const now = Date.now()
    return [...this.manifests.values()]
      .filter(manifest => !filter?.producerServerId || manifest.producerServerId === filter.producerServerId)
      .filter(manifest => !filter?.kind || manifest.kind === filter.kind)
      .filter(manifest => !manifest.expiresAt || manifest.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Remove one artifact (manifest + blob, dedup-safe: only when no other manifest references it). */
  expire(artifactId: string): boolean {
    const manifest = this.manifests.get(artifactId)
    if (!manifest) return false
    this.manifests.delete(artifactId)
    const stillReferenced = [...this.manifests.values()].some(other => other.sha256 === manifest.sha256)
    if (!stillReferenced) {
      const path = this.blobPath(manifest.sha256)
      if (existsSync(path)) unlinkSync(path)
    }
    this.persist()
    return true
  }

  /** Remove expired artifacts; returns the count removed. */
  sweepExpired(): number {
    const now = Date.now()
    const expired = [...this.manifests.values()].filter(manifest => manifest.expiresAt && manifest.expiresAt <= now)
    for (const manifest of expired) this.expire(manifest.artifactId)
    return expired.length
  }

  info(): ArtifactStoreInfo {
    let totalBytes = 0
    let artifactCount = 0
    for (const manifest of this.manifests.values()) {
      const path = this.blobPath(manifest.sha256)
      if (existsSync(path)) {
        totalBytes += statSync(path).size
        artifactCount += 1
      }
    }
    return { totalBytes, artifactCount, quotaBytes: this.quotaBytes }
  }

  /** Sum of on-disk blob bytes in the store root (for quota accounting). */
  usedBytes(): number {
    let total = 0
    for (const entry of readdirSync(this.root)) {
      if (entry === 'index.json') continue
      const path = join(this.root, entry)
      if (existsSync(path) && statSync(path).isFile()) total += statSync(path).size
    }
    return total
  }
}

/** Read a stream of newline-delimited JSON manifests (for external tooling). */
export async function readManifestLines(filePath: string): Promise<ArtifactManifest[]> {
  const manifests: ArtifactManifest[] = []
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })
  for await (const line of rl) {
    if (line.trim()) manifests.push(JSON.parse(line) as ArtifactManifest)
  }
  return manifests
}
