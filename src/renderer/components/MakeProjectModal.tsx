import React, { useState, useEffect } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'

const ICON_OPTIONS = [
  { emoji: '📁', label: 'Folder' },
  { emoji: '🚀', label: 'Rocket' },
  { emoji: '💻', label: 'Computer' },
  { emoji: '🎮', label: 'Game' },
  { emoji: '🎨', label: 'Art' },
  { emoji: '🔧', label: 'Tools' },
  { emoji: '📊', label: 'Data' },
  { emoji: '🌐', label: 'Web' },
  { emoji: '📱', label: 'Mobile' },
  { emoji: '🤖', label: 'Bot' },
  { emoji: '⚡', label: 'Fast' },
  { emoji: '🔒', label: 'Security' },
  { emoji: '🎵', label: 'Music' },
  { emoji: '📝', label: 'Notes' },
  { emoji: '🧪', label: 'Lab' },
  { emoji: '🏠', label: 'Home' },
]

interface MakeProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onProjectCreated: (projectPath: string, projectName: string) => void
}

export function MakeProjectModal({ isOpen, onClose, onProjectCreated }: MakeProjectModalProps) {
  const [projectName, setProjectName] = useState('')
  const [selectedIcon, setSelectedIcon] = useState('📁')
  const [defaultDir, setDefaultDir] = useState('')
  const [error, setError] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(isOpen)

  useEffect(() => {
    if (isOpen) {
      setProjectName('')
      setSelectedIcon('📁')
      setError('')
      window.electronAPI?.getSettings?.()?.then((settings) => {
        setDefaultDir(settings.defaultProjectDir || '')
      })
    }
  }, [isOpen])

  const handleCreate = async () => {
    if (!projectName.trim()) {
      setError('Please enter a project name')
      return
    }

    if (!defaultDir) {
      setError('Please set a default project directory in Settings first')
      return
    }

    setIsCreating(true)
    setError('')

    try {
      const result = await window.electronAPI?.createProject(projectName.trim(), defaultDir)
      if (result.success && result.path) {
        onProjectCreated(result.path, projectName.trim())
        onClose()
      } else {
        setError(result.error || 'Failed to create project')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isCreating) {
      handleCreate()
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" ref={focusTrapRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create New Project</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-content">
          <div className="form-group">
            <label>Project Name</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="my-awesome-project"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Icon</label>
            <div className="icon-grid">
              {ICON_OPTIONS.map((icon) => (
                <button
                  key={icon.emoji}
                  className={`icon-option ${selectedIcon === icon.emoji ? 'selected' : ''}`}
                  onClick={() => setSelectedIcon(icon.emoji)}
                  title={icon.label}
                >
                  {icon.emoji}
                </button>
              ))}
            </div>
          </div>

          {defaultDir && (
            <div className="form-group">
              <label>Location</label>
              <div className="location-preview">
                {defaultDir}/{projectName || 'project-name'}
              </div>
            </div>
          )}

          {!defaultDir && (
            <div className="form-warning">
              No default directory set. Please configure it in Settings first.
            </div>
          )}

          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={isCreating || !defaultDir}
          >
            {isCreating ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  )
}
