import { useState, useEffect, useCallback, useRef, MutableRefObject } from 'react'
import type { ClientToCanvasPercent } from './types.js'

interface UsePanningResult {
  panX: number
  isPanning: boolean
  handlePanStart: (e: React.MouseEvent) => void
  clientToCanvasPercent: ClientToCanvasPercent
  clientToCanvasPercentRef: MutableRefObject<ClientToCanvasPercent>
}

const DRAG_THRESHOLD = 3 // px of movement before we consider it a drag, not a click

export function usePanning(
  containerRef: MutableRefObject<HTMLDivElement | null>,
  canvasWidth: number,
  viewportWidth: number,
  viewportHeight: number
): UsePanningResult {
  const [panX, setPanX] = useState(0)
  const [isPanning, setIsPanning] = useState(false)
  const panXRef = useRef(panX)
  panXRef.current = panX

  const maxPan = Math.max(0, canvasWidth - viewportWidth)
  const maxPanRef = useRef(maxPan)
  maxPanRef.current = maxPan

  // Clamp panX when bounds change (e.g. tiles removed)
  useEffect(() => {
    if (panX > maxPan) {
      setPanX(maxPan)
    }
  }, [panX, maxPan])

  const clientToCanvasPercent: ClientToCanvasPercent = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current
    if (!container || viewportWidth === 0 || viewportHeight === 0) {
      return { x: 0, y: 0 }
    }
    const rect = container.getBoundingClientRect()
    const x = (clientX - rect.left + panXRef.current) / viewportWidth * 100
    const y = (clientY - rect.top) / viewportHeight * 100
    return { x, y }
  }, [containerRef, viewportWidth, viewportHeight])

  const clientToCanvasPercentRef = useRef(clientToCanvasPercent)
  clientToCanvasPercentRef.current = clientToCanvasPercent

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    // Middle mouse button only
    if (e.button !== 1) return

    const startX = e.clientX
    const startY = e.clientY
    const startPanX = panXRef.current
    let dragging = false
    let rafId: number | null = null

    const handleMove = (moveE: MouseEvent) => {
      const dx = Math.abs(moveE.clientX - startX)
      const dy = Math.abs(moveE.clientY - startY)

      // Start panning once movement exceeds threshold
      if (!dragging && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
        dragging = true
        setIsPanning(true)
      }

      if (!dragging) return

      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const panDx = startX - moveE.clientX
        const newPanX = Math.max(0, Math.min(maxPanRef.current, startPanX + panDx))
        setPanX(newPanX)
      })
    }

    // Suppress middle-click paste when we're dragging (not clicking)
    const suppressPaste = (pasteE: MouseEvent) => {
      if (dragging && pasteE.button === 1) {
        pasteE.preventDefault()
        pasteE.stopPropagation()
      }
    }

    const handleUp = (upE: MouseEvent) => {
      if (rafId !== null) cancelAnimationFrame(rafId)

      if (dragging) {
        // We were panning — suppress paste and clean up
        setIsPanning(false)
        upE.preventDefault()
        upE.stopPropagation()
        // Trigger terminal refit after panning
        window.dispatchEvent(new Event('resize'))
      }
      // If not dragging, do nothing — let xterm handle paste naturally

      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp, true)
      // Defer removal: auxclick fires AFTER mouseup in the same cycle,
      // so the suppressPaste listener must survive until then
      setTimeout(() => {
        window.removeEventListener('click', suppressPaste, true)
        window.removeEventListener('auxclick', suppressPaste, true)
      }, 0)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp, true)      // capture phase
    window.addEventListener('click', suppressPaste, true)    // capture phase
    window.addEventListener('auxclick', suppressPaste, true) // capture phase — middle-click fires auxclick
  }, [])

  return {
    panX,
    isPanning,
    handlePanStart,
    clientToCanvasPercent,
    clientToCanvasPercentRef
  }
}
