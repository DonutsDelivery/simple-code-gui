import React, { useState, useEffect } from 'react'

interface CustomCommandModalProps {
  isOpen: boolean
  onClose: () => void
  projectPath: string | null
}

type CommandScope = 'project' | 'global'

export function CustomCommandModal({ isOpen, onClose, projectPath }: CustomCommandModalProps) {
  const [commandName, setCommandName] = useState('')
  const [commandContent, setCommandContent] = useState('')
  const [scope, setScope] = useState<CommandScope>('project')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setCommandName('')
      setCommandContent('')
      setScope(projectPath ? 'project' : 'global')
      setError('')
    }
  }, [isOpen, projectPath])

  const handleSave = async () => {
    const trimmedName = commandName.trim()

    if (!trimmedName) {
      setError('Please enter a command name')
      return
    }

    // Validate command name (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
      setError('Command name can only contain letters, numbers, hyphens, and underscores')
      return
    }

    if (!commandContent.trim()) {
      setError('Please enter command content')
      return
    }

    if (scope === 'project' && !projectPath) {
      setError('No project selected for project-level command')
      return
    }

    setIsSaving(true)
    setError('')

    try {
      const result = await window.electronAPI?.commandsSave(
        trimmedName,
        commandContent,
        scope === 'project' ? projectPath! : null
      )

      if (result.success) {
        onClose()
      } else {
        setError(result.error || 'Failed to save command')
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
    // Cmd/Ctrl+Enter to save
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isSaving) {
      handleSave()
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal custom-command-modal" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="modal-header">
          <h2>Add Custom Command</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-content">
          <div className="form-group">
            <label>Command Name</label>
            <div className="command-name-input">
              <span className="command-prefix">/</span>
              <input
                type="text"
                value={commandName}
                onChange={(e) => setCommandName(e.target.value)}
                placeholder="my-command"
                autoFocus
              />
            </div>
            <div className="form-hint">
              Will create: {commandName.trim() || 'my-command'}.md
            </div>
          </div>

          <div className="form-group">
            <label>Scope</label>
            <div className="scope-options">
              <label className={`scope-option ${scope === 'project' ? 'selected' : ''} ${!projectPath ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  name="scope"
                  value="project"
                  checked={scope === 'project'}
                  onChange={() => setScope('project')}
                  disabled={!projectPath}
                />
                <span className="scope-label">Project</span>
                <span className="scope-path">.claude/commands/</span>
              </label>
              <label className={`scope-option ${scope === 'global' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="scope"
                  value="global"
                  checked={scope === 'global'}
                  onChange={() => setScope('global')}
                />
                <span className="scope-label">Global</span>
                <span className="scope-path">~/.claude/commands/</span>
              </label>
            </div>
          </div>

          <div className="form-group">
            <label>Command Content (Markdown)</label>
            <textarea
              value={commandContent}
              onChange={(e) => setCommandContent(e.target.value)}
              placeholder="Enter the prompt template for your custom command..."
              rows={10}
            />
            <div className="form-hint">
              Use $ARGUMENTS to include arguments passed to the command.
              Example: "Review the following code: $ARGUMENTS"
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Create Command'}
          </button>
        </div>
      </div>
    </div>
  )
}
