import { createHash, randomUUID } from 'crypto'
import { constants } from 'fs'
import { lstat, mkdir, open, readdir, rename, rm, writeFile, type FileHandle } from 'fs/promises'
import { join } from 'path'

const MAX_ENCODED_BYTES = 20 * 1024 * 1024
const MAX_EDGE = 16_384
const MAX_AREA = 40_000_000
const ASSET_ID_PATTERN = /^[a-f0-9]{64}\.(?:png|jpg|webp)$/

export type CanvasAssetErrorCode =
  | 'invalid_format'
  | 'too_large'
  | 'decode_failed'
  | 'not_found'
  | 'invalid_id'

export class CanvasAssetError extends Error {
  constructor(
    public readonly code: CanvasAssetErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CanvasAssetError'
  }
}

export interface ImageDimensions {
  width: number
  height: number
}

export type ImageDecoder = (bytes: Buffer) => ImageDimensions | Promise<ImageDimensions>
export type ClipboardPathWriter = (path: string) => void | Promise<void>

export interface CanvasAsset {
  id: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  byteLength: number
}

interface ImageFormat {
  extension: 'png' | 'jpg' | 'webp'
  mimeType: CanvasAsset['mimeType']
}

export class CanvasAssetManager {
  private readonly inFlightImports = new Map<string, Promise<CanvasAsset>>()
  private initialization: Promise<void> | null = null

  constructor(
    private readonly assetRoot: string,
    private readonly decoder: ImageDecoder,
    private readonly clipboardWriter: ClipboardPathWriter,
  ) {}

  async importBytes(input: Uint8Array): Promise<CanvasAsset> {
    if (input.byteLength > MAX_ENCODED_BYTES) {
      throw new CanvasAssetError('too_large', 'Image exceeds the 20 MiB encoded size limit')
    }
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input)

    const format = detectFormat(bytes)
    if (!format) {
      throw new CanvasAssetError('invalid_format', 'Only PNG, JPEG, and WebP images are supported')
    }

    const digest = createHash('sha256').update(bytes).digest('hex')
    const existing = this.inFlightImports.get(digest)
    if (existing) return existing

    const operation = this.finishImport(bytes, format, digest).finally(() => {
      if (this.inFlightImports.get(digest) === operation) this.inFlightImports.delete(digest)
    })
    this.inFlightImports.set(digest, operation)
    return operation
  }

  async importPath(selectedPath: string): Promise<CanvasAsset> {
    let pathInfo
    try {
      pathInfo = await lstat(selectedPath)
    } catch (error) {
      if (isMissing(error)) {
        throw new CanvasAssetError('not_found', 'Selected image was not found', { cause: error })
      }
      throw error
    }

    if (!pathInfo.isFile()) {
      throw new CanvasAssetError('invalid_format', 'Selected path must be a regular file')
    }
    if (pathInfo.size > MAX_ENCODED_BYTES) {
      throw new CanvasAssetError('too_large', 'Image exceeds the 20 MiB encoded size limit')
    }

    let handle
    try {
      handle = await openReadOnly(selectedPath)
    } catch (error) {
      if (isMissing(error)) {
        throw new CanvasAssetError('not_found', 'Selected image was not found', { cause: error })
      }
      throw error
    }
    try {
      const openedInfo = await handle.stat()
      if (!openedInfo.isFile() || !isSameFile(pathInfo, openedInfo)) {
        throw new CanvasAssetError('invalid_format', 'Selected path must be an unchanged regular file')
      }
      if (openedInfo.size > MAX_ENCODED_BYTES) {
        throw new CanvasAssetError('too_large', 'Image exceeds the 20 MiB encoded size limit')
      }
      return await this.importBytes(await readBounded(handle))
    } finally {
      await handle.close()
    }
  }

  async read(id: string): Promise<Buffer> {
    const path = this.resolveId(id)
    const before = await this.requireManagedFile(path)
    let handle
    try {
      handle = await openReadOnly(path)
      const info = await handle.stat()
      if (!info.isFile() || !isSameFile(before, info)) {
        throw new CanvasAssetError('not_found', 'Managed asset was not found')
      }
      const bytes = await readBounded(handle)
      if (createHash('sha256').update(bytes).digest('hex') !== id.slice(0, 64)) {
        throw new CanvasAssetError('not_found', 'Managed asset was not found')
      }
      return bytes
    } catch (error) {
      if (error instanceof CanvasAssetError) throw error
      if (isMissing(error)) {
        throw new CanvasAssetError('not_found', 'Managed asset was not found', { cause: error })
      }
      throw error
    } finally {
      await handle?.close()
    }
  }

  async copyPath(id: string): Promise<void> {
    await this.read(id)
    await this.clipboardWriter(this.resolveId(id))
  }

  private ensureInitialized(): Promise<void> {
    this.initialization ??= this.initialize()
    return this.initialization
  }

  private async initialize(): Promise<void> {
    await mkdir(this.assetRoot, { recursive: true, mode: 0o700 })
    const entries = await readdir(this.assetRoot)
    await Promise.all(entries
      .filter(name => name.startsWith('.tmp-'))
      .map(name => rm(join(this.assetRoot, name), { force: true })))
  }

  private async requireManagedFile(path: string) {
    let info
    try {
      info = await lstat(path)
    } catch (error) {
      if (isMissing(error)) {
        throw new CanvasAssetError('not_found', 'Managed asset was not found', { cause: error })
      }
      throw error
    }
    if (!info.isFile()) {
      throw new CanvasAssetError('not_found', 'Managed asset was not found')
    }
    return info
  }

  private resolveId(id: string): string {
    if (!ASSET_ID_PATTERN.test(id)) {
      throw new CanvasAssetError('invalid_id', 'Invalid managed asset ID')
    }
    return join(this.assetRoot, id)
  }

  private async finishImport(bytes: Buffer, format: ImageFormat, digest: string): Promise<CanvasAsset> {
    const preflight = readEncodedDimensions(bytes, format)
    if (preflight) validateDimensions(preflight)

    let dimensions
    try {
      dimensions = await this.decoder(bytes)
    } catch (error) {
      throw new CanvasAssetError('decode_failed', 'Image could not be decoded', { cause: error })
    }
    validateDimensions(dimensions)

    const id = `${digest}.${format.extension}`
    await this.ensureInitialized()
    const finalPath = this.resolveId(id)
    if (!(await fileHasDigest(finalPath, digest))) {
      await this.atomicWrite(finalPath, bytes, digest)
    }

    return {
      id,
      mimeType: format.mimeType,
      width: dimensions.width,
      height: dimensions.height,
      byteLength: bytes.byteLength,
    }
  }

  private async atomicWrite(finalPath: string, bytes: Buffer, digest: string): Promise<void> {
    const tempPath = join(this.assetRoot, `.tmp-${process.pid}-${randomUUID()}`)
    try {
      await writeFile(tempPath, bytes, { flag: 'wx', mode: 0o600 })
      try {
        await rename(tempPath, finalPath)
      } catch (error) {
        if (!(await fileHasDigest(finalPath, digest))) throw error
      }
    } finally {
      await rm(tempPath, { force: true })
    }
  }
}

function detectFormat(bytes: Buffer): ImageFormat | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]))) {
    return { extension: 'png', mimeType: 'image/png' }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: 'jpg', mimeType: 'image/jpeg' }
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', mimeType: 'image/webp' }
  }
  return null
}

function readEncodedDimensions(bytes: Buffer, format: ImageFormat): ImageDimensions | null {
  if (
    format.extension === 'png'
    && bytes.length >= 24
    && bytes.subarray(12, 16).toString('ascii') === 'IHDR'
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }

  if (format.extension === 'jpg') {
    let offset = 2
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      while (bytes[offset] === 0xff) offset += 1
      const marker = bytes[offset]
      offset += 1
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (marker === 0xd9 || marker === 0xda || offset + 1 >= bytes.length) break

      const segmentLength = bytes.readUInt16BE(offset)
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf
        && ![0xc4, 0xc8, 0xcc].includes(marker)
      if (isStartOfFrame && segmentLength >= 7) {
        return {
          width: bytes.readUInt16BE(offset + 5),
          height: bytes.readUInt16BE(offset + 3),
        }
      }
      offset += segmentLength
    }
  }

  if (format.extension === 'webp' && bytes.length >= 30) {
    const chunk = bytes.subarray(12, 16).toString('ascii')
    if (chunk === 'VP8X') {
      return {
        width: 1 + bytes.readUIntLE(24, 3),
        height: 1 + bytes.readUIntLE(27, 3),
      }
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      }
    }
    if (chunk === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      return {
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
      }
    }
  }

  return null
}

function validateDimensions({ width, height }: ImageDimensions): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new CanvasAssetError('decode_failed', 'Decoder returned invalid image dimensions')
  }
  if (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_AREA) {
    throw new CanvasAssetError('too_large', 'Image dimensions exceed the managed asset limits')
  }
}

async function readBounded(handle: FileHandle): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0

  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_ENCODED_BYTES + 1 - total))
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
    if (bytesRead === 0) return Buffer.concat(chunks, total)

    total += bytesRead
    if (total > MAX_ENCODED_BYTES) {
      throw new CanvasAssetError('too_large', 'Image exceeds the 20 MiB encoded size limit')
    }
    chunks.push(chunk.subarray(0, bytesRead))
  }
}

async function fileHasDigest(path: string, digest: string): Promise<boolean> {
  let before
  try {
    before = await lstat(path)
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
  if (!before.isFile() || before.size > MAX_ENCODED_BYTES) return false

  let handle
  try {
    handle = await openReadOnly(path)
    const info = await handle.stat()
    if (!info.isFile() || !isSameFile(before, info) || info.size > MAX_ENCODED_BYTES) return false
    const bytes = await readBounded(handle)
    return createHash('sha256').update(bytes).digest('hex') === digest
  } catch (error) {
    if (isMissing(error) || (error instanceof CanvasAssetError && error.code === 'too_large')) {
      return false
    }
    throw error
  } finally {
    await handle?.close()
  }
}

function openReadOnly(path: string): Promise<FileHandle> {
  // lstat/fstat identity checks preserve no-follow behavior where O_NOFOLLOW is unavailable.
  return open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
}

function isSameFile(before: { dev: bigint | number; ino: bigint | number }, after: { dev: bigint | number; ino: bigint | number }): boolean {
  return before.dev === after.dev && before.ino === after.ino
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
