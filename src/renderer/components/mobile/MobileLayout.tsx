/**
 * MobileLayout Component
 *
 * Horizontal swipe-based navigation for mobile:
 * - First slide: Sidebar/navigation (projects & sessions)
 * - Other slides: Terminal sessions
 * - Swipe left/right to navigate between slides
 * - Normal vertical scrolling within each slide
 */

import React, { useRef, useState, useCallback, useEffect } from 'react'
import { OpenTab } from '../../stores/workspace'
import { Terminal } from '../Terminal'
import { Theme } from '../../themes'
import { Api } from '../../api'

interface MobileLayoutProps {
  // Sidebar content props
  sidebarContent: React.ReactNode

  // Terminal props
  tabs: OpenTab[]
  activeTabId: string | null
  theme: Theme
  api: Api
  onTabChange: (tabId: string) => void
  onCloseTab: (tabId: string) => void
}

export function MobileLayout({
  sidebarContent,
  tabs,
  activeTabId,
  theme,
  api,
  onTabChange,
  onCloseTab
}: MobileLayoutProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentSlide, setCurrentSlide] = useState(0)
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null)
  const [touchDelta, setTouchDelta] = useState(0)
  const [isHorizontalSwipe, setIsHorizontalSwipe] = useState<boolean | null>(null)

  // Total slides = 1 (sidebar) + number of tabs
  const totalSlides = 1 + tabs.length

  // Sync current slide with active tab
  useEffect(() => {
    if (activeTabId) {
      const tabIndex = tabs.findIndex(t => t.id === activeTabId)
      if (tabIndex >= 0) {
        setCurrentSlide(tabIndex + 1) // +1 because sidebar is slide 0
      }
    }
  }, [activeTabId, tabs])

  // Navigate to a specific slide
  const goToSlide = useCallback((index: number) => {
    const clampedIndex = Math.max(0, Math.min(index, totalSlides - 1))
    setCurrentSlide(clampedIndex)

    // If navigating to a tab slide, update active tab
    if (clampedIndex > 0) {
      const tab = tabs[clampedIndex - 1]
      if (tab && tab.id !== activeTabId) {
        onTabChange(tab.id)
      }
    }
  }, [totalSlides, tabs, activeTabId, onTabChange])

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    setTouchStart({ x: touch.clientX, y: touch.clientY })
    setTouchDelta(0)
    setIsHorizontalSwipe(null)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStart) return

    const touch = e.touches[0]
    const deltaX = touch.clientX - touchStart.x
    const deltaY = touch.clientY - touchStart.y

    // Determine swipe direction on first significant movement
    if (isHorizontalSwipe === null) {
      const absX = Math.abs(deltaX)
      const absY = Math.abs(deltaY)

      if (absX > 10 || absY > 10) {
        // If horizontal movement is dominant, it's a horizontal swipe
        const isHorizontal = absX > absY * 1.5
        setIsHorizontalSwipe(isHorizontal)

        if (!isHorizontal) {
          // Vertical scroll - let it happen naturally
          setTouchStart(null)
          return
        }
      }
    }

    if (isHorizontalSwipe) {
      // Prevent vertical scrolling during horizontal swipe
      e.preventDefault()
      setTouchDelta(deltaX)
    }
  }, [touchStart, isHorizontalSwipe])

  const handleTouchEnd = useCallback(() => {
    if (!touchStart || !isHorizontalSwipe) {
      setTouchStart(null)
      setTouchDelta(0)
      setIsHorizontalSwipe(null)
      return
    }

    const threshold = 50 // Minimum swipe distance to trigger navigation

    if (touchDelta > threshold && currentSlide > 0) {
      // Swipe right - go to previous slide
      goToSlide(currentSlide - 1)
    } else if (touchDelta < -threshold && currentSlide < totalSlides - 1) {
      // Swipe left - go to next slide
      goToSlide(currentSlide + 1)
    }

    setTouchStart(null)
    setTouchDelta(0)
    setIsHorizontalSwipe(null)
  }, [touchStart, isHorizontalSwipe, touchDelta, currentSlide, totalSlides, goToSlide])

  // Calculate transform for slide animation
  const getTransform = () => {
    const baseOffset = -currentSlide * 100
    const dragOffset = isHorizontalSwipe ? (touchDelta / window.innerWidth) * 100 : 0
    return `translateX(calc(${baseOffset}% + ${dragOffset}%))`
  }

  return (
    <div className="mobile-layout">
      {/* Slide container */}
      <div
        ref={containerRef}
        className="mobile-slides"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: getTransform(),
          transition: touchStart ? 'none' : 'transform 0.3s ease-out'
        }}
      >
        {/* Slide 0: Sidebar/Navigation */}
        <div className="mobile-slide mobile-slide--sidebar">
          <div className="mobile-sidebar-header">
            <span className="mobile-sidebar-title">Projects</span>
            <button
              className="mobile-refresh-btn"
              onClick={() => {
                // Clear caches and force reload
                if ('caches' in window) {
                  caches.keys().then(names => {
                    names.forEach(name => caches.delete(name))
                  })
                }
                window.location.reload()
              }}
              title="Refresh (clear cache)"
            >
              ↻
            </button>
          </div>
          <div className="mobile-slide-content">
            {sidebarContent}
          </div>
        </div>

        {/* Slides 1+: Terminal sessions */}
        {tabs.map((tab, index) => (
          <div key={tab.id} className="mobile-slide mobile-slide--terminal">
            <div className="mobile-slide-header">
              <button
                className="mobile-slide-back"
                onClick={() => goToSlide(0)}
              >
                ←
              </button>
              <span className="mobile-slide-title">{tab.title || 'Terminal'}</span>
              <button
                className="mobile-slide-close"
                onClick={() => onCloseTab(tab.id)}
              >
                ×
              </button>
            </div>
            <div className="mobile-slide-content mobile-slide-content--terminal">
              <Terminal
                ptyId={tab.ptyId}
                isActive={currentSlide === index + 1}
                theme={theme}
                projectPath={tab.projectPath}
                backend={tab.backend}
                api={api}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Dots indicator */}
      <div className="mobile-dots">
        {Array.from({ length: totalSlides }).map((_, index) => (
          <button
            key={index}
            className={`mobile-dot ${index === currentSlide ? 'mobile-dot--active' : ''}`}
            onClick={() => goToSlide(index)}
            aria-label={index === 0 ? 'Go to menu' : `Go to session ${index}`}
          />
        ))}
      </div>
    </div>
  )
}

export default MobileLayout
