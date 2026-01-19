import React, { memo, useCallback } from 'react'

export interface SwipeDotsProps {
  current: number      // 0-indexed current tab
  total: number        // Total number of tabs
  onDotClick?: (index: number) => void  // Optional direct navigation
}

const MAX_DOTS = 5

/**
 * Mobile tab indicator - shows dots for up to 5 tabs,
 * or a "2/8" style counter for more tabs
 */
export const SwipeDots = memo(function SwipeDots({ current, total, onDotClick }: SwipeDotsProps) {
  const handleDotClick = useCallback((index: number) => {
    if (onDotClick) {
      onDotClick(index)
    }
  }, [onDotClick])

  // If more than MAX_DOTS tabs, show counter instead
  if (total > MAX_DOTS) {
    return (
      <div className="swipe-dots" role="status" aria-label={`Tab ${current + 1} of ${total}`}>
        <span className="swipe-counter">
          {current + 1}/{total}
        </span>
      </div>
    )
  }

  // Show individual dots
  return (
    <div className="swipe-dots" role="tablist" aria-label="Tab navigation">
      {Array.from({ length: total }, (_, index) => (
        <button
          key={index}
          className={`swipe-dot ${index === current ? 'active' : ''}`}
          role="tab"
          aria-selected={index === current}
          aria-label={`Tab ${index + 1}`}
          onClick={() => handleDotClick(index)}
          tabIndex={index === current ? 0 : -1}
        />
      ))}
    </div>
  )
})
