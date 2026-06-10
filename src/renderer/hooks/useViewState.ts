import { useState } from 'react'

interface UseViewStateReturn {
  lastFocusedTabId: string | null
  sidebarWidth: number
  sidebarCollapsed: boolean
  setLastFocusedTabId: (id: string | null) => void
  setSidebarWidth: (width: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

export function useViewState(): UseViewStateReturn {
  const [lastFocusedTabId, setLastFocusedTabId] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return {
    lastFocusedTabId,
    sidebarWidth,
    sidebarCollapsed,
    setLastFocusedTabId,
    setSidebarWidth,
    setSidebarCollapsed,
  }
}
