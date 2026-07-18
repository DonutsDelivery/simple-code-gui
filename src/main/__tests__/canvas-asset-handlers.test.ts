import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  clipboardText: '',
  clipboardImage: {
    isEmpty: vi.fn(() => true),
    toPNG: vi.fn(() => Buffer.alloc(0)),
  },
  showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
  createFromBuffer: vi.fn(() => ({
    isEmpty: () => false,
    getSize: () => ({ width: 4, height: 3 }),
  })),
}))

vi.mock('electron', () => ({
  clipboard: {
    writeText: (value: string) => { electronMocks.clipboardText = value },
    readImage: () => electronMocks.clipboardImage,
  },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => {
      electronMocks.handlers.set(channel, handler)
    },
  },
  nativeImage: { createFromBuffer: electronMocks.createFromBuffer },
}))

import { registerCanvasAssetHandlers } from '../app/ipc-handlers/canvas-assets'

function pngFixture(): Uint8Array {
  const bytes = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(4, 16)
  bytes.writeUInt32BE(3, 20)
  return bytes
}

function webpFixture(): Uint8Array {
  const bytes = Buffer.alloc(30)
  bytes.write('RIFF', 0, 'ascii')
  bytes.write('WEBP', 8, 'ascii')
  bytes.write('VP8X', 12, 'ascii')
  bytes.writeUIntLE(3, 24, 3)
  bytes.writeUIntLE(2, 27, 3)
  return bytes
}

describe('Canvas asset IPC handlers', () => {
  let assetRoot: string

  beforeEach(async () => {
    electronMocks.handlers.clear()
    electronMocks.clipboardText = ''
    electronMocks.clipboardImage.isEmpty.mockReturnValue(true)
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    electronMocks.createFromBuffer.mockClear()
    assetRoot = await mkdtemp(join(tmpdir(), 'canvas-assets-ipc-'))
    registerCanvasAssetHandlers(assetRoot, () => null)
  })

  afterEach(async () => {
    await rm(assetRoot, { recursive: true, force: true })
  })

  // AC: @canvas-managed-assets ac-1
  it('exposes only typed, constrained Canvas asset channels', () => {
    expect([...electronMocks.handlers.keys()].sort()).toEqual([
      'canvas-assets:copyPath',
      'canvas-assets:importBytes',
      'canvas-assets:importClipboard',
      'canvas-assets:pick',
      'canvas-assets:read',
    ])
  })

  // AC: @canvas-managed-assets ac-1
  it('serializes validation errors instead of throwing them across IPC', async () => {
    const importBytes = electronMocks.handlers.get('canvas-assets:importBytes')!
    await expect(importBytes({}, new Uint8Array([1, 2, 3]))).resolves.toEqual({
      ok: false,
      error: 'invalid_format',
    })
  })

  // AC: @canvas-managed-assets ac-2
  // AC: @canvas-managed-assets ac-3
  it('imports, reads, and copies a managed asset through opaque IDs', async () => {
    const imported = await electronMocks.handlers.get('canvas-assets:importBytes')!({}, pngFixture()) as any
    expect(imported.ok).toBe(true)
    expect(imported.value.id).toMatch(/^[a-f0-9]{64}\.png$/)

    const read = await electronMocks.handlers.get('canvas-assets:read')!({}, imported.value.id) as any
    expect(read).toMatchObject({ ok: true, value: { mimeType: 'image/png' } })
    expect(Buffer.from(read.value.bytes)).toEqual(Buffer.from(pngFixture()))

    await expect(electronMocks.handlers.get('canvas-assets:copyPath')!({}, imported.value.id))
      .resolves.toEqual({ ok: true, value: true })
    expect(electronMocks.clipboardText).toBe(join(assetRoot, imported.value.id))
  })

  it('uses bounded WebP header dimensions without claiming nativeImage support', async () => {
    const imported = await electronMocks.handlers.get('canvas-assets:importBytes')!({}, webpFixture()) as any
    expect(imported).toMatchObject({
      ok: true,
      value: { mimeType: 'image/webp', width: 4, height: 3 },
    })
    expect(electronMocks.createFromBuffer).not.toHaveBeenCalled()
  })

  it('returns successful empty results when picker or clipboard has no image', async () => {
    await expect(electronMocks.handlers.get('canvas-assets:pick')!({}))
      .resolves.toEqual({ ok: true, value: null })
    await expect(electronMocks.handlers.get('canvas-assets:importClipboard')!({}))
      .resolves.toEqual({ ok: true, value: null })
  })
})
