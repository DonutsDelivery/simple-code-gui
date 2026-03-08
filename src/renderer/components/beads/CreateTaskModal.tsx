import React from 'react'
import ReactDOM from 'react-dom'
import type { BackendKind, AutomationEligibility } from './adapters/types.js'

const BEADS_TYPES = [
  { value: 'task', label: 'Task' },
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature' },
  { value: 'epic', label: 'Epic' },
  { value: 'chore', label: 'Chore' },
] as const

const KSPEC_TYPES = [
  { value: 'task', label: 'Task' },
  { value: 'bug', label: 'Bug' },
  { value: 'epic', label: 'Epic' },
  { value: 'spike', label: 'Spike' },
  { value: 'infra', label: 'Infra' },
] as const

const BEADS_PRIORITIES = [
  { value: 0, label: 'P0 - Critical' },
  { value: 1, label: 'P1 - High' },
  { value: 2, label: 'P2 - Medium' },
  { value: 3, label: 'P3 - Low' },
  { value: 4, label: 'P4 - Lowest' },
] as const

const KSPEC_PRIORITIES = [
  { value: 1, label: 'P1 - Highest' },
  { value: 2, label: 'P2 - High' },
  { value: 3, label: 'P3 - Medium' },
  { value: 4, label: 'P4 - Low' },
  { value: 5, label: 'P5 - Lowest' },
] as const

const AUTOMATION_OPTIONS = [
  { value: '', label: 'Unassessed' },
  { value: 'eligible', label: 'Eligible' },
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'manual_only', label: 'Manual Only' },
] as const

interface CreateTaskModalProps {
  show: boolean
  onClose: () => void
  onCreate: () => void
  backendKind: BackendKind
  title: string
  setTitle: (title: string) => void
  type: string
  setType: (type: string) => void
  priority: number
  setPriority: (priority: number) => void
  description: string
  setDescription: (description: string) => void
  labels: string
  setLabels: (labels: string) => void
  automation?: AutomationEligibility | ''
  setAutomation?: (automation: AutomationEligibility | '') => void
}

export function CreateTaskModal({
  show, onClose, onCreate, backendKind,
  title, setTitle,
  type, setType,
  priority, setPriority,
  description, setDescription,
  labels, setLabels,
  automation, setAutomation
}: CreateTaskModalProps) {
  if (!show) return null

  const isKspec = backendKind === 'kspec'
  const types = isKspec ? KSPEC_TYPES : BEADS_TYPES
  const priorities = isKspec ? KSPEC_PRIORITIES : BEADS_PRIORITIES

  return ReactDOM.createPortal(
    <div className="beads-modal-overlay" onClick={onClose}>
      <div className="beads-modal" onClick={(e) => e.stopPropagation()}>
        <div className="beads-modal-header">
          <h3>Create Task</h3>
          <button className="beads-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="beads-modal-body">
          <div className="beads-form-group">
            <label htmlFor="task-title">Title *</label>
            <input
              id="task-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && title.trim()) {
                  e.preventDefault()
                  onCreate()
                }
                if (e.key === 'Escape') onClose()
              }}
            />
          </div>
          <div className="beads-form-row">
            <div className="beads-form-group">
              <label htmlFor="task-type">Type</label>
              <select id="task-type" value={type} onChange={(e) => setType(e.target.value)}>
                {types.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="beads-form-group">
              <label htmlFor="task-priority">Priority</label>
              <select id="task-priority" value={priority} onChange={(e) => setPriority(parseInt(e.target.value))}>
                {priorities.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          {isKspec && setAutomation && (
            <div className="beads-form-group">
              <label htmlFor="task-automation">Automation</label>
              <select
                id="task-automation"
                value={automation ?? ''}
                onChange={(e) => setAutomation(e.target.value as AutomationEligibility | '')}
              >
                {AUTOMATION_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="beads-form-group">
            <label htmlFor="task-description">Description</label>
            <textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={3}
            />
          </div>
          <div className="beads-form-group">
            <label htmlFor="task-labels">Labels</label>
            <input
              id="task-labels"
              type="text"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder="Comma-separated labels..."
            />
          </div>
        </div>
        <div className="beads-modal-footer">
          <button className="beads-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="beads-btn-create" onClick={onCreate} disabled={!title.trim()}>Create</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
