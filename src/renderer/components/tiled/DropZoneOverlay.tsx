import React from 'react'
import type { DropZone, DropZoneType } from '../tiled-layout-utils.js'

const DROP_ZONE_LABELS: Record<DropZoneType, string> = {
  'swap': 'Swap',
  'split-top': 'Add Above',
  'split-bottom': 'Add Below',
  'split-left': 'Add Left',
  'split-right': 'Add Right'
}

interface DropZoneOverlayProps {
  currentDropZone: DropZone
  draggedSidebarProject: string | null
  swapLabel?: string
  GAP: number
  viewportSize: { width: number; height: number }
}

export function DropZoneOverlay({
  currentDropZone,
  draggedSidebarProject,
  swapLabel,
  GAP,
  viewportSize
}: DropZoneOverlayProps): React.ReactElement {
  let label: string
  if (currentDropZone.type === 'swap' && swapLabel) {
    label = swapLabel
  } else if (draggedSidebarProject) {
    label = currentDropZone.type === 'swap' ? 'Add as Tab' : `Open ${DROP_ZONE_LABELS[currentDropZone.type].replace('Add ', '')}`
  } else {
    label = DROP_ZONE_LABELS[currentDropZone.type]
  }

  let background: string
  if (draggedSidebarProject) {
    background = 'rgba(34, 197, 94, 0.35)'
  } else if (currentDropZone.type === 'swap') {
    background = 'rgba(var(--accent-rgb), 0.3)'
  } else {
    background = 'rgba(59, 130, 246, 0.35)'
  }

  return (
    <div
      className="drop-zone-overlay"
      style={{
        position: 'absolute',
        left: `${currentDropZone.bounds.x / 100 * viewportSize.width + GAP}px`,
        top: `${currentDropZone.bounds.y / 100 * viewportSize.height + GAP}px`,
        width: `${currentDropZone.bounds.width / 100 * viewportSize.width - GAP}px`,
        height: `${currentDropZone.bounds.height / 100 * viewportSize.height - GAP}px`,
        background,
        border: '2px dashed var(--accent)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none', zIndex: 1000, transition: 'all 100ms ease'
      }}
    >
      <span className="drop-zone-label" style={{
        fontSize: '13px', fontWeight: 600, color: 'white',
        textShadow: '0 1px 3px rgba(0,0,0,0.6)', background: 'rgba(0,0,0,0.5)',
        padding: '4px 10px', borderRadius: '4px'
      }}>
        {label}
      </span>
    </div>
  )
}
