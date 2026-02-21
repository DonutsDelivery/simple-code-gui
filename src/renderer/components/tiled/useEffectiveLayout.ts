import { useMemo, useEffect, useRef, MutableRefObject } from 'react'
import type { TileLayout } from '../tiled-layout-utils.js'
import {
  generateDefaultLayout,
  validateLayout,
  addTileToLayout,
  addTabToExistingTile,
  findTileForProject,
  removeTabFromTile,
  getAllTabIdsFromLayout,
  migrateTile
} from '../tiled-layout-utils.js'
import type { OpenTab } from './types.js'

export function useEffectiveLayout(
  layout: TileLayout[],
  tabs: OpenTab[],
  containerSizeRef: MutableRefObject<{ width: number; height: number }>,
  onLayoutChange: (layout: TileLayout[]) => void
): {
  effectiveLayout: TileLayout[]
  effectiveLayoutRef: MutableRefObject<TileLayout[]>
  activeTabIdRef: MutableRefObject<string | null>
} {
  const effectiveLayoutRef = useRef<TileLayout[]>([])
  const activeTabIdRef = useRef<string | null>(tabs.length > 0 ? tabs[tabs.length - 1].id : null)

  const effectiveLayout = useMemo(() => {
    const { width, height } = containerSizeRef.current

    if (layout.length === 0) {
      return generateDefaultLayout(tabs, width, height)
    }

    // Ensure all tiles are migrated to the new format
    const migratedLayout = layout.map(migrateTile)

    const layoutTabIds = getAllTabIdsFromLayout(migratedLayout)
    const tabIds = new Set(tabs.map(t => t.id))
    const addedTabs = tabs.filter(t => !layoutTabIds.has(t.id))
    const removedTabIds = [...layoutTabIds].filter(id => !tabIds.has(id))

    if (addedTabs.length === 0 && removedTabIds.length === 0) {
      return validateLayout(migratedLayout, tabs, width, height)
    }

    let newLayout = [...migratedLayout]

    // Remove tabs that no longer exist
    for (const removedId of removedTabIds) {
      newLayout = removeTabFromTile(newLayout, removedId, tabs, width, height)
    }

    // Add new tabs - group by project into existing tiles when possible
    for (const addedTab of addedTabs) {
      const existingTile = findTileForProject(newLayout, tabs, addedTab.projectPath)
      if (existingTile) {
        newLayout = addTabToExistingTile(newLayout, existingTile.id, addedTab.id)
      } else {
        const existingIds = newLayout.map(l => l.id)
        const activeId = existingIds.length > 0 ? existingIds[existingIds.length - 1] : null
        newLayout = addTileToLayout(newLayout, addedTab.id, activeId, width, height)
      }
    }

    if (tabs.length > 0) {
      activeTabIdRef.current = tabs[tabs.length - 1].id
    }

    return validateLayout(newLayout, tabs, width, height)
  }, [layout, tabs, containerSizeRef])

  effectiveLayoutRef.current = effectiveLayout

  useEffect(() => {
    const layoutTabIds = getAllTabIdsFromLayout(layout.map(migrateTile))
    const effectiveTabIds = getAllTabIdsFromLayout(effectiveLayout)
    const idsMatch = layoutTabIds.size === effectiveTabIds.size &&
      [...layoutTabIds].every(id => effectiveTabIds.has(id))

    if (!idsMatch) {
      onLayoutChange(effectiveLayout)
    }
  }, [effectiveLayout, layout, onLayoutChange])

  return { effectiveLayout, effectiveLayoutRef, activeTabIdRef }
}
