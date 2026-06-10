import React, { useState, useEffect } from 'react'

interface ClaudeMdEditorProps {
  isOpen: boolean
  onClose: () => void
  projectPath: string
  projectName: string
  aiBackend?: 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok'
}

const BACKEND_FILE_LABELS: Record<string, string> = {
  claude: 'CLAUDE.md',
  gemini: 'GEMINI.md',
  codex: 'AGENTS.md',
  opencode: 'OPENCODE.md',
  aider: 'CONVENTIONS.md',
  droid: 'AGENTS.md',
  hermes: 'HERMES.md',
  grok: 'AGENTS.md',
}

export function ClaudeMdEditor({ isOpen, onClose, projectPath, projectName, aiBackend = 'claude' }: ClaudeMdEditorProps) {
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [fileExists, setFileExists] = useState(false)
  const [relativePath, setRelativePath] = useState('')
  const fileLabel = BACKEND_FILE_LABELS[aiBackend] || 'CLAUDE.md'

  useEffect(() => {
    if (isOpen) {
      loadContent()
    }
  }, [isOpen, projectPath, aiBackend])

  const loadContent = async () => {
    setIsLoading(true)
    setError('')
    try {
      const result = await window.electronAPI?.claudeMdRead(projectPath, aiBackend)
      if (result.success) {
        setContent(result.content || '')
        setOriginalContent(result.content || '')
        setFileExists(result.exists || false)
        setRelativePath(result.relativePath || '')
      } else {
        setError(result.error || `Failed to load ${fileLabel}`)
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
      const result = await window.electronAPI?.claudeMdSave(projectPath, content, aiBackend)
      if (result.success) {
        setOriginalContent(content)
        setFileExists(true)
        onClose()
      } else {
        setError(result.error || `Failed to save ${fileLabel}`)
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
          <h2>Edit {fileLabel}</h2>
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
                  placeholder={`Add project-specific instructions for ${aiBackend === 'claude' ? 'Claude' : aiBackend}...

Examples:
- Coding style preferences
- Project conventions
- File structure notes
- Testing requirements`}
                  rows={20}
                  autoFocus
                  className="claudemd-textarea"
                />
                <div className="form-hint">
                  This file will be saved to: {relativePath || fileLabel}
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
