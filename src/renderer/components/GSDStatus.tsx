import React, { useState, useEffect, useCallback, useRef } from 'react'

interface GSDProgress {
  initialized: boolean
  currentPhase: string | null
  currentPhaseNumber: number | null
  totalPhases: number
  completedPhases: number
  phases: Array<{
    number: number
    title: string
    completed: boolean
  }>
}

interface GSDStatusProps {
  projectPath: string | null
  onCommand: (command: string) => void
}

const gsdStatusCache = new Map<string, GSDProgress>()

export function GSDStatus({ projectPath, onCommand }: GSDStatusProps) {
  const [gsdInstalled, setGsdInstalled] = useState(false)
  const [progress, setProgress] = useState<GSDProgress | null>(null)
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(() => {
    const stored = localStorage.getItem('gsd-status-expanded')
    return stored === null ? true : stored === 'true'
  })
  const currentProjectRef = useRef<string | null>(null)

  // Persist expanded state
  useEffect(() => {
    localStorage.setItem('gsd-status-expanded', String(isExpanded))
  }, [isExpanded])

  const loadStatus = useCallback(async (showLoading = true) => {
    if (!projectPath) return

    const loadingForProject = projectPath

    if (showLoading) setLoading(true)

    try {
      // Check if GSD is installed globally
      const gsdCheck = await window.electronAPI.gsdCheck()

      if (currentProjectRef.current !== loadingForProject) return

      setGsdInstalled(gsdCheck.installed)

      if (!gsdCheck.installed) {
        setProgress(null)
        return
      }

      // Get project progress
      const result = await window.electronAPI.gsdGetProgress(loadingForProject)

      if (currentProjectRef.current !== loadingForProject) return

      if (result.success && result.data) {
        setProgress(result.data)
        gsdStatusCache.set(loadingForProject, result.data)
      } else {
        setProgress(null)
      }
    } catch {
      if (currentProjectRef.current === loadingForProject) {
        setProgress(null)
      }
    } finally {
      if (currentProjectRef.current === loadingForProject) {
        setLoading(false)
      }
    }
  }, [projectPath])

  useEffect(() => {
    currentProjectRef.current = projectPath

    setProgress(null)
    setGsdInstalled(false)

    if (projectPath) {
      // Load from cache for instant display
      const cachedProgress = gsdStatusCache.get(projectPath)
      if (cachedProgress) {
        setProgress(cachedProgress)
        setGsdInstalled(true)
      }

      // Fetch fresh data
      loadStatus(false)
    }
  }, [projectPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (projectPath) {
      const interval = setInterval(() => loadStatus(false), 10000)
      return () => clearInterval(interval)
    }
  }, [projectPath, loadStatus])

  const handleInstallGSD = async () => {
    setInstalling(true)
    setInstallError(null)

    try {
      const result = await window.electronAPI.gsdInstall()
      if (result.success) {
        setGsdInstalled(true)
        loadStatus(false)
      } else {
        setInstallError(result.error || 'Installation failed')
      }
    } catch (e) {
      setInstallError(String(e))
    } finally {
      setInstalling(false)
    }
  }

  const projectName = projectPath ? projectPath.split(/[/\\]/).pop() : null

  const getProgressPercent = () => {
    if (!progress || progress.totalPhases === 0) return 0
    return Math.round((progress.completedPhases / progress.totalPhases) * 100)
  }

  const getQuickAction = () => {
    if (!gsdInstalled) {
      return { label: 'Install', command: 'gsd:help' }
    }
    if (!progress?.initialized) {
      return { label: 'Initialize', command: 'gsd:new-project' }
    }
    if (progress.completedPhases === progress.totalPhases && progress.totalPhases > 0) {
      return { label: 'Plan Next', command: 'gsd:plan-phase' }
    }
    return { label: 'Execute', command: 'gsd:execute-phase' }
  }

  const quickAction = getQuickAction()

  return (
    <div className="gsd-status">
      <div className="gsd-status-header" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="gsd-toggle">{isExpanded ? '▼' : '▶'}</span>
        <span className="gsd-icon">🚀</span>
        <span className="gsd-title">GSD{projectName ? `: ${projectName}` : ''}</span>
        {progress?.initialized && progress.totalPhases > 0 && (
          <span className="gsd-progress-badge">{progress.completedPhases}/{progress.totalPhases}</span>
        )}
      </div>

      {isExpanded && (
        <div className="gsd-status-content">
          {!projectPath && (
            <div className="gsd-empty">Select a project to view GSD status</div>
          )}

          {projectPath && loading && !progress && (
            <div className="gsd-loading">Loading...</div>
          )}

          {projectPath && !loading && !gsdInstalled && (
            <div className="gsd-empty">
              <p>GSD not installed</p>
              {installError && <p className="gsd-install-error">{installError}</p>}
              <div className="gsd-install-buttons">
                <button
                  className="gsd-action-btn"
                  onClick={handleInstallGSD}
                  disabled={installing}
                >
                  {installing ? 'Installing...' : 'Install GSD'}
                </button>
                <button
                  className="gsd-action-btn secondary"
                  onClick={() => onCommand('/gsd:help')}
                  title="Learn More"
                >
                  ?
                </button>
              </div>
            </div>
          )}

          {projectPath && gsdInstalled && !progress?.initialized && !loading && (
            <div className="gsd-empty">
              <p>Not initialized</p>
              <button
                className="gsd-action-btn"
                onClick={() => onCommand('/gsd:new-project')}
              >
                Initialize
              </button>
            </div>
          )}

          {projectPath && gsdInstalled && progress?.initialized && (
            <>
              {progress.totalPhases > 0 && (
                <div className="gsd-progress-section">
                  <div className="gsd-progress-bar">
                    <div
                      className="gsd-progress-fill"
                      style={{ width: `${getProgressPercent()}%` }}
                    />
                  </div>
                  <div className="gsd-progress-text">
                    {getProgressPercent()}% ({progress.completedPhases}/{progress.totalPhases} phases)
                  </div>
                </div>
              )}

              {progress.currentPhase && (
                <div className="gsd-current-phase">
                  <span className="gsd-phase-label">Current:</span>
                  <span className="gsd-phase-name">
                    Phase {progress.currentPhaseNumber}: {progress.currentPhase}
                  </span>
                </div>
              )}

              {progress.totalPhases === 0 && (
                <div className="gsd-empty">
                  <p>No roadmap yet</p>
                </div>
              )}

              <div className="gsd-actions-row">
                <button
                  className="gsd-action-btn primary"
                  onClick={() => onCommand(`/${quickAction.command}`)}
                >
                  {quickAction.label}
                </button>
                <button
                  className="gsd-action-btn secondary"
                  onClick={() => onCommand('/gsd:progress')}
                  title="Check Progress"
                >
                  📊
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
