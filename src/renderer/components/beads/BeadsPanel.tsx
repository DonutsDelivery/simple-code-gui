import React, { useState } from 'react'
import type { BeadsTask } from './types.js'
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
  // State management
  const {
    beadsState,
    setBeadsState,
    tasks,
    setTasks,
    currentProjectRef,
    suppressWatcherReloadRef,
    setError
  } = useBeadsState(projectPath)

  // Task CRUD operations
  const taskOps = useBeadsTasks({
    projectPath,
    beadsState,
    setBeadsState,
    tasks,
    setTasks,
    currentProjectRef,
    suppressWatcherReloadRef,
    setError
  })

  // Detail modal
  const detailOps = useBeadsDetail({
    projectPath,
    loadTasks: taskOps.loadTasks,
    setError
  })

  // Panel resize
  const { panelHeight, isResizing, handleResizeStart } = useBeadsResize()

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

  return (
    <div className="beads-panel">
      <BeadsHeader
        projectPath={projectPath}
        projectName={projectName}
        isExpanded={isExpanded}
        isReady={isReady}
        taskCount={tasks.length}
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
            />
          )}

          {projectPath && isLoading && (
            <div className="beads-loading" role="status" aria-live="polite">Loading tasks...</div>
          )}

          {projectPath && errorMessage && (
            <div className="beads-error" role="alert" aria-live="assertive">{errorMessage}</div>
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
                hasClosedTasks={tasks.some((t: BeadsTask) => t.status === 'closed')}
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
