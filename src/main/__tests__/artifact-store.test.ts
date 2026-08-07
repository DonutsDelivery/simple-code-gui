import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ArtifactStore, pathExcluded } from '../artifact-store'
import { ArtifactUploadSink, transferArtifact, TRANSFER_CHUNK_BYTES } from '../artifact-transfer'

let dir: string
let store: ArtifactStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dc-artifact-'))
  store = new ArtifactStore({ dataDir: dir })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const metadata = {
  filename: 'build.zip',
  mediaType: 'application/zip',
  producerServerId: 'server-a',
  repositoryId: 'repo-1',
  commit: 'abc123',
  tree: 'tree-1',
  platform: 'linux',
  architecture: 'x64',
  kind: 'package' as const,
}

describe('ArtifactStore', () => {
  it('publishes bytes content-addressed and dedupes identical content', async () => {
    const fileA = join(dir, 'a.bin')
    const fileB = join(dir, 'b.bin')
    writeFileSync(fileA, 'same bytes')
    writeFileSync(fileB, 'same bytes')

    const manifestA = await store.publish(fileA, metadata)
    const manifestB = await store.publish(fileB, { ...metadata, filename: 'b.bin' })

    expect(manifestA.sha256).toBe(manifestB.sha256)
    expect(manifestA.artifactId).toBe(manifestB.artifactId)
    expect(manifestA.size).toBe(10)
    // Content-addressing: identical bytes are the SAME artifact (one manifest,
    // one blob); the later publisher's metadata wins.
    expect(store.list()).toHaveLength(1)
    expect(store.info().artifactCount).toBe(1)
    expect(store.list()[0].filename).toBe('b.bin')
  })

  it('verifies the copied blob hash before committing', async () => {
    const file = join(dir, 'payload.bin')
    const payload = Buffer.alloc(1024 * 1024 + 17, 7)
    writeFileSync(file, payload)

    const manifest = await store.publish(file, metadata)
    expect(manifest.size).toBe(payload.length)
    const blobPath = store.blobPathFor(manifest.artifactId)
    expect(blobPath).toBeTruthy()
    expect(store.get(manifest.artifactId)?.sha256).toBe(manifest.sha256)
  })

  it('refuses to publish excluded secret paths', async () => {
    expect(pathExcluded('/repo/.env')).toBe(true)
    expect(pathExcluded('/repo/.npmrc')).toBe(true)
    expect(pathExcluded('/repo/credentials.json')).toBe(true)
    expect(pathExcluded('/home/user/.ssh/id_ed25519')).toBe(true)
    expect(pathExcluded('/repo/server.key')).toBe(true)
    expect(pathExcluded('/repo/build/output.bin')).toBe(false)
  })

  it('expires artifacts and sweeps', async () => {
    const file = join(dir, 'x.bin')
    writeFileSync(file, 'expiring bytes')
    const manifest = await store.publish(file, metadata)
    expect(store.expire(manifest.artifactId)).toBe(true)
    expect(store.get(manifest.artifactId)).toBeUndefined()
    expect(store.expire(manifest.artifactId)).toBe(false)

    // Sweep expired artifacts.
    const file2 = join(dir, 'y.bin')
    writeFileSync(file2, 'more bytes')
    const m2 = await store.publish(file2, { ...metadata, expiresAt: Date.now() - 1000 })
    expect(store.sweepExpired()).toBe(1)
    expect(store.get(m2.artifactId)).toBeUndefined()
  })

  it('persists the index across instances', async () => {
    const file = join(dir, 'p.bin')
    writeFileSync(file, 'persisted')
    await store.publish(file, metadata)
    const reloaded = new ArtifactStore({ dataDir: dir })
    expect(reloaded.list()).toHaveLength(1)
  })
})

describe('artifact transfer', () => {
  it('transfers chunked with resume and destination hash verification', async () => {
    // Source store + destination store.
    const sourceDir = join(dir, 'source')
    mkdirSync(sourceDir)
    const sourceStore = new ArtifactStore({ dataDir: sourceDir })
    const destStore = new ArtifactStore({ dataDir: dir })
    const sink = new ArtifactUploadSink(destStore, { stagingDir: destStore.stagingDirFor('client-x') })

    const file = join(sourceDir, 'big.bin')
    const payload = Buffer.alloc(TRANSFER_CHUNK_BYTES * 2 + 123, 42)
    writeFileSync(file, payload)
    const manifest = await sourceStore.publish(file, metadata)

    // Fake destination that exercises resume: first call rejects mid-transfer,
    // then a new sink (same staging dir) resumes from the verified offset.
    let attempts = 0
    const uploadChunk = async (artifactId: string, offset: number, chunkBase64: string) => {
      attempts += 1
      if (attempts === 2) throw new Error('simulated interruption')
      return sink.append(offset, chunkBase64)
    }

    await expect(
      transferArtifact(sourceStore, manifest.artifactId, {
        uploadChunk,
        completeTransfer: () => Promise.reject(new Error('should not complete on interrupt')),
      }),
    ).rejects.toThrow('simulated interruption')

    const interruptedOffset = sink.currentOffset()
    expect(interruptedOffset).toBeGreaterThan(0)
    expect(interruptedOffset).toBeLessThan(payload.length)

    // Resume with a fresh sink over the same staging dir.
    const resumedSink = new ArtifactUploadSink(destStore, { stagingDir: destStore.stagingDirFor('client-x') })
    const result = await transferArtifact(sourceStore, manifest.artifactId, {
      uploadChunk: (artifactId, offset, chunkBase64) => resumedSink.append(offset, chunkBase64),
      completeTransfer: (artifactId, sha256) => resumedSink.complete({ ...metadata, filename: `${artifactId}.bin` }),
      currentOffset: resumedSink.currentOffset(),
    })

    expect(result.resumed).toBe(true)
    expect(result.sha256).toBe(manifest.sha256)
    expect(result.bytesTransferred).toBe(payload.length - interruptedOffset)
    expect(resumedSink.currentOffset()).toBe(payload.length)
    // Destination CAS holds a verified copy with identical sha256.
    expect(destStore.list()).toHaveLength(1)
    expect(destStore.list()[0].sha256).toBe(manifest.sha256)
    expect(destStore.list()[0].size).toBe(payload.length)
  })

  it('rejects a transfer when the destination hash does not match', async () => {
    const sourceDir = join(dir, 'source2')
    mkdirSync(sourceDir)
    const sourceStore = new ArtifactStore({ dataDir: sourceDir })
    const destStore = new ArtifactStore({ dataDir: dir })
    const sink = new ArtifactUploadSink(destStore, { stagingDir: destStore.stagingDirFor('client-y'), expectedSha256: '0'.repeat(64) })

    const file = join(sourceDir, 'f.bin')
    writeFileSync(file, 'tamper me')
    const manifest = await sourceStore.publish(file, metadata)

    const uploadChunk = (artifactId: string, offset: number, chunkBase64: string) => sink.append(offset, chunkBase64)
    await expect(
      transferArtifact(sourceStore, manifest.artifactId, {
        uploadChunk,
        completeTransfer: (artifactId, sha256) => sink.complete({ ...metadata, filename: `${artifactId}.bin` }),
      }),
    ).rejects.toThrow(/SHA-256 mismatch/)
    // The partial staging file must be discarded.
    expect(destStore.list()).toHaveLength(0)
  })
})
