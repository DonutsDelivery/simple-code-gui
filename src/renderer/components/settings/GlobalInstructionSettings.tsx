import React, { useState } from 'react'

interface GlobalInstructionSettingsProps {
  savedContent: string
  onSaved: (content: string) => void
  isApplying: boolean
  setIsApplying: (v: boolean) => void
  applyResult: { applied: number; failed: number } | null
  setApplyResult: (r: { applied: number; failed: number } | null) => void
  removeResult: { removed: number; failed: number } | null
  setRemoveResult: (r: { removed: number; failed: number } | null) => void
}

const BACKEND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'claude', label: 'Claude (.claude/CLAUDE.md)' },
  { value: 'gemini', label: 'Gemini (GEMINI.md)' },
  { value: 'codex', label: 'Codex (AGENTS.md)' },
  { value: 'opencode', label: 'OpenCode (OPENCODE.md)' },
  { value: 'aider', label: 'Aider (CONVENTIONS.md)' },
  { value: 'droid', label: 'Factory Droid (AGENTS.md)' },
  { value: 'hermes', label: 'Hermes (HERMES.md)' },
  { value: 'grok', label: 'Grok Build (AGENTS.md)' },
]

export function GlobalInstructionSettings({
  savedContent,
  onSaved,
  isApplying,
  setIsApplying,
  applyResult,
  setApplyResult,
  removeResult,
  setRemoveResult
}: GlobalInstructionSettingsProps): React.ReactElement {
  const [content, setContent] = useState(savedContent)
  const [selectedBackends, setSelectedBackends] = useState<string[]>(['claude'])

  function toggleBackend(value: string): void {
    setSelectedBackends(prev =>
      prev.includes(value)
        ? prev.filter(b => b !== value)
        : [...prev, value]
    )
  }

  function selectAllBackends(): void {
    if (selectedBackends.length === BACKEND_OPTIONS.length) {
      setSelectedBackends([])
    } else {
      setSelectedBackends(BACKEND_OPTIONS.map(b => b.value))
    }
  }

  async function handleApply(): Promise<void> {
    if (!content.trim()) return

    // Save to settings first
    onSaved(content)

    setIsApplying(true)
    setApplyResult(null)

    try {
      const workspace = await window.electronAPI?.getWorkspace()
      const projects = workspace?.projects || []

      if (projects.length === 0) {
        setApplyResult({ applied: 0, failed: 0 })
        setIsApplying(false)
        return
      }

      const result = await window.electronAPI?.globalInstructionInjectAll(
        projects,
        content,
        selectedBackends
      )

      if (result) {
        setApplyResult({ applied: result.applied, failed: result.failed })
      }
    } catch (e) {
      console.error('Failed to apply global instructions:', e)
      setApplyResult({ applied: 0, failed: 1 })
    }

    setIsApplying(false)
  }

  async function handleRemove(): Promise<void> {
    setIsApplying(true)
    setRemoveResult(null)

    try {
      const workspace = await window.electronAPI?.getWorkspace()
      const projects = workspace?.projects || []

      if (projects.length === 0) {
        setRemoveResult({ removed: 0, failed: 0 })
        setIsApplying(false)
        return
      }

      const result = await window.electronAPI?.globalInstructionRemoveAll(
        projects,
        selectedBackends
      )

      if (result) {
        setRemoveResult({ removed: result.removed, failed: result.failed })
      }
    } catch (e) {
      console.error('Failed to remove global instructions:', e)
      setRemoveResult({ removed: 0, failed: 1 })
    }

    setIsApplying(false)
  }

  const allSelected = selectedBackends.length === BACKEND_OPTIONS.length

  return (
    <div className="form-group">
      <label>Global Instruction Injection</label>
      <p className="form-hint">
        Inject custom instructions into all projects&apos; instruction files
        (CLAUDE.md, AGENTS.md, GEMINI.md, etc.). This content will be appended
        with markers so it can be cleanly removed later.
      </p>

      <div style={{ marginTop: '10px' }}>
        <label style={{ fontSize: '0.85em', fontWeight: 500, color: 'var(--text-muted)' }}>
          Target backends:
        </label>
        <button
          className="btn-text"
          onClick={selectAllBackends}
          style={{ marginLeft: '8px', fontSize: '0.8em', padding: '2px 8px' }}
        >
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
          {BACKEND_OPTIONS.map(opt => (
            <label
              key={opt.value}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.82em',
                cursor: 'pointer',
                padding: '2px 8px',
                borderRadius: '4px',
                background: selectedBackends.includes(opt.value) ? 'var(--accent)' : 'var(--surface)',
                color: selectedBackends.includes(opt.value) ? '#fff' : 'var(--text)',
                userSelect: 'none'
              }}
            >
              <input
                type="checkbox"
                checked={selectedBackends.includes(opt.value)}
                onChange={() => toggleBackend(opt.value)}
                style={{ display: 'none' }}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value)
          setApplyResult(null)
          setRemoveResult(null)
        }}
        placeholder="Enter your global instructions here (e.g., coding conventions, project rules, etc.)&#10;&#10;This content will be injected into instruction files as:&#10;&lt;!-- GLOBAL_INSTRUCTION_START --&gt;&#10;Your content here...&#10;&lt;!-- GLOBAL_INSTRUCTION_END --&gt;"
        rows={8}
        style={{
          width: '100%',
          marginTop: '8px',
          padding: '8px',
          borderRadius: '4px',
          border: '1px solid var(--border)',
          background: 'var(--input-bg)',
          color: 'var(--text)',
          fontFamily: 'monospace',
          fontSize: '0.85em',
          resize: 'vertical'
        }}
      />

      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button
          className="btn-primary"
          onClick={handleApply}
          disabled={isApplying || !content.trim()}
        >
          {isApplying ? 'Applying...' : 'Apply to All Projects'}
        </button>
        <button
          className="btn-danger"
          onClick={handleRemove}
          disabled={isApplying}
        >
          Remove from All Projects
        </button>
      </div>

      {applyResult && (
        <p className="form-hint" style={{ marginTop: '8px', color: applyResult.failed > 0 ? 'var(--warning)' : 'var(--success)' }}>
          Applied to {applyResult.applied} file{applyResult.applied !== 1 ? 's' : ''}.
          {applyResult.failed > 0 && ` Failed: ${applyResult.failed}.`}
        </p>
      )}

      {removeResult && (
        <p className="form-hint" style={{ marginTop: '8px', color: removeResult.failed > 0 ? 'var(--warning)' : 'var(--success)' }}>
          Removed from {removeResult.removed} file{removeResult.removed !== 1 ? 's' : ''}.
          {removeResult.failed > 0 && ` Failed: ${removeResult.failed}.`}
        </p>
      )}
    </div>
  )
}
