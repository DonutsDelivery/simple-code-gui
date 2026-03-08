import React, { useState, useEffect, useCallback } from 'react'
import type { UnifiedTask } from './adapters/types.js'
import { CreateTaskModal } from './CreateTaskModal.js'
import { TaskDetailModal } from './TaskDetailModal.js'
import { BrowserModal } from './BrowserModal.js'
import { StartDropdown } from './StartDropdown.js'
import { BeadsHeader } from './BeadsHeader.js'
import { BeadsInstallView } from './BeadsInstallView.js'
import { BeadsTaskList } from './BeadsTaskList.js'
import { BeadsActionsRow } from './BeadsActionsRow.js'
import { useBeadsState } from './useBeadsState.js'
import { useBeadsTasks } from './useBeadsTasks.js'
import { useBeadsDetail } from './useBeadsDetail.js'
import { useBeadsResize } from './useBeadsResize.js'

const BACKEND_LABELS = {
  beads: 'Beads',
  kspec: 'Kspec',
  none: 'Tasks'
} as const

interface BeadsPanelProps {
  projectPath: string | null
  isExpanded: boolean
  onToggle: () => void
  onStartTaskInNewTab?: (prompt: string) => void
  onSendToCurrentTab?: (prompt: string) => void
  currentTabPtyId?: string | null
}

export function BeadsPanel({
  projectPath,
  isExpanded,
  onToggle,
  onStartTaskInNewTab,
  onSendToCurrentTab,
  currentTabPtyId
}: BeadsPanelProps): React.ReactElement {
  // State management (includes backend detection)
  const {
    beadsState,
    setBeadsState,
    tasks,
    setTasks,
    currentProjectRef,
    suppressWatcherReloadRef,
    setError,
    backendKind,
    adapter
  } = useBeadsState(projectPath)

  // Task CRUD operations (routed through adapter)
  const taskOps = useBeadsTasks({
    projectPath,
    beadsState,
    setBeadsState,
    tasks,
    setTasks,
    currentProjectRef,
    suppressWatcherReloadRef,
    setError,
    adapter,
    backendKind
  })

  // Detail modal (routed through adapter)
  const detailOps = useBeadsDetail({
    projectPath,
    loadTasks: taskOps.loadTasks,
    setError,
    adapter
  })

  // Panel resize
  const { panelHeight, isResizing, handleResizeStart } = useBeadsResize()

  // Agent dispatch state (kspec only)
  const [dispatchRunning, setDispatchRunning] = useState(false)
  const [dispatchToggling, setDispatchToggling] = useState(false)

  // Check dispatch status on mount and when backend changes
  useEffect(() => {
    if (backendKind !== 'kspec' || !projectPath) return
    window.electronAPI?.kspecDispatchStatus?.(projectPath).then(result => {
      setDispatchRunning(!!result?.running)
    }).catch(() => {})
  }, [backendKind, projectPath])

  const handleToggleDispatch = useCallback(async () => {
    if (!projectPath || dispatchToggling) return
    setDispatchToggling(true)
    try {
      if (dispatchRunning) {
        const result = await window.electronAPI?.kspecDispatchStop?.(projectPath)
        if (result?.success) setDispatchRunning(false)
      } else {
        const result = await window.electronAPI?.kspecDispatchStart?.(projectPath)
        if (result?.success) setDispatchRunning(true)
        else setError(result?.error || 'Failed to start dispatch')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setDispatchToggling(false)
    }
  }, [projectPath, dispatchRunning, dispatchToggling, setError])

  // Browser modal state
  const [showBrowser, setShowBrowser] = useState(false)
  const [browserFilter, setBrowserFilter] = useState<'all' | 'open' | 'in_progress' | 'closed'>('all')
  const [browserSort, setBrowserSort] = useState<'priority' | 'created' | 'status'>('priority')

  // Start dropdown state
  const [startDropdownTaskId, setStartDropdownTaskId] = useState<string | null>(null)
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null)

  const handleStartButtonClick = (e: React.MouseEvent, taskId: string): void => {
    if (startDropdownTaskId === taskId) {
      setStartDropdownTaskId(null)
      setDropdownPosition(null)
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setDropdownPosition({ top: rect.bottom + 4, left: rect.left })
      setStartDropdownTaskId(taskId)
    }
  }

  const handleOpenBrowser = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (projectPath && beadsState.status === 'ready') {
      setShowBrowser(true)
    }
  }

  const projectName = projectPath ? projectPath.split(/[/\\]/).pop() ?? null : null
  const isReady = beadsState.status === 'ready'
  const isLoading = beadsState.status === 'loading'
  const errorMessage = beadsState.status === 'error' ? beadsState.error : null
  const backendLabel = BACKEND_LABELS[backendKind]

  return (
    <div className="beads-panel">
      <BeadsHeader
        projectPath={projectPath}
        projectName={projectName}
        isExpanded={isExpanded}
        isReady={isReady}
        taskCount={tasks.length}
        backendKind={backendKind}
        onToggle={onToggle}
        onOpenBrowser={handleOpenBrowser}
      />

      {isExpanded && (
        <div className="beads-content">
          <div
            className={`beads-resize-handle ${isResizing ? 'active' : ''}`}
            onMouseDown={handleResizeStart}
            title="Drag to resize"
          />

          {!projectPath && (
            <div className="beads-empty">Select a project to view tasks</div>
          )}

          {projectPath && (beadsState.status === 'not_installed' || beadsState.status === 'not_initialized') && (
            <BeadsInstallView
              beadsState={beadsState}
              onInstallPython={taskOps.handleInstallPython}
              onInstallBeads={taskOps.handleInstallBeads}
              onInitBeads={taskOps.handleInitBeads}
              onInitKspec={taskOps.handleInitKspec}
            />
          )}

          {projectPath && isLoading && (
            <div className="beads-loading" role="status" aria-live="polite">Loading tasks...</div>
          )}

          {projectPath && errorMessage && (
            <div className="beads-error" role="alert" aria-live="assertive">{errorMessage}</div>
          )}

          {projectPath && isReady && backendKind === 'beads' && (
            <div className="kspec-upgrade-banner">
              <div className="kspec-upgrade-text">
                <strong>Upgrade to Kspec</strong>
                <span>Enable autonomous agents that pick up and complete tasks automatically.</span>
              </div>
              <button
                className="kspec-upgrade-btn"
                onClick={taskOps.handleUpgradeToKspec}
                disabled={taskOps.upgrading}
              >
                {taskOps.upgrading ? 'Upgrading...' : 'Upgrade'}
              </button>
            </div>
          )}

          {projectPath && isReady && backendKind === 'kspec' && (
            <div className="kspec-dispatch-row">
              <span className="kspec-dispatch-label">
                Agent Dispatch
                <span className={`kspec-dispatch-dot ${dispatchRunning ? 'active' : ''}`} />
              </span>
              <button
                className={`kspec-dispatch-btn ${dispatchRunning ? 'running' : ''}`}
                onClick={handleToggleDispatch}
                disabled={dispatchToggling}
                title={dispatchRunning ? 'Stop agent dispatch' : 'Start agent dispatch — agents will pick up eligible tasks'}
              >
                {dispatchToggling ? '...' : dispatchRunning ? 'Stop' : 'Start'}
              </button>
            </div>
          )}

          {projectPath && isReady && (
            <>
              <BeadsTaskList
                tasks={tasks}
                panelHeight={panelHeight}
                editingTaskId={taskOps.editingTaskId}
                editingTitle={taskOps.editingTitle}
                editInputRef={taskOps.editInputRef}
                onComplete={taskOps.handleCompleteTask}
                onStart={handleStartButtonClick}
                onCycleStatus={taskOps.handleCycleStatus}
                onDelete={taskOps.handleDeleteTask}
                onOpenDetail={detailOps.handleOpenDetail}
                setEditingTitle={taskOps.setEditingTitle}
                onSaveEdit={taskOps.handleSaveEdit}
                onCancelEdit={taskOps.handleCancelEdit}
              />

              <BeadsActionsRow
                hasClosedTasks={tasks.some((t: UnifiedTask) => t.status === 'closed')}
                onAddTask={() => taskOps.setShowCreateModal(true)}
                onClearCompleted={taskOps.handleClearCompleted}
                onRefresh={() => taskOps.loadTasks()}
              />
            </>
          )}
        </div>
      )}

      <CreateTaskModal
        show={taskOps.showCreateModal}
        onClose={() => taskOps.setShowCreateModal(false)}
        onCreate={taskOps.handleCreateTask}
        backendKind={backendKind}
        title={taskOps.newTaskTitle}
        setTitle={taskOps.setNewTaskTitle}
        type={taskOps.newTaskType}
        setType={taskOps.setNewTaskType}
        priority={taskOps.newTaskPriority}
        setPriority={taskOps.setNewTaskPriority}
        description={taskOps.newTaskDescription}
        setDescription={taskOps.setNewTaskDescription}
        labels={taskOps.newTaskLabels}
        setLabels={taskOps.setNewTaskLabels}
        automation={taskOps.newTaskAutomation}
        setAutomation={taskOps.setNewTaskAutomation}
      />

      <TaskDetailModal
        show={detailOps.showDetailModal}
        task={detailOps.detailTask}
        loading={detailOps.detailLoading}
        editing={detailOps.editingDetail}
        setEditing={detailOps.setEditingDetail}
        editTitle={detailOps.editDetailTitle}
        setEditTitle={detailOps.setEditDetailTitle}
        editDescription={detailOps.editDetailDescription}
        setEditDescription={detailOps.setEditDetailDescription}
        editPriority={detailOps.editDetailPriority}
        setEditPriority={detailOps.setEditDetailPriority}
        editStatus={detailOps.editDetailStatus}
        setEditStatus={detailOps.setEditDetailStatus}
        onClose={detailOps.handleCloseDetail}
        onSave={detailOps.handleSaveDetail}
      />

      <BrowserModal
        show={showBrowser}
        onClose={() => setShowBrowser(false)}
        projectName={projectName}
        backendLabel={backendLabel}
        tasks={tasks}
        filter={browserFilter}
        setFilter={setBrowserFilter}
        sort={browserSort}
        setSort={setBrowserSort}
        onRefresh={() => taskOps.loadTasks()}
        onCreateNew={() => {
          setShowBrowser(false)
          taskOps.setShowCreateModal(true)
        }}
        onComplete={taskOps.handleCompleteTask}
        onStart={handleStartButtonClick}
        onCycleStatus={taskOps.handleCycleStatus}
        onDelete={taskOps.handleDeleteTask}
        onOpenDetail={detailOps.handleOpenDetail}
        onClearCompleted={taskOps.handleClearCompleted}
      />

      <StartDropdown
        taskId={startDropdownTaskId}
        position={dropdownPosition}
        tasks={tasks}
        currentTabPtyId={currentTabPtyId}
        onStartInNewTab={onStartTaskInNewTab}
        onSendToCurrentTab={onSendToCurrentTab}
        onClose={() => setStartDropdownTaskId(null)}
        onCloseBrowser={() => setShowBrowser(false)}
      />
    </div>
  )
}

export default BeadsPanel
