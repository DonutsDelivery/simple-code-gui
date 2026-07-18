import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage } from 'electron'
import type { OpenDialogOptions } from 'electron'
import type { CanvasAssetBytes, CanvasAssetMetadata, CanvasAssetResult } from '../../../common/canvas-assets.js'
import {
  CanvasAssetError,
  CanvasAssetManager,
  type ImageDecoder,
} from '../../canvas-asset-manager.js'

const decodeImage: ImageDecoder = (bytes, format, encodedDimensions) => {
  if (format.extension === 'webp') {
    if (!encodedDimensions) throw new Error('WebP dimensions could not be read')
    return encodedDimensions
  }

  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) throw new Error('Image could not be decoded')
  return image.getSize()
}

function mimeTypeFor(id: string): CanvasAssetMetadata['mimeType'] {
  if (id.endsWith('.png')) return 'image/png'
  if (id.endsWith('.jpg')) return 'image/jpeg'
  return 'image/webp'
}

function asByteArray(value: unknown): Uint8Array | null {
  if (!ArrayBuffer.isView(value)
    || !('BYTES_PER_ELEMENT' in value)
    || value.BYTES_PER_ELEMENT !== 1) return null
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

async function resultOf<T>(operation: () => Promise<T>): Promise<CanvasAssetResult<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    if (error instanceof CanvasAssetError) return { ok: false, error: error.code }
    console.error('Canvas asset operation failed:', error)
    return { ok: false, error: 'decode_failed' }
  }
}

export function registerCanvasAssetHandlers(
  assetRoot: string,
  getMainWindow: () => BrowserWindow | null,
): void {
  const manager = new CanvasAssetManager(assetRoot, decodeImage, path => clipboard.writeText(path))

  ipcMain.handle('canvas-assets:pick', (): Promise<CanvasAssetResult<CanvasAssetMetadata | null>> => resultOf(async () => {
    const options: OpenDialogOptions = {
      title: 'Add image to Canvas',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    }
    const mainWindow = getMainWindow()
    const selection = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (selection.canceled || !selection.filePaths[0]) return null
    return manager.importPath(selection.filePaths[0])
  }))

  ipcMain.handle('canvas-assets:importBytes', (_event, value: unknown): Promise<CanvasAssetResult<CanvasAssetMetadata>> => {
    const bytes = asByteArray(value)
    if (!bytes) return Promise.resolve({ ok: false, error: 'invalid_format' })
    return resultOf(() => manager.importBytes(bytes))
  })

  ipcMain.handle('canvas-assets:importClipboard', (): Promise<CanvasAssetResult<CanvasAssetMetadata | null>> => resultOf(async () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    return manager.importBytes(image.toPNG())
  }))

  ipcMain.handle('canvas-assets:read', (_event, id: string): Promise<CanvasAssetResult<CanvasAssetBytes>> => resultOf(async () => {
    const bytes = await manager.read(id)
    return { bytes: new Uint8Array(bytes), mimeType: mimeTypeFor(id) }
  }))

  ipcMain.handle('canvas-assets:copyPath', (_event, id: string): Promise<CanvasAssetResult<true>> => resultOf(async () => {
    await manager.copyPath(id)
    return true as const
  }))
}
