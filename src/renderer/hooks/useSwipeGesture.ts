import { RefObject, useCallback, useEffect, useRef } from 'react'

export interface SwipeOptions {
  onSwipeLeft?: () => void      // Next tab
  onSwipeRight?: () => void     // Previous tab
  onSwipeRightEdge?: () => void // Open sidebar
  threshold?: number            // Min swipe distance (default 50px)
  edgeWidth?: number            // Edge detection zone (default 20px)
  velocityThreshold?: number    // Min velocity for swipe (default 0.3)
}

interface TouchState {
  startX: number
  startY: number
  currentX: number
  currentY: number
  startTime: number
  isTracking: boolean
  startedFromRightEdge: boolean
}

interface SwipeHandlers {
  onTouchStart: (e: TouchEvent) => void
  onTouchMove: (e: TouchEvent) => void
  onTouchEnd: (e: TouchEvent) => void
}

const DEFAULT_THRESHOLD = 50
const DEFAULT_EDGE_WIDTH = 20
const DEFAULT_VELOCITY_THRESHOLD = 0.3

export function useSwipeGesture(
  ref: RefObject<HTMLElement>,
  options: SwipeOptions
): { handlers: SwipeHandlers } {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeRightEdge,
    threshold = DEFAULT_THRESHOLD,
    edgeWidth = DEFAULT_EDGE_WIDTH,
    velocityThreshold = DEFAULT_VELOCITY_THRESHOLD,
  } = options

  const touchState = useRef<TouchState>({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    startTime: 0,
    isTracking: false,
    startedFromRightEdge: false,
  })

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 1) return

    const touch = e.touches[0]
    const screenWidth = window.innerWidth

    // Detect if touch started from right edge
    const startedFromRightEdge = touch.clientX >= screenWidth - edgeWidth

    touchState.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      currentY: touch.clientY,
      startTime: Date.now(),
      isTracking: true,
      startedFromRightEdge,
    }
  }, [edgeWidth])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchState.current.isTracking || e.touches.length !== 1) return

    const touch = e.touches[0]
    const state = touchState.current

    state.currentX = touch.clientX
    state.currentY = touch.clientY

    const deltaX = state.currentX - state.startX
    const deltaY = state.currentY - state.startY
    const absDeltaX = Math.abs(deltaX)
    const absDeltaY = Math.abs(deltaY)

    // Only prevent default if swipe is more horizontal than vertical
    // This allows normal scrolling behavior for vertical gestures
    if (absDeltaX > absDeltaY && absDeltaX > 10) {
      e.preventDefault()
    }
  }, [])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchState.current.isTracking) return

    const state = touchState.current
    state.isTracking = false

    const deltaX = state.currentX - state.startX
    const deltaY = state.currentY - state.startY
    const absDeltaX = Math.abs(deltaX)
    const absDeltaY = Math.abs(deltaY)

    // Calculate time elapsed
    const timeElapsed = Date.now() - state.startTime

    // Avoid division by zero
    if (timeElapsed === 0) return

    // Calculate velocity (pixels per millisecond)
    const velocity = absDeltaX / timeElapsed

    // Distinguish between tap, swipe, and scroll:
    // - Tap: minimal movement
    // - Scroll: more vertical than horizontal movement
    // - Swipe: more horizontal than vertical, meets threshold and velocity

    // If movement is more vertical than horizontal, treat as scroll (ignore)
    if (absDeltaY > absDeltaX) return

    // If horizontal movement doesn't meet threshold, treat as tap (ignore)
    if (absDeltaX < threshold) return

    // If velocity is too low, ignore (distinguishes from slow drag)
    if (velocity < velocityThreshold) return

    // At this point, we have a valid horizontal swipe

    // Check for right edge swipe first (takes priority)
    if (state.startedFromRightEdge && deltaX < 0 && onSwipeRightEdge) {
      // Swiped left from right edge - open sidebar
      onSwipeRightEdge()
      return
    }

    // Regular swipe left (next tab)
    if (deltaX < 0 && onSwipeLeft) {
      onSwipeLeft()
      return
    }

    // Regular swipe right (previous tab)
    if (deltaX > 0 && onSwipeRight) {
      onSwipeRight()
      return
    }
  }, [threshold, velocityThreshold, onSwipeLeft, onSwipeRight, onSwipeRightEdge])

  // Attach event listeners to the element
  useEffect(() => {
    const element = ref.current
    if (!element) return

    // Use passive: false for touchmove to allow preventDefault
    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: false })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
    }
  }, [ref, handleTouchStart, handleTouchMove, handleTouchEnd])

  // Return handlers for manual attachment if needed
  const handlers: SwipeHandlers = {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
  }

  return { handlers }
}
