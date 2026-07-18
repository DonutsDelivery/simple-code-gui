import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasContentBody, type CanvasContentApi } from '../components/canvas/CanvasContentBody'
import type { CanvasImageObject, CanvasSketchObject, CanvasTextObject } from '../components/canvas/scene-model'

const textObject: CanvasTextObject = {
  id: 'note-1',
  kind: 'text',
  text: 'Committed note',
  rect: { x: 0, y: 0, width: 300, height: 200 },
  zIndex: 1,
}

const imageObject: CanvasImageObject = {
  id: 'image-1',
  kind: 'image',
  assetId: 'old.png',
  altText: 'Diagram',
  intrinsicWidth: 640,
  intrinsicHeight: 480,
  rect: { x: 0, y: 0, width: 300, height: 200 },
  zIndex: 1,
}

const sketchObject: CanvasSketchObject = {
  id: 'sketch-1',
  kind: 'sketch',
  documentSize: { width: 400, height: 200 },
  strokes: [],
  revision: 0,
  rect: { x: 0, y: 0, width: 400, height: 200 },
  zIndex: 1,
}

const context = {
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  stroke: vi.fn(),
  globalCompositeOperation: 'source-over',
  lineCap: 'round',
  lineJoin: 'round',
  lineWidth: 1,
  strokeStyle: '',
} as unknown as CanvasRenderingContext2D

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => {
    callback({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Blob)
  })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:canvas-image') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Canvas content bodies', () => {
  // AC: @canvas-notes-images ac-1
  it('edits plain-text notes on idle or blur and restores committed text on Escape', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const onEditingChange = vi.fn()
    render(
      <CanvasContentBody
        object={textObject}
        onChange={onChange}
        onRemove={vi.fn()}
        onAnnounce={vi.fn()}
        onEditingChange={onEditingChange}
      />
    )

    const note = screen.getByRole('textbox', { name: 'Canvas note' })
    expect(note).toHaveAttribute('data-canvas-editor', 'true')
    fireEvent.focus(note)
    fireEvent.change(note, { target: { value: '<b>plain text</b>' } })
    expect(onChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenLastCalledWith({ ...textObject, text: '<b>plain text</b>' })

    fireEvent.change(note, { target: { value: 'discard me' } })
    fireEvent.keyDown(note, { key: 'Escape' })
    expect(note).toHaveValue('<b>plain text</b>')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onEditingChange).toHaveBeenLastCalledWith(false)

    fireEvent.change(note, { target: { value: 'blur commit' } })
    fireEvent.blur(note)
    expect(onChange).toHaveBeenLastCalledWith({ ...textObject, text: 'blur commit' })
  })

  // AC: @canvas-notes-images ac-1
  it('limits note drafts to 100 KiB and announces truncation', () => {
    const onAnnounce = vi.fn()
    render(
      <CanvasContentBody
        object={textObject}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onAnnounce={onAnnounce}
      />
    )

    const note = screen.getByRole('textbox', { name: 'Canvas note' })
    fireEvent.change(note, { target: { value: 'é'.repeat(60 * 1024) } })
    expect(new TextEncoder().encode((note as HTMLTextAreaElement).value).byteLength).toBe(100 * 1024)
    expect(onAnnounce).toHaveBeenCalledWith('Canvas notes are limited to 100 KiB.')
  })

  // AC: @canvas-notes-images ac-2
  // AC: @canvas-managed-assets ac-3
  it('loads managed images, replaces metadata, edits alt text, copies the path, and cleans blob URLs', async () => {
    const api = {
      readCanvasAsset: vi.fn().mockResolvedValue({
        ok: true,
        value: { bytes: new Uint8Array([1]), mimeType: 'image/png' },
      }),
      pickCanvasAsset: vi.fn().mockResolvedValue({
        ok: true,
        value: { id: 'new.png', mimeType: 'image/png', width: 800, height: 600, byteLength: 3 },
      }),
      copyCanvasAssetPath: vi.fn().mockResolvedValue({ ok: true, value: true }),
    } as unknown as CanvasContentApi
    const onChange = vi.fn()
    const onAnnounce = vi.fn()
    const view = render(
      <CanvasContentBody
        object={imageObject}
        api={api}
        onChange={onChange}
        onRemove={vi.fn()}
        onAnnounce={onAnnounce}
      />
    )

    expect(await screen.findByRole('img', { name: 'Diagram' })).toHaveAttribute('src', 'blob:canvas-image')
    expect(view.container.querySelector('.canvas-content__image')).toHaveAttribute('data-canvas-editor', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))
    await waitFor(() => expect(api.copyCanvasAssetPath).toHaveBeenCalledWith('old.png'))

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({
      ...imageObject,
      assetId: 'new.png',
      intrinsicWidth: 800,
      intrinsicHeight: 600,
    }))

    const altText = screen.getByRole('textbox', { name: 'Alt text' })
    fireEvent.change(altText, { target: { value: 'Updated diagram' } })
    fireEvent.blur(altText)
    expect(onChange).toHaveBeenCalledWith({ ...imageObject, altText: 'Updated diagram' })
    expect(onAnnounce).toHaveBeenCalledWith('Image path copied.')

    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:canvas-image')
  })

  // AC: @canvas-notes-images ac-3
  it('keeps a stable missing-image placeholder with replace and remove actions', async () => {
    const onRemove = vi.fn()
    const api = {
      readCanvasAsset: vi.fn().mockResolvedValue({ ok: false, error: 'not_found' }),
      pickCanvasAsset: vi.fn().mockResolvedValue({ ok: true, value: null }),
    } as unknown as CanvasContentApi
    render(
      <CanvasContentBody
        object={imageObject}
        api={api}
        onChange={vi.fn()}
        onRemove={onRemove}
        onAnnounce={vi.fn()}
      />
    )

    expect(await screen.findByRole('status')).toHaveTextContent('Image unavailable')
    expect(screen.getByRole('button', { name: 'Replace' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  // AC: @canvas-sketch-pad ac-1
  it('replays sketches and commits one document-coordinate pressure stroke at pointer-up', () => {
    const onChange = vi.fn()
    const onEditingChange = vi.fn()
    const seeded: CanvasSketchObject = {
      ...sketchObject,
      export: { assetId: 'current.png', revision: 0 },
      strokes: [{ id: 'seed', tool: 'pen', color: '#000', width: 2, points: [{ x: 1, y: 2 }] }],
    }
    const { container } = render(
      <CanvasContentBody
        object={seeded}
        onChange={onChange}
        onRemove={vi.fn()}
        onAnnounce={vi.fn()}
        onEditingChange={onEditingChange}
      />
    )
    const canvas = container.querySelector('canvas')!
    expect(canvas.closest('.canvas-content__sketch')).toHaveAttribute('data-canvas-editor', 'true')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 10, top: 20, width: 200, height: 100, right: 210, bottom: 120, x: 10, y: 20, toJSON: () => {},
    })

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 20, clientY: 30, pressure: 0.5 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 110, clientY: 70, pressure: 0.75 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 110, clientY: 70, pressure: 0.75 })

    expect(onChange).toHaveBeenCalledOnce()
    const next = onChange.mock.calls[0][0] as CanvasSketchObject
    expect(next.revision).toBe(1)
    expect(next.strokes).toHaveLength(2)
    expect(next.strokes[1].points).toEqual([
      expect.objectContaining({ x: 20, y: 20 }),
      expect.objectContaining({ x: 200, y: 100 }),
    ])
    expect(onEditingChange).toHaveBeenNthCalledWith(1, true)
    expect(onEditingChange).toHaveBeenLastCalledWith(false)
    expect(context.stroke).toHaveBeenCalled()
  })

  // AC: @canvas-sketch-pad ac-2
  it('supports erasing and clearing with revision increments', () => {
    const onChange = vi.fn()
    const seeded: CanvasSketchObject = {
      ...sketchObject,
      revision: 4,
      export: { assetId: 'old.png', revision: 4 },
      strokes: [{ id: 'seed', tool: 'pen', color: '#000', width: 2, points: [{ x: 1, y: 2 }] }],
    }
    const { container } = render(
      <CanvasContentBody object={seeded} onChange={onChange} onRemove={vi.fn()} onAnnounce={vi.fn()} />
    )
    const canvas = container.querySelector('canvas')!
    expect(canvas.closest('.canvas-content__sketch')).toHaveAttribute('data-canvas-editor', 'true')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => {},
    })

    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }))
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 5, clientY: 5 })
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 5, clientY: 5 })
    expect(onChange.mock.calls[0][0].strokes.at(-1).tool).toBe('eraser')
    expect(onChange.mock.calls[0][0].revision).toBe(5)

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange.mock.calls[1][0]).toEqual(expect.objectContaining({ strokes: [], revision: 6 }))
  })

  // AC: @canvas-sketch-pad ac-3
  it('debounces stale PNG exports and forces a current export before copying its returned path', async () => {
    vi.useFakeTimers()
    const api = {
      importCanvasAssetBytes: vi.fn()
        .mockResolvedValueOnce({ ok: true, value: { id: 'debounced.png', mimeType: 'image/png', width: 400, height: 200, byteLength: 3 } })
        .mockResolvedValueOnce({ ok: true, value: { id: 'forced.png', mimeType: 'image/png', width: 400, height: 200, byteLength: 3 } }),
      copyCanvasAssetPath: vi.fn().mockResolvedValue({ ok: true, value: true }),
    } as unknown as CanvasContentApi
    const onChange = vi.fn()
    render(
      <CanvasContentBody
        object={{ ...sketchObject, revision: 2, export: { assetId: 'stale.png', revision: 1 } }}
        api={api}
        onChange={onChange}
        onRemove={vi.fn()}
        onAnnounce={vi.fn()}
      />
    )

    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(api.importCanvasAssetBytes).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      export: { assetId: 'debounced.png', revision: 2 },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(api.importCanvasAssetBytes).toHaveBeenCalledTimes(2)
    expect(api.copyCanvasAssetPath).toHaveBeenCalledWith('forced.png')
  })

  // AC: @canvas-sketch-pad ac-3
  it('preserves strokes and announces failed sketch exports', async () => {
    vi.useFakeTimers()
    const onAnnounce = vi.fn()
    const onChange = vi.fn()
    const api = {
      importCanvasAssetBytes: vi.fn().mockResolvedValue({ ok: false, error: 'too_large' }),
    } as unknown as CanvasContentApi
    const seeded = {
      ...sketchObject,
      revision: 1,
      strokes: [{ id: 'seed', tool: 'pen' as const, color: '#000', width: 2, points: [{ x: 1, y: 2 }] }],
    }
    render(
      <CanvasContentBody object={seeded} api={api} onChange={onChange} onRemove={vi.fn()} onAnnounce={onAnnounce} />
    )

    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(onChange).not.toHaveBeenCalled()
    expect(seeded.strokes).toHaveLength(1)
    expect(onAnnounce).toHaveBeenCalledWith('Could not export the sketch. Your strokes are preserved.')
  })
})
