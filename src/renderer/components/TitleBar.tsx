import React, { useState, useEffect, useRef, useCallback } from 'react'

interface TitleBarProps {
  title?: string
}

export function TitleBar({ title = 'Simple Code GUI' }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false)
  const throttleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCallRef = useRef<number>(0)

  const checkMaximized = useCallback(() => {
    window.electronAPI?.windowIsMaximized?.()?.then(setIsMaximized)
  }, [])

  useEffect(() => {
    // Check initial state
    checkMaximized()

    // Throttled resize handler - limits IPC calls to once per 150ms
    const handleResize = () => {
      const now = Date.now()
      const timeSinceLastCall = now - lastCallRef.current

      if (timeSinceLastCall >= 150) {
        // Enough time has passed, call immediately
        lastCallRef.current = now
        checkMaximized()
      } else if (!throttleTimeoutRef.current) {
        // Schedule a trailing call
        throttleTimeoutRef.current = setTimeout(() => {
          lastCallRef.current = Date.now()
          throttleTimeoutRef.current = null
          checkMaximized()
        }, 150 - timeSinceLastCall)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current)
      }
    }
  }, [checkMaximized])

  const handleMinimize = () => {
    window.electronAPI?.windowMinimize()
  }

  const handleMaximize = () => {
    window.electronAPI?.windowMaximize()
    // Update state after a short delay to allow window to change
    setTimeout(() => {
      window.electronAPI?.windowIsMaximized?.()?.then(setIsMaximized)
    }, 100)
  }

  const handleClose = () => {
    window.electronAPI?.windowClose()
  }

  return (
    <div className="title-bar">
      <div className="title-bar-drag">
        <span className="title-bar-title">{title}</span>
      </div>
      <div className="title-bar-controls">
        <button
          className="title-bar-btn minimize"
          onClick={handleMinimize}
          title="Minimize"
          aria-label="Minimize window"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2" y="5.5" width="8" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="title-bar-btn maximize"
          onClick={handleMaximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
        >
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="3" y="1" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="1" y="3" width="7" height="7" fill="var(--bg-secondary)" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button
          className="title-bar-btn close"
          onClick={handleClose}
          title="Close"
          aria-label="Close window"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </div>
  )
}
