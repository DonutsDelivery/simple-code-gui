export type CanvasAssetErrorCode =
  | 'invalid_format'
  | 'too_large'
  | 'decode_failed'
  | 'not_found'
  | 'invalid_id'

export interface CanvasAssetMetadata {
  id: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  byteLength: number
}

export interface CanvasAssetBytes {
  bytes: Uint8Array
  mimeType: CanvasAssetMetadata['mimeType']
}

export type CanvasAssetResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CanvasAssetErrorCode }
