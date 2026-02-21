import { useState, useEffect, useRef } from 'react'
import { BEADS_HEIGHT_KEY, DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT } from './types.js'

export interface ResizeState {
  panelHeight: number
  isResizing: boolean
  handleResizeStart: (e: React.MouseEvent) => void
}

export function useBeadsResize(): ResizeState {
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = localStorage.getItem(BEADS_HEIGHT_KEY)
    return saved ? parseInt(saved, 10) : DEFAULT_HEIGHT
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null)

  const handleResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault()
    resizeRef.current = { startY: e.clientY, startHeight: panelHeight }
    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return

    let rafId: number | null = null
    const handleMouseMove = (e: MouseEvent): void => {
      if (!resizeRef.current) return
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (!resizeRef.current) return
        const delta = resizeRef.current.startY - e.clientY
        const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeRef.current.startHeight + delta))
        setPanelHeight(newHeight)
      })
    }

    const handleMouseUp = (): void => {
      setIsResizing(false)
      localStorage.setItem(BEADS_HEIGHT_KEY, String(panelHeight))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, panelHeight])

  return {
    panelHeight,
    isResizing,
    handleResizeStart
  }
}
