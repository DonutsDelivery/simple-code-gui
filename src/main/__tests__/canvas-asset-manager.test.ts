import { createHash } from 'crypto'
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CanvasAssetError,
  CanvasAssetManager,
  type ImageDecoder,
} from '../canvas-asset-manager'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1])
const WEBP = Buffer.from('RIFF\x01\x00\x00\x00WEBPdata', 'binary')
const MAX_BYTES = 20 * 1024 * 1024

function pngWithDimensions(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24)
  PNG.subarray(0, 8).copy(bytes)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function jpegWithDimensions(width: number, height: number): Buffer {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, 0, 0, 0, 0])
  bytes.writeUInt16BE(height, 7)
  bytes.writeUInt16BE(width, 9)
  return bytes
}

function webpWithDimensions(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30)
  bytes.write('RIFF', 0, 'ascii')
  bytes.write('WEBP', 8, 'ascii')
  bytes.write('VP8X', 12, 'ascii')
  bytes.writeUIntLE(width - 1, 24, 3)
  bytes.writeUIntLE(height - 1, 27, 3)
  return bytes
}

function idFor(bytes: Buffer, extension: string): string {
  return `${createHash('sha256').update(bytes).digest('hex')}.${extension}`
}

function expectCode(code: CanvasAssetError['code']): { code: CanvasAssetError['code'] } {
  return { code }
}

describe('CanvasAssetManager', () => {
  let testRoot: string
  let assetRoot: string
  let decoder: ReturnType<typeof vi.fn<ImageDecoder>>
  let clipboardWriter: ReturnType<typeof vi.fn<(path: string) => void>>
  let manager: CanvasAssetManager

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'canvas-assets-test-'))
    assetRoot = join(testRoot, 'assets')
    await mkdir(assetRoot)
    decoder = vi.fn<ImageDecoder>().mockReturnValue({ width: 320, height: 200 })
    clipboardWriter = vi.fn<(path: string) => void>()
    manager = new CanvasAssetManager(assetRoot, decoder, clipboardWriter)
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  it.each([
    ['PNG', PNG, 'png', 'image/png'],
    ['JPEG', JPEG, 'jpg', 'image/jpeg'],
    ['WebP', WEBP, 'webp', 'image/webp'],
  ])('imports valid %s bytes', async (_name, bytes, extension, mimeType) => {
    const asset = await manager.importBytes(bytes)

    expect(asset).toEqual({
      id: idFor(bytes, extension),
      mimeType,
      width: 320,
      height: 200,
      byteLength: bytes.length,
    })
    expect(await manager.read(asset.id)).toEqual(bytes)
  })

  // AC: @canvas-managed-assets ac-1
  it('rejects unsupported bytes without decoding them', async () => {
    await expect(manager.importBytes(Buffer.from('not an image')))
      .rejects.toMatchObject(expectCode('invalid_format'))
    expect(decoder).not.toHaveBeenCalled()
  })

  it('rejects a selected path whose extension spoofs an image type', async () => {
    const selectedPath = join(testRoot, 'spoof.png')
    await writeFile(selectedPath, 'not an image')

    try {
      await expect(manager.importPath(selectedPath))
        .rejects.toMatchObject(expectCode('invalid_format'))
    } finally {
      await rm(selectedPath, { force: true })
    }
  })

  it('reports decode failures for signature-valid corrupt images', async () => {
    decoder.mockImplementation(() => { throw new Error('corrupt') })

    await expect(manager.importBytes(PNG)).rejects.toMatchObject(expectCode('decode_failed'))
  })

  it.each([
    ['PNG', pngWithDimensions(16_385, 1)],
    ['JPEG', jpegWithDimensions(16_385, 1)],
    ['WebP', webpWithDimensions(16_385, 1)],
  ])('rejects oversized %s header dimensions before decoding', async (_format, bytes) => {
    await expect(manager.importBytes(bytes)).rejects.toMatchObject(expectCode('too_large'))
    expect(decoder).not.toHaveBeenCalled()
  })

  it('enforces the encoded byte limit before decoding', async () => {
    const oversized = Buffer.alloc(MAX_BYTES + 1)
    PNG.copy(oversized)

    await expect(manager.importBytes(oversized)).rejects.toMatchObject(expectCode('too_large'))
    expect(decoder).not.toHaveBeenCalled()
  })

  it('accepts an image exactly at the encoded byte limit', async () => {
    const atLimit = Buffer.alloc(MAX_BYTES)
    PNG.copy(atLimit)

    await expect(manager.importBytes(atLimit)).resolves.toMatchObject({ byteLength: MAX_BYTES })
  })

  it.each([
    [{ width: 16_385, height: 1 }, 'an edge over 16384'],
    [{ width: 8_000, height: 5_001 }, 'an area over 40MP'],
  ])('rejects dimensions with %s', async (dimensions) => {
    decoder.mockReturnValue(dimensions)

    await expect(manager.importBytes(PNG)).rejects.toMatchObject(expectCode('too_large'))
  })

  it('accepts dimensions at both edge and area boundaries', async () => {
    decoder.mockReturnValueOnce({ width: 16_384, height: 1 })
    await expect(manager.importBytes(PNG)).resolves.toBeDefined()

    decoder.mockReturnValueOnce({ width: 8_000, height: 5_000 })
    await expect(manager.importBytes(JPEG)).resolves.toBeDefined()
  })

  // AC: @canvas-managed-assets ac-2
  it('deduplicates identical content under one managed ID', async () => {
    const first = await manager.importBytes(PNG)
    const second = await manager.importBytes(PNG)

    expect(second.id).toBe(first.id)
    expect((await readdir(assetRoot)).filter(name => !name.startsWith('.'))).toEqual([first.id])
  })

  it('repairs an existing file whose bytes do not match its content ID', async () => {
    const asset = await manager.importBytes(PNG)
    await writeFile(join(assetRoot, asset.id), Buffer.from('corrupt'))
    await expect(manager.read(asset.id)).rejects.toMatchObject(expectCode('not_found'))

    const duplicate = await manager.importBytes(PNG)

    expect(duplicate.id).toBe(asset.id)
    expect(await manager.read(asset.id)).toEqual(PNG)
  })

  it('deduplicates concurrent imports of identical content', async () => {
    const assets = await Promise.all(Array.from({ length: 8 }, () => manager.importBytes(JPEG)))

    expect(new Set(assets.map(asset => asset.id))).toEqual(new Set([idFor(JPEG, 'jpg')]))
    expect(await readdir(assetRoot)).toEqual([idFor(JPEG, 'jpg')])
  })

  it.each([
    '../secret.png',
    '/tmp/secret.png',
    'ABCDEF.png',
    'a'.repeat(64),
    `${'a'.repeat(64)}.gif`,
    `${'a'.repeat(63)}.png`,
    `${'g'.repeat(64)}.png`,
  ])('rejects malformed or traversal ID %s', async (id) => {
    await expect(manager.read(id)).rejects.toMatchObject(expectCode('invalid_id'))
  })

  it('returns not_found when a valid managed ID is missing', async () => {
    await expect(manager.read(`${'a'.repeat(64)}.png`))
      .rejects.toMatchObject(expectCode('not_found'))
  })

  it('bounds managed reads even if a stored file is replaced', async () => {
    const id = `${'c'.repeat(64)}.png`
    await writeFile(join(assetRoot, id), Buffer.alloc(MAX_BYTES + 1))

    await expect(manager.read(id)).rejects.toMatchObject(expectCode('too_large'))
  })

  it('imports selected regular files and rejects non-regular paths', async () => {
    const selectedPath = join(testRoot, 'selected-image')
    const selectedDirectory = join(testRoot, 'selected-directory')
    await writeFile(selectedPath, JPEG)
    await mkdir(selectedDirectory)

    try {
      await expect(manager.importPath(selectedPath)).resolves.toMatchObject({
        id: idFor(JPEG, 'jpg'),
      })
      await expect(manager.importPath(selectedDirectory))
        .rejects.toMatchObject(expectCode('invalid_format'))
    } finally {
      await rm(selectedPath, { force: true })
      await rm(selectedDirectory, { recursive: true, force: true })
    }
  })

  it('bounds selected files before reading or decoding', async () => {
    const selectedPath = join(testRoot, 'oversized-image')
    await writeFile(selectedPath, Buffer.alloc(MAX_BYTES + 1))

    try {
      await expect(manager.importPath(selectedPath)).rejects.toMatchObject(expectCode('too_large'))
      expect(decoder).not.toHaveBeenCalled()
    } finally {
      await rm(selectedPath, { force: true })
    }
  })

  it('publishes only the final file after an atomic write', async () => {
    const asset = await manager.importBytes(PNG)
    const entries = await readdir(assetRoot)

    expect(entries).toEqual([asset.id])
    expect(await manager.read(asset.id)).toEqual(PNG)
  })

  it('cleans up its own orphaned temporary files during initialization', async () => {
    const staleTemp = join(assetRoot, '.tmp-stale-import')
    await writeFile(staleTemp, PNG)
    const initializedManager = new CanvasAssetManager(assetRoot, decoder, clipboardWriter)

    const asset = await initializedManager.importBytes(JPEG)

    expect(await readdir(assetRoot)).toEqual([asset.id])
  })

  it('removes its temporary file when the atomic rename fails', async () => {
    const finalId = idFor(PNG, 'png')
    await mkdir(join(assetRoot, finalId))

    await expect(manager.importBytes(PNG)).rejects.toThrow()
    expect((await readdir(assetRoot)).every(name => !name.startsWith('.tmp-'))).toBe(true)
  })

  it('does not follow a managed-ID symlink when reading', async () => {
    const outsidePath = `${assetRoot}-outside`
    const id = `${'a'.repeat(64)}.png`
    await writeFile(outsidePath, PNG)
    await symlink(outsidePath, join(assetRoot, id))

    try {
      await expect(manager.read(id)).rejects.toMatchObject(expectCode('not_found'))
    } finally {
      await rm(outsidePath, { force: true })
    }
  })

  // AC: @canvas-managed-assets ac-3
  it('copies only a verified managed path through the injected writer', async () => {
    const asset = await manager.importBytes(WEBP)

    await manager.copyPath(asset.id)

    expect(clipboardWriter).toHaveBeenCalledOnce()
    expect(clipboardWriter).toHaveBeenCalledWith(join(assetRoot, asset.id))
    await expect(manager.copyPath('../outside.webp'))
      .rejects.toMatchObject(expectCode('invalid_id'))
  })

  it('does not copy a managed path whose content fails its ID integrity check', async () => {
    const asset = await manager.importBytes(PNG)
    await writeFile(join(assetRoot, asset.id), JPEG)

    await expect(manager.copyPath(asset.id)).rejects.toMatchObject(expectCode('not_found'))
    expect(clipboardWriter).not.toHaveBeenCalled()
  })

  it('does not copy a managed-ID symlink path', async () => {
    const outsidePath = `${assetRoot}-clipboard-outside`
    const id = `${'b'.repeat(64)}.jpg`
    await writeFile(outsidePath, JPEG)
    await symlink(outsidePath, join(assetRoot, id))

    try {
      await expect(manager.copyPath(id)).rejects.toMatchObject(expectCode('not_found'))
      expect(clipboardWriter).not.toHaveBeenCalled()
    } finally {
      await rm(outsidePath, { force: true })
    }
  })
})
