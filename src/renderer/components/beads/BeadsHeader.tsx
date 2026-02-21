import React from 'react'

interface BeadsHeaderProps {
  projectPath: string | null
  projectName: string | null
  isExpanded: boolean
  isReady: boolean
  taskCount: number
  onToggle: () => void
  onOpenBrowser: (e: React.MouseEvent) => void
}

export function BeadsHeader({
  projectPath,
  projectName,
  isExpanded,
  isReady,
  taskCount,
  onToggle,
  onOpenBrowser
}: BeadsHeaderProps): React.ReactElement {
  return (
    <div className="beads-header">
      <button
        className="beads-toggle"
        onClick={onToggle}
        title={isExpanded ? 'Collapse list' : 'Expand list'}
        aria-expanded={isExpanded}
        aria-label="Toggle beads panel"
      >
        {isExpanded ? '▼' : '▶'}
      </button>
      <span className="beads-icon">📿</span>
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
        Beads{projectName ? `: ${projectName}` : ''}
      </span>
      {taskCount > 0 && <span className="beads-count">{taskCount}</span>}
    </div>
  )
}
