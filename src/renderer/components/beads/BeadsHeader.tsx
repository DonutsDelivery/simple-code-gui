import React from 'react'

import type { BackendKind } from './adapters/types.js'

const BACKEND_LABELS: Record<BackendKind, string> = {
  beads: 'Beads',
  kspec: 'Kspec',
  none: 'Tasks'
}

const BACKEND_ICONS: Record<BackendKind, string> = {
  beads: '\u{1F4BF}',
  kspec: '\u{1F4CB}',
  none: '\u{1F4CB}'
}

interface BeadsHeaderProps {
  projectPath: string | null
  projectName: string | null
  isExpanded: boolean
  isReady: boolean
  taskCount: number
  backendKind: BackendKind
  onToggle: () => void
  onOpenBrowser: (e: React.MouseEvent) => void
}

export function BeadsHeader({
  projectPath,
  projectName,
  isExpanded,
  isReady,
  taskCount,
  backendKind,
  onToggle,
  onOpenBrowser
}: BeadsHeaderProps): React.ReactElement {
  const label = BACKEND_LABELS[backendKind]
  const icon = BACKEND_ICONS[backendKind]

  return (
    <div className="beads-header">
      <button
        className="beads-toggle"
        onClick={onToggle}
        title={isExpanded ? 'Collapse list' : 'Expand list'}
        aria-expanded={isExpanded}
        aria-label="Toggle task panel"
      >
        {isExpanded ? '▼' : '▶'}
      </button>
      <span className="beads-icon">{icon}</span>
      <span
        className={`beads-title ${projectPath && isReady ? 'clickable' : ''}`}
        role={projectPath && isReady ? 'button' : undefined}
        tabIndex={projectPath && isReady ? 0 : undefined}
        onClick={onOpenBrowser}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && projectPath && isReady) {
            e.preventDefault()
            onOpenBrowser(e as unknown as React.MouseEvent)
          }
        }}
        title={projectPath && isReady ? 'Open task browser' : ''}
      >
        {label}{projectName ? `: ${projectName}` : ''}
      </span>
      {taskCount > 0 && <span className="beads-count">{taskCount}</span>}
    </div>
  )
}
