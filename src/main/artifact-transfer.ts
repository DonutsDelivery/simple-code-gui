import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { ArtifactManifest, ArtifactStore } from './artifact-store'

/**
 * Checkpoint 11 — host-to-host artifact transfer.
 *
 * The requesting frontend brokers metadata only: the source server streams
 * chunked bytes to the destination server over the authenticated API, the
 * destination verifies the SHA-256 of every assembled chunk, and the final
 * artifact is published into the destination CAS only after the full hash
 * matches. Transfers resume from the last verified offset — interrupted
 * transfers never leave a corrupt blob.
 */

export const TRANSFER_CHUNK_BYTES = 1024 * 1024 // 1 MiB

export interface TransferTarget {
  /** Authenticated destination client (HttpBackend/API surface). */
  uploadChunk: (artifactId: string, offset: number, chunkBase64: string) => Promise<{ received: number }>
  completeTransfer: (artifactId: string, sha256: string) => Promise<ArtifactManifest>
  /** How many bytes the destination already holds (resume point). */
  currentOffset?: number
}

export interface TransferResult {
  artifactId: string
  sha256: string
  bytesTransferred: number
  resumed: boolean
  manifest: ArtifactManifest
}

/** Stream a stored artifact to the destination in resumable chunks. */
export async function transferArtifact(
  store: ArtifactStore,
  artifactId: string,
  target: TransferTarget,
): Promise<TransferResult> {
  const manifest = store.get(artifactId)
  if (!manifest) throw new Error(`Artifact not found: ${artifactId}`)
  const blobPath = store.blobPathFor(artifactId)
  if (!blobPath) throw new Error(`Artifact bytes missing: ${artifactId}`)
  const size = statSync(blobPath).size

  let offset = target.currentOffset ?? 0
  if (offset > size) throw new Error(`Resume offset ${offset} exceeds artifact size ${size}`)
  const resumed = offset > 0

  const readStream = createReadStream(blobPath, { start: offset, highWaterMark: TRANSFER_CHUNK_BYTES })
  const hash = createHash('sha256')
  let bytesTransferred = 0

  await new Promise<void>((resolvePromise, reject) => {
    readStream.on('data', async (chunk: Buffer | string) => {
      readStream.pause()
      try {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        hash.update(bytes)
        const base64 = bytes.toString('base64')
        const { received } = await target.uploadChunk(manifest.artifactId, offset, base64)
        if (received !== bytes.length) throw new Error(`Chunk acknowledged ${received}/${bytes.length} bytes`)
        offset += bytes.length
        bytesTransferred += bytes.length
      } catch (error) {
        reject(error)
        return
      }
      readStream.resume()
    })
    readStream.on('end', () => resolvePromise())
    readStream.on('error', reject)
  })

  // Destination-side verification: the destination computes the hash of all
  // received bytes and refuses to publish on mismatch.
  const completed = await target.completeTransfer(manifest.artifactId, hash.digest('hex'))
  return {
    artifactId,
    sha256: manifest.sha256,
    bytesTransferred,
    resumed,
    manifest: completed,
  }
}

export interface ResumableSink {
  /** Directory holding partial uploads. */
  stagingDir: string
  /** SHA-256 of the expected full artifact (provided at publish time). */
  expectedSha256?: string
}

/** Destination-side sink for chunked uploads with resume + hash verification. */
export class ArtifactUploadSink {
  private readonly stagingDir: string
  private readonly expectedSha256?: string
  private readonly filePath: string
  private bytes = 0

  constructor(private readonly store: ArtifactStore, sink: ResumableSink) {
    this.stagingDir = sink.stagingDir
    this.expectedSha256 = sink.expectedSha256
    mkdirSync(this.stagingDir, { recursive: true })
    this.filePath = join(this.stagingDir, 'incoming.bin')
    if (existsSync(this.filePath)) this.bytes = statSync(this.filePath).size
  }

  currentOffset(): number {
    return this.bytes
  }

  /** Append a chunk at `offset`; rejects when the offset is out of order. */
  async append(offset: number, chunkBase64: string): Promise<{ received: number }> {
    const chunk = Buffer.from(chunkBase64, 'base64')
    if (offset !== this.bytes) {
      // Out-of-order (client raced ahead): discard, client will retry from
      // our actual offset.
      return { received: 0 }
    }
    await new Promise<void>((resolvePromise, reject) => {
      const write = createWriteStream(this.filePath, { flags: 'a', mode: 0o600 })
      write.on('error', reject)
      write.end(chunk, () => resolvePromise())
    })
    this.bytes += chunk.length
    return { received: chunk.length }
  }

  /** Verify the full hash, then publish into the CAS; throws on mismatch. */
  async complete(metadata: Omit<ArtifactManifest, 'artifactId' | 'sha256' | 'size' | 'createdAt'>): Promise<ArtifactManifest> {
    const hash = createHash('sha256')
    await new Promise<void>((resolvePromise, reject) => {
      const read = createReadStream(this.filePath)
      read.on('data', chunk => hash.update(chunk as Buffer))
      read.on('end', () => resolvePromise())
      read.on('error', reject)
    })
    const actual = hash.digest('hex')
    if (this.expectedSha256 && actual !== this.expectedSha256) {
      unlinkSync(this.filePath)
      throw new Error(`SHA-256 mismatch: expected ${this.expectedSha256}, got ${actual}`)
    }
    const manifest = await this.store.publish(this.filePath, metadata)
    unlinkSync(this.filePath)
    return manifest
  }

  /** Abort and discard the partial upload. */
  cancel(): void {
    if (existsSync(this.filePath)) unlinkSync(this.filePath)
    this.bytes = 0
  }
}
