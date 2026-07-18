import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { Api } from '../../api/types'
import {
  MAX_CANVAS_TEXT_BYTES,
  type CanvasContentObject,
  type CanvasImageObject,
  type CanvasSketchObject,
  type CanvasSketchPoint,
  type CanvasSketchStroke,
  type CanvasTextObject,
} from './scene-model'

type CanvasContentApi = Pick<Api,
  'copyCanvasAssetPath' | 'importCanvasAssetBytes' | 'pickCanvasAsset' | 'readCanvasAsset'
>

interface CanvasContentBodyProps<T extends CanvasContentObject = CanvasContentObject> {
  object: T
  api?: CanvasContentApi
  onChange: (nextObject: T) => void
  onRemove: () => void
  onAnnounce: (message: string) => void
  onEditingChange?: (editing: boolean) => void
}

const stopPropagation = (event: React.SyntheticEvent): void => event.stopPropagation()

function clampUtf8(value: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(value).byteLength <= MAX_CANVAS_TEXT_BYTES) return value

  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (encoder.encode(value.slice(0, middle)).byteLength <= MAX_CANVAS_TEXT_BYTES) low = middle
    else high = middle - 1
  }
  return value.slice(0, low)
}

const CanvasTextBody = memo(function CanvasTextBody({
  object,
  onChange,
  onAnnounce,
  onEditingChange,
}: CanvasContentBodyProps<CanvasTextObject>): React.ReactElement {
  const [draft, setDraft] = useState(object.text)
  const draftRef = useRef(draft)
  const committedRef = useRef(object.text)
  const objectRef = useRef(object)
  const onChangeRef = useRef(onChange)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  objectRef.current = object
  onChangeRef.current = onChange

  useEffect(() => {
    committedRef.current = object.text
    draftRef.current = object.text
    setDraft(object.text)
  }, [object.text])

  const commit = useCallback(() => {
    clearTimeout(timerRef.current)
    const nextText = draftRef.current
    if (nextText !== committedRef.current) {
      committedRef.current = nextText
      onChangeRef.current({ ...objectRef.current, text: nextText })
    }
  }, [])

  useEffect(() => () => commit(), [commit])

  return (
    <textarea
      data-canvas-editor="true"
      aria-label={object.title ? `${object.title} note` : 'Canvas note'}
      className="canvas-content__note"
      value={draft}
      onFocus={() => onEditingChange?.(true)}
      onBlur={() => {
        commit()
        onEditingChange?.(false)
      }}
      onChange={(event) => {
        const nextDraft = clampUtf8(event.currentTarget.value)
        if (nextDraft !== event.currentTarget.value) onAnnounce('Canvas notes are limited to 100 KiB.')
        draftRef.current = nextDraft
        setDraft(nextDraft)
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(commit, 300)
      }}
      onPointerDown={stopPropagation}
      onClick={stopPropagation}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key !== 'Escape') return
        clearTimeout(timerRef.current)
        draftRef.current = committedRef.current
        setDraft(committedRef.current)
        onEditingChange?.(false)
        event.currentTarget.blur()
      }}
    />
  )
})

const CanvasImageBody = memo(function CanvasImageBody({
  object,
  api,
  onChange,
  onRemove,
  onAnnounce,
  onEditingChange,
}: CanvasContentBodyProps<CanvasImageObject>): React.ReactElement {
  const [source, setSource] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [altDraft, setAltDraft] = useState(object.altText ?? '')

  useEffect(() => setAltDraft(object.altText ?? ''), [object.altText])

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setSource(null)
    setMissing(false)

    if (!api?.readCanvasAsset) {
      setMissing(true)
      return () => { active = false }
    }

    void api.readCanvasAsset(object.assetId).then(result => {
      if (!active) return
      if (!result.ok) {
        setMissing(true)
        return
      }
      const bytes = Uint8Array.from(result.value.bytes)
      objectUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.mimeType }))
      setSource(objectUrl)
    }).catch(() => {
      if (active) setMissing(true)
    })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [api, object.assetId])

  const replace = async (): Promise<void> => {
    if (!api?.pickCanvasAsset) {
      onAnnounce('Image replacement is unavailable.')
      return
    }
    try {
      const result = await api.pickCanvasAsset()
      if (!result.ok) {
        onAnnounce('Could not replace the image.')
      } else if (result.value) {
        onChange({
          ...object,
          assetId: result.value.id,
          intrinsicWidth: result.value.width,
          intrinsicHeight: result.value.height,
        })
        onAnnounce('Image replaced.')
      }
    } catch {
      onAnnounce('Could not replace the image.')
    }
  }

  const copyPath = async (): Promise<void> => {
    if (!api?.copyCanvasAssetPath) {
      onAnnounce('Copy path is unavailable.')
      return
    }
    try {
      const result = await api.copyCanvasAssetPath(object.assetId)
      onAnnounce(result.ok ? 'Image path copied.' : 'Could not copy the image path.')
    } catch {
      onAnnounce('Could not copy the image path.')
    }
  }

  return (
    <div data-canvas-editor="true" className="canvas-content__image" onPointerDown={stopPropagation} onClick={stopPropagation} onKeyDown={stopPropagation}>
      {source && !missing ? (
        <img src={source} alt={object.altText ?? ''} draggable={false} />
      ) : missing ? (
        <div className="canvas-content__image-missing" role="status">Image unavailable</div>
      ) : (
        <div className="canvas-content__image-loading" role="status">Loading image</div>
      )}
      <div className="canvas-content__controls" role="toolbar" aria-label="Image controls">
        <button type="button" onClick={() => void copyPath()}>Copy path</button>
        <button type="button" onClick={() => void replace()}>Replace</button>
        <button type="button" onClick={onRemove}>Remove</button>
      </div>
      <label>
        <span>Alt text</span>
        <input
          value={altDraft}
          onFocus={() => onEditingChange?.(true)}
          onChange={event => setAltDraft(event.currentTarget.value)}
          onBlur={() => {
            if (altDraft !== (object.altText ?? '')) onChange({ ...object, altText: altDraft || undefined })
            onEditingChange?.(false)
          }}
        />
      </label>
    </div>
  )
})

function drawStroke(context: CanvasRenderingContext2D, stroke: CanvasSketchStroke): void {
  if (stroke.points.length === 0) return
  context.save()
  context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
  context.strokeStyle = stroke.color
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  stroke.points.forEach((point, index) => {
    const pressure = point.pressure ?? 1
    context.lineWidth = stroke.width * Math.max(0.1, pressure)
    if (index === 0) context.moveTo(point.x, point.y)
    else context.lineTo(point.x, point.y)
  })
  if (stroke.points.length === 1) context.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y + 0.01)
  context.stroke()
  context.restore()
}

function replaySketch(canvas: HTMLCanvasElement, object: CanvasSketchObject): void {
  canvas.width = object.documentSize.width
  canvas.height = object.documentSize.height
  const context = canvas.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  object.strokes.forEach(stroke => drawStroke(context, stroke))
}

function canvasBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('PNG export failed'))
        return
      }
      void blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject)
    }, 'image/png')
  })
}

const CanvasSketchBody = memo(function CanvasSketchBody({
  object,
  api,
  onChange,
  onAnnounce,
  onEditingChange,
}: CanvasContentBodyProps<CanvasSketchObject>): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latestRef = useRef(object)
  const activeStrokeRef = useRef<CanvasSketchStroke | null>(null)
  const exportTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const [tool, setTool] = useState<CanvasSketchStroke['tool']>('pen')
  const [color, setColor] = useState('#111827')
  const [strokeWidth, setStrokeWidth] = useState(3)

  latestRef.current = object

  useEffect(() => {
    if (canvasRef.current) replaySketch(canvasRef.current, object)
  }, [object])

  const exportSketch = useCallback(async (sketch: CanvasSketchObject): Promise<string | null> => {
    if (!api?.importCanvasAssetBytes) {
      onAnnounce('Sketch export is unavailable.')
      return null
    }
    try {
      const exportCanvas = document.createElement('canvas')
      replaySketch(exportCanvas, sketch)
      const result = await api.importCanvasAssetBytes(await canvasBytes(exportCanvas))
      if (!result.ok) {
        onAnnounce('Could not export the sketch. Your strokes are preserved.')
        return null
      }
      const current = latestRef.current
      if (current.revision === sketch.revision) {
        const next = { ...current, export: { assetId: result.value.id, revision: current.revision } }
        latestRef.current = next
        onChange(next)
      }
      return result.value.id
    } catch {
      onAnnounce('Could not export the sketch. Your strokes are preserved.')
      return null
    }
  }, [api, onAnnounce, onChange])

  const scheduleExport = useCallback((sketch: CanvasSketchObject) => {
    clearTimeout(exportTimerRef.current)
    exportTimerRef.current = setTimeout(() => { void exportSketch(sketch) }, 300)
  }, [exportSketch])

  useEffect(() => {
    if (!object.export || object.export.revision !== object.revision) scheduleExport(object)
    return () => clearTimeout(exportTimerRef.current)
  }, [object, scheduleExport])

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): CanvasSketchPoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) * (object.documentSize.width / bounds.width),
      y: (event.clientY - bounds.top) * (object.documentSize.height / bounds.height),
      pressure: event.pressure,
    }
  }

  const commitStroke = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.stopPropagation()
    const stroke = activeStrokeRef.current
    if (!stroke) return
    activeStrokeRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    onEditingChange?.(false)
    const current = latestRef.current
    const next = {
      ...current,
      strokes: [...current.strokes, stroke],
      revision: current.revision + 1,
    }
    latestRef.current = next
    onChange(next)
    scheduleExport(next)
  }

  const clear = (): void => {
    const current = latestRef.current
    if (current.strokes.length === 0) return
    const next = { ...current, strokes: [], revision: current.revision + 1 }
    latestRef.current = next
    onChange(next)
    if (canvasRef.current) replaySketch(canvasRef.current, next)
    scheduleExport(next)
    onAnnounce('Sketch cleared.')
  }

  const copyPath = async (): Promise<void> => {
    clearTimeout(exportTimerRef.current)
    const assetId = await exportSketch(latestRef.current)
    if (!assetId) return
    if (!api?.copyCanvasAssetPath) {
      onAnnounce('Copy path is unavailable.')
      return
    }
    try {
      const result = await api.copyCanvasAssetPath(assetId)
      onAnnounce(result.ok ? 'Sketch path copied.' : 'Could not copy the sketch path.')
    } catch {
      onAnnounce('Could not copy the sketch path.')
    }
  }

  return (
    <div data-canvas-editor="true" className="canvas-content__sketch" onPointerDown={stopPropagation} onClick={stopPropagation} onKeyDown={stopPropagation}>
      <div className="canvas-content__controls" role="toolbar" aria-label="Sketch tools">
        <button type="button" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}>Pen</button>
        <button type="button" aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>Eraser</button>
        <label className="canvas-content__color" title="Pen color">
          <span className="canvas-outline">Pen color</span>
          <input type="color" aria-label="Pen color" value={color} onChange={event => setColor(event.currentTarget.value)} />
        </label>
        <label className="canvas-content__width">
          <span>Width</span>
          <input
            type="range"
            aria-label="Stroke width"
            min="1"
            max="32"
            value={strokeWidth}
            onChange={event => setStrokeWidth(Number(event.currentTarget.value))}
          />
          <output>{strokeWidth}</output>
        </label>
        <span className="canvas-content__controls-spacer" />
        <button type="button" onClick={clear}>Clear</button>
        <button type="button" onClick={() => void copyPath()}>Copy path</button>
      </div>
      <canvas
        ref={canvasRef}
        aria-label={object.title ? `${object.title} sketch pad` : 'Sketch pad'}
        role="img"
        onPointerDown={(event) => {
          event.stopPropagation()
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture?.(event.pointerId)
          onEditingChange?.(true)
          const point = pointFromEvent(event)
          activeStrokeRef.current = {
            id: globalThis.crypto?.randomUUID?.() ?? `stroke-${Date.now()}`,
            tool,
            color,
            width: tool === 'eraser' ? Math.max(8, strokeWidth * 2) : strokeWidth,
            points: [point],
          }
        }}
        onPointerMove={(event) => {
          event.stopPropagation()
          const stroke = activeStrokeRef.current
          if (!stroke) return
          const point = pointFromEvent(event)
          stroke.points.push(point)
          const context = event.currentTarget.getContext('2d')
          if (context) drawStroke(context, { ...stroke, points: stroke.points.slice(-2) })
        }}
        onPointerUp={commitStroke}
        onPointerCancel={commitStroke}
      />
    </div>
  )
})

export const CanvasContentBody = memo(function CanvasContentBody(
  props: CanvasContentBodyProps
): React.ReactElement {
  switch (props.object.kind) {
    case 'text':
      return <CanvasTextBody {...props as CanvasContentBodyProps<CanvasTextObject>} />
    case 'image':
      return <CanvasImageBody {...props as CanvasContentBodyProps<CanvasImageObject>} />
    case 'sketch':
      return <CanvasSketchBody {...props as CanvasContentBodyProps<CanvasSketchObject>} />
  }
})

export type { CanvasContentApi, CanvasContentBodyProps }
