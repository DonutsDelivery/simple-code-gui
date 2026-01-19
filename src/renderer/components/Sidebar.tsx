import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Project, useWorkspaceStore } from '../stores/workspace.js'
import { BeadsPanel } from './BeadsPanel.js'
import { GSDStatus } from './GSDStatus.js'
import { ExtensionBrowser } from './ExtensionBrowser.js'
import { ClaudeMdEditor } from './ClaudeMdEditor.js'
import { useVoice } from '../contexts/VoiceContext.js'
import {
  SidebarProps,
  getCategoryGradient,
  ProjectItem,
  ProjectContextMenu,
  ProjectSettingsModal,
  CategoryContextMenu,
  DeleteConfirmModal,
  VirtualizedProjectList,
  CategoryHeader,
  VoiceOptionsPanel,
  SidebarActions,
  useSessions,
  useDragAndDrop,
  useProjectSettingsModal,
} from './sidebar/index.js'

export function Sidebar({
  projects,
  openTabs,
  activeTabId,
  lastFocusedTabId,
  onAddProject,
  onRemoveProject,
  onOpenSession,
  onSwitchToTab,
  onOpenSettings,
  onOpenMakeProject,
  onUpdateProject,
  onCloseProjectTabs,
  width,
  collapsed,
  onWidthChange,
  onCollapsedChange,
}: SidebarProps): React.ReactElement | null {
  const { volume, setVolume, speed, setSpeed, skipOnNew, setSkipOnNew, voiceOutputEnabled } =
    useVoice()

  const categories = useWorkspaceStore((state) => state.categories)
  const addCategory = useWorkspaceStore((state) => state.addCategory)
  const updateCategory = useWorkspaceStore((state) => state.updateCategory)
  const removeCategory = useWorkspaceStore((state) => state.removeCategory)
  const reorderCategories = useWorkspaceStore((state) => state.reorderCategories)
  const moveProjectToCategory = useWorkspaceStore((state) => state.moveProjectToCategory)
  const reorderProjects = useWorkspaceStore((state) => state.reorderProjects)

  // Custom hooks for extracted logic
  const { expandedProject, sessions, toggleProject, handleOpenSession } = useSessions({
    projects,
    openTabs,
    onOpenSession,
    onSwitchToTab,
  })

  const {
    draggedProject,
    draggedCategory,
    dropTarget,
    handleProjectDragStart,
    handleProjectDragEnd,
    handleCategoryDragOver,
    handleCategoryDrop,
    handleProjectDragOver,
    handleProjectDrop,
    handleCategoryDragStart,
    handleCategoryDragEnd,
    handleCategoryHeaderDragOver,
    handleCategoryHeaderDrop,
  } = useDragAndDrop({
    projects,
    moveProjectToCategory,
    reorderProjects,
    reorderCategories,
    categories,
  })

  const {
    projectSettingsModal,
    installedVoices,
    globalVoiceSettings,
    globalPermissions,
    apiStatus,
    setApiStatus,
    handleOpenProjectSettings,
    handleSaveProjectSettings,
    handleToggleApi,
    setProjectSettingsModal,
    handleToggleTool,
    handleAllowAll,
    handleClearAll,
    handleProjectSettingsChange,
  } = useProjectSettingsModal({ onUpdateProject })

  // Local state
  const [beadsExpanded, setBeadsExpanded] = useState(true)
  const [isResizing, setIsResizing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: Project } | null>(
    null
  )
  const [categoryContextMenu, setCategoryContextMenu] = useState<{
    x: number
    y: number
    category: ReturnType<typeof useWorkspaceStore.getState>['categories'][0]
  } | null>(null)
  const [editingProject, setEditingProject] = useState<{ path: string; name: string } | null>(null)
  const [editingCategory, setEditingCategory] = useState<{ id: string; name: string } | null>(null)
  const [isDebugMode, setIsDebugMode] = useState(false)
  const [extensionBrowserModal, setExtensionBrowserModal] = useState<{ project: Project } | null>(
    null
  )
  const [claudeMdEditorModal, setClaudeMdEditorModal] = useState<{ project: Project } | null>(null)
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{ project: Project } | null>(null)
  const [taskCounts, setTaskCounts] = useState<Record<string, { open: number; inProgress: number }>>(
    {}
  )

  const sidebarRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const categoryEditInputRef = useRef<HTMLInputElement>(null)

  // Computed values
  const focusedTabId = lastFocusedTabId || activeTabId
  const focusedTab = useMemo(
    () => openTabs.find((t) => t.id === focusedTabId),
    [openTabs, focusedTabId]
  )
  const focusedProjectPath = useMemo(() => focusedTab?.projectPath || null, [focusedTab])
  const focusedTabPtyId = useMemo(() => focusedTab?.ptyId || null, [focusedTab])
  const beadsProjectPath = useMemo(
    () => focusedProjectPath || expandedProject,
    [focusedProjectPath, expandedProject]
  )
  const focusedProject = useMemo(
    () => projects.find((p) => p.path === focusedProjectPath),
    [projects, focusedProjectPath]
  )

  // Resize handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    let rafId: number | null = null
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const newWidth = Math.min(Math.max(e.clientX, 200), 500)
        onWidthChange(newWidth)
      })
    }
    const handleMouseUp = () => setIsResizing(false)

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, onWidthChange])

  // Project handlers
  const handleSelectExecutable = async (project: Project) => {
    const executable = await window.electronAPI.selectExecutable()
    if (executable) onUpdateProject(project.path, { executable })
    setContextMenu(null)
  }

  const handleClearExecutable = (project: Project) => {
    onUpdateProject(project.path, { executable: undefined })
    setContextMenu(null)
  }

  const handleRunExecutable = async (project: Project) => {
    if (project.executable) {
      const result = await window.electronAPI.runExecutable(project.executable, project.path)
      if (!result.success) console.error('Failed to run executable:', result.error)
    }
    setContextMenu(null)
  }

  // Rename handlers
  const handleStartRename = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation()
    setEditingProject({ path: project.path, name: project.name })
    setTimeout(() => editInputRef.current?.select(), 0)
  }

  const handleRenameSubmit = () => {
    if (editingProject && editingProject.name.trim()) {
      onUpdateProject(editingProject.path, { name: editingProject.name.trim() })
    }
    setEditingProject(null)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameSubmit()
    else if (e.key === 'Escape') setEditingProject(null)
  }

  // Category handlers
  const handleAddCategory = () => {
    const newId = addCategory('New Category')
    setEditingCategory({ id: newId, name: 'New Category' })
    setTimeout(() => categoryEditInputRef.current?.select(), 0)
  }

  const handleStartCategoryRename = (
    category: ReturnType<typeof useWorkspaceStore.getState>['categories'][0]
  ) => {
    setEditingCategory({ id: category.id, name: category.name })
    setTimeout(() => categoryEditInputRef.current?.select(), 0)
  }

  const handleCategoryRenameSubmit = () => {
    if (editingCategory && editingCategory.name.trim()) {
      updateCategory(editingCategory.id, { name: editingCategory.name.trim() })
    }
    setEditingCategory(null)
  }

  const handleCategoryRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCategoryRenameSubmit()
    else if (e.key === 'Escape') setEditingCategory(null)
  }

  const toggleCategoryCollapse = (categoryId: string) => {
    const category = categories.find((c) => c.id === categoryId)
    if (category) updateCategory(categoryId, { collapsed: !category.collapsed })
  }

  // Computed groupings
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.order - b.order),
    [categories]
  )

  const projectsByCategory = useMemo(() => {
    const grouped: Record<string, Project[]> = {}
    sortedCategories.forEach((cat) => {
      grouped[cat.id] = []
    })
    grouped['uncategorized'] = []

    projects.forEach((project) => {
      const key = project.categoryId || 'uncategorized'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(project)
    })

    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    })

    return grouped
  }, [projects, sortedCategories])

  // Effects
  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null)
      setCategoryContextMenu(null)
    }
    if (contextMenu || categoryContextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu, categoryContextMenu])

  useEffect(() => {
    if (contextMenu) {
      window.electronAPI.apiStatus(contextMenu.project.path).then((status) => {
        setApiStatus((prev) => ({ ...prev, [contextMenu.project.path]: status }))
      })
    }
  }, [contextMenu, setApiStatus])

  useEffect(() => {
    async function fetchTaskCounts(): Promise<void> {
      const counts: Record<string, { open: number; inProgress: number }> = {}
      for (const project of projects) {
        try {
          const status = await window.electronAPI.beadsCheck(project.path)
          if (status.installed && status.initialized) {
            const result = await window.electronAPI.beadsList(project.path)
            if (result.success && result.tasks) {
              const open = result.tasks.filter((t: { status: string }) => t.status === 'open')
                .length
              const inProgress = result.tasks.filter(
                (t: { status: string }) => t.status === 'in_progress'
              ).length
              counts[project.path] = { open, inProgress }
            }
          }
        } catch {
          /* ignore */
        }
      }
      setTaskCounts(counts)
    }
    fetchTaskCounts()
    const interval = setInterval(fetchTaskCounts, 30000)
    return () => clearInterval(interval)
  }, [projects])

  useEffect(() => {
    if (focusedProjectPath) {
      window.electronAPI.apiStatus(focusedProjectPath).then((status) => {
        setApiStatus((prev) => ({ ...prev, [focusedProjectPath]: status }))
      })
    }
  }, [focusedProjectPath, setApiStatus])

  useEffect(() => {
    window.electronAPI.isDebugMode().then(setIsDebugMode)
  }, [])

  // Memoized project item callbacks
  const handleProjectToggleExpand = useCallback(
    (e: React.MouseEvent, projectPath: string) => {
      toggleProject(e, projectPath)
    },
    [toggleProject]
  )

  const handleProjectOpenSession = useCallback(
    (projectPath: string, sessionId?: string, slug?: string, isNewSession?: boolean) => {
      handleOpenSession(projectPath, sessionId, slug, isNewSession)
    },
    [handleOpenSession]
  )

  const handleProjectRunExecutable = useCallback(
    async (projectPath: string) => {
      const project = projects.find((p) => p.path === projectPath)
      if (project) await handleRunExecutable(project)
    },
    [projects]
  )

  const handleProjectCloseProjectTabs = useCallback(
    (projectPath: string) => {
      onCloseProjectTabs(projectPath)
    },
    [onCloseProjectTabs]
  )

  const handleProjectContextMenu = useCallback((e: React.MouseEvent, project: Project) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, project })
  }, [])

  const handleProjectItemDragStart = useCallback(
    (e: React.DragEvent, projectPath: string) => {
      handleProjectDragStart(e, projectPath)
    },
    [handleProjectDragStart]
  )

  const handleProjectItemDragOver = useCallback(
    (e: React.DragEvent, projectPath: string) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      const position = e.clientY < midY ? 'before' : 'after'
      handleProjectDragOver(e, projectPath, position)
    },
    [handleProjectDragOver]
  )

  const handleProjectItemDrop = useCallback(
    (e: React.DragEvent, projectPath: string, categoryId: string | undefined) => {
      handleProjectDrop(e, projectPath, categoryId)
    },
    [handleProjectDrop]
  )

  const handleProjectStartRename = useCallback((e: React.MouseEvent, project: Project) => {
    handleStartRename(e, project)
  }, [])

  const handleProjectEditingChange = useCallback((name: string) => {
    setEditingProject((prev) => (prev ? { ...prev, name } : null))
  }, [])

  // Render project item
  const renderProjectItem = useCallback(
    (project: Project) => (
      <ProjectItem
        key={project.path}
        project={project}
        isExpanded={expandedProject === project.path}
        isFocused={focusedProjectPath === project.path}
        hasOpenTab={openTabs.some((t) => t.projectPath === project.path)}
        isDragging={draggedProject === project.path}
        isEditing={editingProject?.path === project.path}
        editingName={editingProject?.path === project.path ? editingProject.name : ''}
        sessions={sessions[project.path] || []}
        taskCounts={taskCounts[project.path]}
        dropTarget={dropTarget}
        editInputRef={editInputRef}
        onToggleExpand={(e) => handleProjectToggleExpand(e, project.path)}
        onOpenSession={(sessionId, slug, isNewSession) =>
          handleProjectOpenSession(project.path, sessionId, slug, isNewSession)
        }
        onRunExecutable={() => handleProjectRunExecutable(project.path)}
        onCloseProjectTabs={() => handleProjectCloseProjectTabs(project.path)}
        onContextMenu={(e) => handleProjectContextMenu(e, project)}
        onDragStart={(e) => handleProjectItemDragStart(e, project.path)}
        onDragEnd={handleProjectDragEnd}
        onDragOver={(e) => handleProjectItemDragOver(e, project.path)}
        onDrop={(e) => handleProjectItemDrop(e, project.path, project.categoryId)}
        onStartRename={(e) => handleProjectStartRename(e, project)}
        onEditingChange={handleProjectEditingChange}
        onRenameSubmit={handleRenameSubmit}
        onRenameKeyDown={handleRenameKeyDown}
      />
    ),
    [
      expandedProject,
      focusedProjectPath,
      openTabs,
      draggedProject,
      editingProject,
      sessions,
      taskCounts,
      dropTarget,
      handleProjectToggleExpand,
      handleProjectOpenSession,
      handleProjectRunExecutable,
      handleProjectCloseProjectTabs,
      handleProjectContextMenu,
      handleProjectItemDragStart,
      handleProjectDragEnd,
      handleProjectItemDragOver,
      handleProjectItemDrop,
      handleProjectStartRename,
      handleProjectEditingChange,
      handleRenameSubmit,
      handleRenameKeyDown,
    ]
  )

  if (collapsed) {
    return (
      <div className="sidebar collapsed" ref={sidebarRef}>
        <button
          className="sidebar-collapse-btn"
          onClick={() => onCollapsedChange(false)}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          ▶
        </button>
      </div>
    )
  }

  return (
    <div className="sidebar" ref={sidebarRef} style={{ width }}>
      <button
        className="sidebar-collapse-btn"
        onClick={() => onCollapsedChange(true)}
        title="Collapse sidebar"
        aria-label="Collapse sidebar"
      >
        ◀
      </button>
      <div className="sidebar-header">
        Projects
        <button
          className="add-category-btn"
          onClick={handleAddCategory}
          title="Add category"
          aria-label="Add category"
        >
          +
        </button>
      </div>
      <div className="projects-list">
        {sortedCategories.map((category) => {
          const categoryProjects = projectsByCategory[category.id] || []
          const { background: gradient, textDark } = getCategoryGradient(categoryProjects)

          return (
            <div
              key={category.id}
              className={`category-container ${dropTarget?.type === 'category' && dropTarget.id === category.id && !dropTarget.position ? 'drop-target' : ''}`}
            >
              {dropTarget?.type === 'category' &&
                dropTarget.id === category.id &&
                dropTarget.position === 'before' && <div className="drop-indicator" />}

              <CategoryHeader
                category={category}
                projectCount={categoryProjects.length}
                gradient={gradient}
                textDark={textDark}
                isCollapsed={category.collapsed || false}
                isDragging={draggedCategory === category.id}
                isEditing={editingCategory?.id === category.id}
                editingName={editingCategory?.id === category.id ? editingCategory.name : ''}
                editInputRef={categoryEditInputRef}
                draggedCategory={draggedCategory}
                draggedProject={draggedProject}
                onToggleCollapse={() => toggleCategoryCollapse(category.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setCategoryContextMenu({ x: e.clientX, y: e.clientY, category })
                }}
                onDragStart={(e) => handleCategoryDragStart(e, category.id)}
                onDragEnd={handleCategoryDragEnd}
                onCategoryHeaderDragOver={(e, position) =>
                  handleCategoryHeaderDragOver(e, category.id, position)
                }
                onCategoryDragOver={(e) => handleCategoryDragOver(e, category.id)}
                onCategoryHeaderDrop={(e) => handleCategoryHeaderDrop(e, category.id)}
                onCategoryDrop={(e) => handleCategoryDrop(e, category.id)}
                onStartRename={() => handleStartCategoryRename(category)}
                onEditingChange={(name) => setEditingCategory({ id: category.id, name })}
                onRenameSubmit={handleCategoryRenameSubmit}
                onRenameKeyDown={handleCategoryRenameKeyDown}
              />

              {dropTarget?.type === 'category' &&
                dropTarget.id === category.id &&
                dropTarget.position === 'after' && <div className="drop-indicator" />}

              {!category.collapsed && (
                <div className="category-projects">
                  <VirtualizedProjectList
                    projects={categoryProjects}
                    expandedProject={expandedProject}
                    sessions={sessions}
                    renderItem={renderProjectItem}
                  />
                </div>
              )}
            </div>
          )
        })}

        {(projectsByCategory['uncategorized']?.length > 0 || sortedCategories.length > 0) && (
          <div
            className={`uncategorized-section ${dropTarget?.type === 'uncategorized' ? 'drop-target' : ''}`}
            onDragOver={(e) => handleCategoryDragOver(e, null)}
            onDrop={(e) => handleCategoryDrop(e, null)}
          >
            {sortedCategories.length > 0 && projectsByCategory['uncategorized']?.length > 0 && (
              <div className="uncategorized-header">Uncategorized</div>
            )}
            {projectsByCategory['uncategorized'] && (
              <VirtualizedProjectList
                projects={projectsByCategory['uncategorized']}
                expandedProject={expandedProject}
                sessions={sessions}
                renderItem={renderProjectItem}
              />
            )}
          </div>
        )}

        {projects.length === 0 && (
          <div className="empty-projects">
            No projects yet.
            <br />
            Click + to add one.
          </div>
        )}
        <div className="project-add-buttons">
          <button
            className="add-project-btn"
            onClick={onOpenMakeProject}
            title="Create new project from scratch"
          >
            + make
          </button>
          <button className="add-project-btn" onClick={onAddProject} title="Add existing project folder">
            + add
          </button>
        </div>
      </div>

      <BeadsPanel
        projectPath={beadsProjectPath}
        isExpanded={beadsExpanded}
        onToggle={() => setBeadsExpanded(!beadsExpanded)}
        onStartTaskInNewTab={(prompt) => {
          if (beadsProjectPath) onOpenSession(beadsProjectPath, undefined, undefined, prompt, true)
        }}
        onSendToCurrentTab={(prompt) => {
          if (focusedTabPtyId) {
            window.electronAPI.writePty(focusedTabPtyId, prompt)
            setTimeout(() => window.electronAPI.writePty(focusedTabPtyId, '\r'), 100)
          }
        }}
        currentTabPtyId={focusedTabPtyId}
      />

      <GSDStatus
        projectPath={beadsProjectPath}
        onCommand={(cmd) => {
          if (focusedTabPtyId) {
            window.electronAPI.writePty(focusedTabPtyId, cmd)
            setTimeout(() => window.electronAPI.writePty(focusedTabPtyId, '\r'), 100)
          }
        }}
      />

      {voiceOutputEnabled && (
        <VoiceOptionsPanel
          volume={volume}
          speed={speed}
          skipOnNew={skipOnNew}
          onVolumeChange={setVolume}
          onSpeedChange={setSpeed}
          onSkipOnNewChange={setSkipOnNew}
        />
      )}

      <SidebarActions
        activeTabId={activeTabId}
        focusedProject={focusedProject}
        apiStatus={focusedProjectPath ? apiStatus[focusedProjectPath] : undefined}
        isDebugMode={isDebugMode}
        onOpenSettings={onOpenSettings}
        onOpenProjectSettings={async (project) => {
          await handleOpenProjectSettings(project)
          setContextMenu(null)
        }}
        onToggleApi={async (project) => {
          await handleToggleApi(project)
          setContextMenu(null)
        }}
      />
      <div className="sidebar-resize-handle" onMouseDown={handleMouseDown} />

      {/* Context Menu */}
      {contextMenu && (
        <ProjectContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          project={contextMenu.project}
          categories={categories}
          onClose={() => setContextMenu(null)}
          onRunExecutable={() => handleRunExecutable(contextMenu.project)}
          onSelectExecutable={() => handleSelectExecutable(contextMenu.project)}
          onClearExecutable={() => handleClearExecutable(contextMenu.project)}
          onOpenSettings={async () => {
            await handleOpenProjectSettings(contextMenu.project)
            setContextMenu(null)
          }}
          onOpenExtensions={() => {
            setExtensionBrowserModal({ project: contextMenu.project })
            setContextMenu(null)
          }}
          onEditClaudeMd={() => {
            setClaudeMdEditorModal({ project: contextMenu.project })
            setContextMenu(null)
          }}
          onUpdateColor={(color) => onUpdateProject(contextMenu.project.path, { color })}
          onMoveToCategory={(categoryId) =>
            moveProjectToCategory(contextMenu.project.path, categoryId)
          }
          onCreateCategory={() => {
            const newId = addCategory('New Category')
            moveProjectToCategory(contextMenu.project.path, newId)
            setContextMenu(null)
            setEditingCategory({ id: newId, name: 'New Category' })
            setTimeout(() => categoryEditInputRef.current?.select(), 0)
          }}
          onDelete={() => {
            setDeleteConfirmModal({ project: contextMenu.project })
            setContextMenu(null)
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmModal && (
        <DeleteConfirmModal
          project={deleteConfirmModal.project}
          onClose={() => setDeleteConfirmModal(null)}
          onConfirm={() => {
            onRemoveProject(deleteConfirmModal.project.path)
            setDeleteConfirmModal(null)
          }}
        />
      )}

      {/* Project Settings Modal */}
      {projectSettingsModal && (
        <ProjectSettingsModal
          state={projectSettingsModal}
          globalPermissions={globalPermissions}
          globalVoiceSettings={globalVoiceSettings}
          installedVoices={installedVoices}
          onClose={() => setProjectSettingsModal(null)}
          onSave={handleSaveProjectSettings}
          onChange={handleProjectSettingsChange}
          onToggleTool={handleToggleTool}
          onAllowAll={handleAllowAll}
          onClearAll={handleClearAll}
        />
      )}

      {/* Extension Browser Modal */}
      {extensionBrowserModal && (
        <ExtensionBrowser
          projectPath={extensionBrowserModal.project.path}
          projectName={extensionBrowserModal.project.name}
          onClose={() => setExtensionBrowserModal(null)}
        />
      )}

      {/* CLAUDE.md Editor Modal */}
      {claudeMdEditorModal && (
        <ClaudeMdEditor
          isOpen={true}
          projectPath={claudeMdEditorModal.project.path}
          projectName={claudeMdEditorModal.project.name}
          onClose={() => setClaudeMdEditorModal(null)}
        />
      )}

      {/* Category Context Menu */}
      {categoryContextMenu && (
        <CategoryContextMenu
          x={categoryContextMenu.x}
          y={categoryContextMenu.y}
          category={categoryContextMenu.category}
          onRename={() => {
            handleStartCategoryRename(categoryContextMenu.category)
            setCategoryContextMenu(null)
          }}
          onDelete={() => {
            removeCategory(categoryContextMenu.category.id)
            setCategoryContextMenu(null)
          }}
        />
      )}
    </div>
  )
}
