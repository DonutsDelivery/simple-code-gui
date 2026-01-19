import { useState, useEffect, useMemo, useRef, useCallback } from 'react'

// Declare Capacitor type for native platform detection
declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean
    }
  }
}

export interface MobileInfo {
  isMobile: boolean              // True if mobile viewport OR native app
  isNativeApp: boolean           // True if running in Capacitor
  isTouchDevice: boolean         // True if touch capable
  viewportWidth: number          // Current viewport width
  orientation: 'portrait' | 'landscape'
}

const MOBILE_BREAKPOINT = 768
const DEBOUNCE_MS = 100

// SSR-safe check for window
const isClient = typeof window !== 'undefined'

// Check if running in Capacitor native app
function checkIsNativeApp(): boolean {
  if (!isClient) return false
  return typeof window.Capacitor !== 'undefined' &&
         window.Capacitor?.isNativePlatform?.() === true
}

// Check for touch capability
function checkIsTouchDevice(): boolean {
  if (!isClient) return false
  return 'ontouchstart' in window ||
         navigator.maxTouchPoints > 0 ||
         // @ts-expect-error - msMaxTouchPoints is IE-specific
         navigator.msMaxTouchPoints > 0
}

// Get current viewport width
function getViewportWidth(): number {
  if (!isClient) return MOBILE_BREAKPOINT // Default to mobile breakpoint for SSR
  return window.innerWidth
}

// Determine orientation from dimensions
function getOrientation(): 'portrait' | 'landscape' {
  if (!isClient) return 'portrait'
  return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape'
}

export function useIsMobile(): MobileInfo {
  // Initialize state with current values (SSR-safe)
  const [viewportWidth, setViewportWidth] = useState<number>(getViewportWidth)
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(getOrientation)

  // These values don't change during session, so compute once
  const isNativeApp = useMemo(() => checkIsNativeApp(), [])
  const isTouchDevice = useMemo(() => checkIsTouchDevice(), [])

  // Ref to track timeout for debouncing
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced update handler
  const handleResize = useCallback(() => {
    // Clear any pending update
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Schedule debounced update
    debounceTimerRef.current = setTimeout(() => {
      setViewportWidth(getViewportWidth())
      setOrientation(getOrientation())
    }, DEBOUNCE_MS)
  }, [])

  // Set up resize and orientation change listeners
  useEffect(() => {
    if (!isClient) return

    // Initial sync (in case values changed between render and effect)
    setViewportWidth(getViewportWidth())
    setOrientation(getOrientation())

    // Listen to both resize and orientation change events
    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)

      // Clear any pending debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [handleResize])

  // Memoize the result object to prevent unnecessary re-renders
  const mobileInfo = useMemo<MobileInfo>(() => {
    const isMobileViewport = viewportWidth < MOBILE_BREAKPOINT

    return {
      isMobile: isMobileViewport || isNativeApp,
      isNativeApp,
      isTouchDevice,
      viewportWidth,
      orientation,
    }
  }, [viewportWidth, orientation, isNativeApp, isTouchDevice])

  return mobileInfo
}
