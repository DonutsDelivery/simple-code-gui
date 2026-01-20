import React, { useState, useEffect } from 'react'

interface ClaudeMdEditorProps {
  isOpen: boolean
  onClose: () => void
  projectPath: string
  projectName: string
}

export function ClaudeMdEditor({ isOpen, onClose, projectPath, projectName }: ClaudeMdEditorProps) {
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [fileExists, setFileExists] = useState(false)

  useEffect(() => {
    if (isOpen) {
      loadContent()
    }
  }, [isOpen, projectPath])

  const loadContent = async () => {
    setIsLoading(true)
    setError('')
    try {
      const result = await window.electronAPI?.claudeMdRead(projectPath)
      if (result.success) {
        setContent(result.content || '')
        setOriginalContent(result.content || '')
        setFileExists(result.exists || false)
      } else {
        setError(result.error || 'Failed to load CLAUDE.md')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError('')
    try {
      const result = await window.electronAPI?.claudeMdSave(projectPath, content)
      if (result.success) {
        setOriginalContent(content)
        setFileExists(true)
        onClose()
      } else {
        setError(result.error || 'Failed to save CLAUDE.md')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setIsSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
    // Cmd/Ctrl+S to save
    if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (!isSaving && !isLoading) {
        handleSave()
      }
    }
  }

  const hasChanges = content !== originalContent

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal claudemd-editor-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <h2>Edit CLAUDE.md</h2>
          <span className="modal-subtitle">{projectName}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-content">
          {isLoading ? (
            <div className="loading-state">Loading...</div>
          ) : (
            <>
              <div className="form-group claudemd-editor-group">
                <div className="claudemd-editor-header">
                  <label>Project Instructions</label>
                  {!fileExists && (
                    <span className="new-file-badge">New file</span>
                  )}
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Add project-specific instructions for Claude...

Examples:
- Coding style preferences
- Project conventions
- File structure notes
- Testing requirements"
                  rows={20}
                  autoFocus
                  className="claudemd-textarea"
                />
                <div className="form-hint">
                  This file will be saved to: .claude/CLAUDE.md
                </div>
              </div>
              {error && <div className="form-error">{error}</div>}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={isSaving || isLoading || !hasChanges}
          >
            {isSaving ? 'Saving...' : hasChanges ? 'Save' : 'No changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
