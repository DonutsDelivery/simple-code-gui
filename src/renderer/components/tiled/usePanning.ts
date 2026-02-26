import { useState, useEffect, useCallback, useRef, MutableRefObject } from 'react'
import type { ClientToCanvasPercent } from './types.js'

interface UsePanningResult {
  panX: number
  isPanning: boolean
  handlePanStart: (e: React.MouseEvent) => void
  clientToCanvasPercent: ClientToCanvasPercent
  clientToCanvasPercentRef: MutableRefObject<ClientToCanvasPercent>
}

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

    // Don't pan if clicking inside a terminal area (preserve middle-click paste)
    const target = e.target as HTMLElement
    if (target.closest('.tile-terminal')) return

    e.preventDefault()
    setIsPanning(true)

    const startX = e.clientX
    const startPanX = panXRef.current
    let rafId: number | null = null

    const handleMove = (moveE: MouseEvent) => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const dx = startX - moveE.clientX
        const newPanX = Math.max(0, Math.min(maxPan, startPanX + dx))
        setPanX(newPanX)
      })
    }

    const handleUp = () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      setIsPanning(false)
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      // Trigger terminal refit after panning
      window.dispatchEvent(new Event('resize'))
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [maxPan])

  return {
    panX,
    isPanning,
    handlePanStart,
    clientToCanvasPercent,
    clientToCanvasPercentRef
  }
}
