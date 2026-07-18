import { ipcRenderer } from 'electron'
import type { CanvasAssetBytes, CanvasAssetMetadata, CanvasAssetResult } from '../../common/canvas-assets.js'

export const canvasAssetHandlers = {
  pickCanvasAsset: (): Promise<CanvasAssetResult<CanvasAssetMetadata | null>> =>
    ipcRenderer.invoke('canvas-assets:pick'),
  importCanvasAssetBytes: (bytes: Uint8Array): Promise<CanvasAssetResult<CanvasAssetMetadata>> =>
    ipcRenderer.invoke('canvas-assets:importBytes', bytes),
  importCanvasClipboardAsset: (): Promise<CanvasAssetResult<CanvasAssetMetadata | null>> =>
    ipcRenderer.invoke('canvas-assets:importClipboard'),
  readCanvasAsset: (id: string): Promise<CanvasAssetResult<CanvasAssetBytes>> =>
    ipcRenderer.invoke('canvas-assets:read', id),
  copyCanvasAssetPath: (id: string): Promise<CanvasAssetResult<true>> =>
    ipcRenderer.invoke('canvas-assets:copyPath', id),
}
