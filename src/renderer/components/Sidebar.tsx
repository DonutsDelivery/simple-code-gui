import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Project, useWorkspaceStore } from '../stores/workspace.js'
import { BeadsPanel } from './BeadsPanel.js'
import { VoiceControls } from './VoiceControls.js'
import { ExtensionBrowser } from './ExtensionBrowser.js'
import { ClaudeMdEditor } from './ClaudeMdEditor.js'
import { useVoice } from '../contexts/VoiceContext.js'
import {
  ClaudeSession,
  SidebarProps,
  ProjectSettingsModalState,
  InstalledVoice,
  DropTarget,
  getCategoryGradient,
  COMMON_TOOLS,
  ProjectItem,
  ProjectContextMenu,
  ProjectSettingsModal,
  CategoryContextMenu,
  DeleteConfirmModal,
} from './sidebar/index.js'

export function Sidebar({ projects, openTabs, activeTabId, lastFocusedTabId, onAddProject, onRemoveProject, onOpenSession, onSwitchToTab, onOpenSettings, onOpenMakeProject, onUpdateProject, onCloseProjectTabs, width, collapsed, onWidthChange, onCollapsedChange }: SidebarProps) {
  const { volume, setVolume, speed, setSpeed, skipOnNew, setSkipOnNew, voiceOutputEnabled } = useVoice()

  const categories = useWorkspaceStore(state => state.categories)
  const addCategory = useWorkspaceStore(state => state.addCategory)
  const updateCategory = useWorkspaceStore(state => state.updateCategory)
  const removeCategory = useWorkspaceStore(state => state.removeCategory)
  const reorderCategories = useWorkspaceStore(state => state.reorderCategories)
  const moveProjectToCategory = useWorkspaceStore(state => state.moveProjectToCategory)
  const reorderProjects = useWorkspaceStore(state => state.reorderProjects)

  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Record<string, ClaudeSession[]>>({})
  const [beadsExpanded, setBeadsExpanded] = useState(true)
  const [isResizing, setIsResizing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: Project } | null>(null)
  const [categoryContextMenu, setCategoryContextMenu] = useState<{ x: number; y: number; category: ReturnType<typeof useWorkspaceStore.getState>['categories'][0] } | null>(null)
  const [projectSettingsModal, setProjectSettingsModal] = useState<ProjectSettingsModalState | null>(null)
  const [installedVoices, setInstalledVoices] = useState<InstalledVoice[]>([])
  const [globalVoiceSettings, setGlobalVoiceSettings] = useState<{ voice: string; engine: string }>({ voice: '', engine: '' })
  const [globalPermissions, setGlobalPermissions] = useState<{ tools: string[]; mode: string }>({ tools: [], mode: 'default' })
  const [apiStatus, setApiStatus] = useState<Record<string, { running: boolean; port?: number }>>({})
  const [editingProject, setEditingProject] = useState<{ path: string; name: string } | null>(null)
  const [editingCategory, setEditingCategory] = useState<{ id: string; name: string } | null>(null)
  const [draggedProject, setDraggedProject] = useState<string | null>(null)
  const [draggedCategory, setDraggedCategory] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [isDebugMode, setIsDebugMode] = useState(false)
  const [extensionBrowserModal, setExtensionBrowserModal] = useState<{ project: Project } | null>(null)
  const [claudeMdEditorModal, setClaudeMdEditorModal] = useState<{ project: Project } | null>(null)
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{ project: Project } | null>(null)
  const [taskCounts, setTaskCounts] = useState<Record<string, { open: number; inProgress: number }>>({})

  const sidebarRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const categoryEditInputRef = useRef<HTMLInputElement>(null)

  // Resize handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newWidth = Math.min(Math.max(e.clientX, 200), 500)
      onWidthChange(newWidth)
    }
    const handleMouseUp = () => setIsResizing(false)

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, onWidthChange])

  // Computed values
  const focusedTabId = lastFocusedTabId || activeTabId
  const focusedTab = openTabs.find(t => t.id === focusedTabId)
  const focusedProjectPath = focusedTab?.projectPath || null
  const focusedTabPtyId = focusedTab?.ptyId || null
  const beadsProjectPath = expandedProject || focusedProjectPath

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

  const handleStartCategoryRename = (category: typeof categories[0]) => {
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
    const category = categories.find(c => c.id === categoryId)
    if (category) updateCategory(categoryId, { collapsed: !category.collapsed })
  }

  // Drag and drop handlers
  const handleProjectDragStart = (e: React.DragEvent, projectPath: string) => {
    setDraggedProject(projectPath)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', projectPath)
  }

  const handleProjectDragEnd = () => {
    setDraggedProject(null)
    setDropTarget(null)
  }

  const handleCategoryDragOver = (e: React.DragEvent, categoryId: string | null) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedProject) setDropTarget({ type: categoryId ? 'category' : 'uncategorized', id: categoryId })
  }

  const handleCategoryDrop = (e: React.DragEvent, categoryId: string | null) => {
    e.preventDefault()
    if (draggedProject) moveProjectToCategory(draggedProject, categoryId)
    setDraggedProject(null)
    setDropTarget(null)
  }

  const handleProjectDragOver = (e: React.DragEvent, projectPath: string, position: 'before' | 'after') => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (draggedProject && draggedProject !== projectPath) {
      setDropTarget({ type: 'project', id: projectPath, position })
    }
  }

  const handleProjectDrop = (e: React.DragEvent, targetPath: string, targetCategoryId: string | undefined) => {
    e.preventDefault()
    e.stopPropagation()
    if (draggedProject && draggedProject !== targetPath) {
      const draggedProjectData = projects.find(p => p.path === draggedProject)
      const targetProject = projects.find(p => p.path === targetPath)

      if (draggedProjectData && targetProject) {
        moveProjectToCategory(draggedProject, targetCategoryId ?? null)
        const categoryProjects = projects
          .filter(p => (targetCategoryId ? p.categoryId === targetCategoryId : !p.categoryId))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map(p => p.path)

        const newOrder = categoryProjects.filter(p => p !== draggedProject)
        const targetIndex = newOrder.indexOf(targetPath)
        const insertIndex = dropTarget?.position === 'after' ? targetIndex + 1 : targetIndex
        newOrder.splice(insertIndex, 0, draggedProject)
        reorderProjects(targetCategoryId ?? null, newOrder)
      }
    }
    setDraggedProject(null)
    setDropTarget(null)
  }

  const handleCategoryDragStart = (e: React.DragEvent, categoryId: string) => {
    setDraggedCategory(categoryId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', categoryId)
  }

  const handleCategoryDragEnd = () => {
    setDraggedCategory(null)
    setDropTarget(null)
  }

  const handleCategoryHeaderDragOver = (e: React.DragEvent, targetCategoryId: string, position: 'before' | 'after') => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedCategory && draggedCategory !== targetCategoryId) {
      setDropTarget({ type: 'category', id: targetCategoryId, position })
    }
  }

  const handleCategoryHeaderDrop = (e: React.DragEvent, targetCategoryId: string) => {
    e.preventDefault()
    if (draggedCategory && draggedCategory !== targetCategoryId) {
      const orderedCategories = [...categories].sort((a, b) => a.order - b.order)
      const categoryIds = orderedCategories.map(c => c.id)
      const newOrder = categoryIds.filter(id => id !== draggedCategory)
      const targetIndex = newOrder.indexOf(targetCategoryId)
      const insertIndex = dropTarget?.position === 'after' ? targetIndex + 1 : targetIndex
      newOrder.splice(insertIndex, 0, draggedCategory)
      reorderCategories(newOrder)
    }
    setDraggedCategory(null)
    setDropTarget(null)
  }

  // Computed groupings
  const sortedCategories = useMemo(() => [...categories].sort((a, b) => a.order - b.order), [categories])

  const projectsByCategory = useMemo(() => {
    const grouped: Record<string, Project[]> = {}
    sortedCategories.forEach(cat => { grouped[cat.id] = [] })
    grouped['uncategorized'] = []

    projects.forEach(project => {
      const key = project.categoryId || 'uncategorized'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(project)
    })

    Object.keys(grouped).forEach(key => {
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
        setApiStatus(prev => ({ ...prev, [contextMenu.project.path]: status }))
      })
    }
  }, [contextMenu])

  useEffect(() => {
    const fetchTaskCounts = async () => {
      const counts: Record<string, { open: number; inProgress: number }> = {}
      for (const project of projects) {
        try {
          const status = await window.electronAPI.beadsCheck(project.path)
          if (status.installed && status.initialized) {
            const result = await window.electronAPI.beadsList(project.path)
            if (result.success && result.tasks) {
              const open = result.tasks.filter((t: { status: string }) => t.status === 'open').length
              const inProgress = result.tasks.filter((t: { status: string }) => t.status === 'in_progress').length
              counts[project.path] = { open, inProgress }
            }
          }
        } catch { /* ignore */ }
      }
      setTaskCounts(counts)
    }
    fetchTaskCounts()
    const interval = setInterval(fetchTaskCounts, 30000)
    return () => clearInterval(interval)
  }, [projects])

  // Project settings modal handlers
  const handleOpenProjectSettings = async (project: Project) => {
    const settings = await window.electronAPI.getSettings()
    setGlobalPermissions({ tools: settings.autoAcceptTools || [], mode: settings.permissionMode || 'default' })

    const [piperVoices, xttsVoices, voiceSettings] = await Promise.all([
      window.electronAPI.voiceGetInstalled?.() || [],
      window.electronAPI.xttsGetVoices?.() || [],
      window.electronAPI.voiceGetSettings?.() || {}
    ])
    const combined: InstalledVoice[] = []
    if (piperVoices) combined.push(...piperVoices)
    if (xttsVoices) {
      combined.push(...xttsVoices.map((v: { id: string; name: string }) => ({
        key: v.id,
        displayName: v.name,
        source: 'xtts'
      })))
    }
    setInstalledVoices(combined)
    setGlobalVoiceSettings({ voice: voiceSettings?.ttsVoice || '', engine: voiceSettings?.ttsEngine || 'piper' })

    setProjectSettingsModal({
      project,
      apiPort: project.apiPort?.toString() || '',
      apiSessionMode: project.apiSessionMode || 'existing',
      apiModel: project.apiModel || 'default',
      tools: project.autoAcceptTools || [],
      permissionMode: project.permissionMode || 'default',
      ttsVoice: project.ttsVoice || '',
      ttsEngine: project.ttsEngine || '',
      backend: project.backend || 'default'
    })
    setContextMenu(null)
  }

  const handleSaveProjectSettings = async () => {
    if (!projectSettingsModal) return

    const port = parseInt(projectSettingsModal.apiPort, 10)
    const hasPortValue = projectSettingsModal.apiPort.trim() !== ''

    if (hasPortValue && (isNaN(port) || port < 1024 || port > 65535)) {
      setProjectSettingsModal({ ...projectSettingsModal, apiStatus: 'error', apiError: 'Please enter a valid port number (1024-65535)' })
      return
    }

    const newPort = hasPortValue ? port : undefined
    const oldPort = projectSettingsModal.project.apiPort

    if (newPort !== oldPort) {
      if (!newPort) {
        await window.electronAPI.apiStop(projectSettingsModal.project.path)
        setApiStatus(prev => ({ ...prev, [projectSettingsModal.project.path]: { running: false } }))
      } else {
        setProjectSettingsModal({ ...projectSettingsModal, apiStatus: 'checking' })
        const result = await window.electronAPI.apiStart(projectSettingsModal.project.path, newPort)
        if (!result.success) {
          setProjectSettingsModal({ ...projectSettingsModal, apiStatus: 'error', apiError: result.error || 'Port may already be in use' })
          return
        }
        setApiStatus(prev => ({ ...prev, [projectSettingsModal.project.path]: { running: true, port: newPort } }))
      }
    }

    onUpdateProject(projectSettingsModal.project.path, {
      apiPort: newPort,
      apiSessionMode: projectSettingsModal.apiSessionMode !== 'existing' ? projectSettingsModal.apiSessionMode : undefined,
      apiModel: projectSettingsModal.apiModel !== 'default' ? projectSettingsModal.apiModel : undefined,
      autoAcceptTools: projectSettingsModal.tools.length > 0 ? projectSettingsModal.tools : undefined,
      permissionMode: projectSettingsModal.permissionMode !== 'default' ? projectSettingsModal.permissionMode : undefined,
      ttsVoice: projectSettingsModal.ttsVoice || undefined,
      ttsEngine: projectSettingsModal.ttsEngine || undefined,
      backend: projectSettingsModal.backend !== 'default' ? projectSettingsModal.backend : undefined
    })

    setProjectSettingsModal(null)
  }

  const handleToggleApi = async (project: Project) => {
    const status = apiStatus[project.path]
    if (status?.running) {
      await window.electronAPI.apiStop(project.path)
      setApiStatus(prev => ({ ...prev, [project.path]: { running: false } }))
    } else if (project.apiPort) {
      const result = await window.electronAPI.apiStart(project.path, project.apiPort)
      if (result.success) {
        setApiStatus(prev => ({ ...prev, [project.path]: { running: true, port: project.apiPort } }))
      } else {
        alert(`Failed to start API server: ${result.error}`)
      }
    }
    setContextMenu(null)
  }

  useEffect(() => {
    if (focusedProjectPath) {
      window.electronAPI.apiStatus(focusedProjectPath).then((status) => {
        setApiStatus(prev => ({ ...prev, [focusedProjectPath]: status }))
      })
    }
  }, [focusedProjectPath])

  useEffect(() => {
    window.electronAPI.isDebugMode().then(setIsDebugMode)
  }, [])

  useEffect(() => {
    const loadSessions = async () => {
      if (expandedProject) {
        try {
          const projectSessions = await window.electronAPI.discoverSessions(expandedProject)
          setSessions((prev) => ({ ...prev, [expandedProject]: projectSessions }))
        } catch (e) {
          console.error('Failed to discover sessions:', e)
        }
      }
    }
    loadSessions()
  }, [expandedProject])

  const toggleProject = (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    setExpandedProject(expandedProject === path ? null : path)
  }

  const openMostRecentSession = async (projectPath: string) => {
    const existingTab = openTabs.find(tab => tab.projectPath === projectPath)
    if (existingTab) {
      onSwitchToTab(existingTab.id)
      return
    }

    let projectSessions = sessions[projectPath]
    if (!projectSessions) {
      try {
        projectSessions = await window.electronAPI.discoverSessions(projectPath)
        setSessions((prev) => ({ ...prev, [projectPath]: projectSessions }))
      } catch (e) {
        console.error('Failed to discover sessions:', e)
        projectSessions = []
      }
    }

    if (projectSessions && projectSessions.length > 0) {
      const mostRecent = projectSessions[0]
      onOpenSession(projectPath, mostRecent.sessionId, mostRecent.slug)
    } else {
      onOpenSession(projectPath)
    }
  }

  // Render project item
  const renderProjectItem = (project: Project) => (
    <ProjectItem
      key={project.path}
      project={project}
      isExpanded={expandedProject === project.path}
      isFocused={focusedProjectPath === project.path}
      hasOpenTab={openTabs.some(t => t.projectPath === project.path)}
      isDragging={draggedProject === project.path}
      isEditing={editingProject?.path === project.path}
      editingName={editingProject?.path === project.path ? editingProject.name : ''}
      sessions={sessions[project.path] || []}
      taskCounts={taskCounts[project.path]}
      dropTarget={dropTarget}
      editInputRef={editInputRef}
      onToggleExpand={(e) => toggleProject(e, project.path)}
      onOpenSession={(sessionId, slug) => {
        if (sessionId) {
          onOpenSession(project.path, sessionId, slug)
        } else {
          openMostRecentSession(project.path)
        }
      }}
      onRunExecutable={() => handleRunExecutable(project)}
      onCloseProjectTabs={() => onCloseProjectTabs(project.path)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setContextMenu({ x: e.clientX, y: e.clientY, project })
      }}
      onDragStart={(e) => handleProjectDragStart(e, project.path)}
      onDragEnd={handleProjectDragEnd}
      onDragOver={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        const position = e.clientY < midY ? 'before' : 'after'
        handleProjectDragOver(e, project.path, position)
      }}
      onDrop={(e) => handleProjectDrop(e, project.path, project.categoryId)}
      onStartRename={(e) => handleStartRename(e, project)}
      onEditingChange={(name) => setEditingProject(prev => prev ? { ...prev, name } : null)}
      onRenameSubmit={handleRenameSubmit}
      onRenameKeyDown={handleRenameKeyDown}
    />
  )

  if (collapsed) {
    return (
      <div className="sidebar collapsed" ref={sidebarRef}>
        <button className="sidebar-collapse-btn" onClick={() => onCollapsedChange(false)} title="Expand sidebar">▶</button>
      </div>
    )
  }

  return (
    <div className="sidebar" ref={sidebarRef} style={{ width }}>
      <button className="sidebar-collapse-btn" onClick={() => onCollapsedChange(true)} title="Collapse sidebar">◀</button>
      <div className="sidebar-header">
        Projects
        <button className="add-category-btn" onClick={handleAddCategory} title="Add category">+</button>
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
              {dropTarget?.type === 'category' && dropTarget.id === category.id && dropTarget.position === 'before' && (
                <div className="drop-indicator" />
              )}

              <div
                className={`category-header ${category.collapsed ? 'collapsed' : ''} ${draggedCategory === category.id ? 'dragging' : ''} ${textDark ? 'text-dark' : ''}`}
                style={{ background: gradient }}
                draggable={!editingCategory}
                onDragStart={(e) => handleCategoryDragStart(e, category.id)}
                onDragEnd={handleCategoryDragEnd}
                onDragOver={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const midY = rect.top + rect.height / 2
                  const position = e.clientY < midY ? 'before' : 'after'
                  if (draggedCategory) handleCategoryHeaderDragOver(e, category.id, position)
                  else if (draggedProject) handleCategoryDragOver(e, category.id)
                }}
                onDrop={(e) => {
                  if (draggedCategory) handleCategoryHeaderDrop(e, category.id)
                  else if (draggedProject) handleCategoryDrop(e, category.id)
                }}
                onClick={() => toggleCategoryCollapse(category.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setCategoryContextMenu({ x: e.clientX, y: e.clientY, category })
                }}
              >
                <span className="expand-arrow">{category.collapsed ? '▶' : '▼'}</span>
                {editingCategory?.id === category.id ? (
                  <input
                    ref={categoryEditInputRef}
                    type="text"
                    className="category-name-input"
                    value={editingCategory.name}
                    onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                    onKeyDown={handleCategoryRenameKeyDown}
                    onBlur={handleCategoryRenameSubmit}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="category-name" onDoubleClick={() => handleStartCategoryRename(category)}>
                    {category.name}
                  </span>
                )}
                <span className="category-count">{categoryProjects.length}</span>
              </div>

              {dropTarget?.type === 'category' && dropTarget.id === category.id && dropTarget.position === 'after' && (
                <div className="drop-indicator" />
              )}

              {!category.collapsed && (
                <div className="category-projects">{categoryProjects.map(renderProjectItem)}</div>
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
            {projectsByCategory['uncategorized']?.map(renderProjectItem)}
          </div>
        )}

        {projects.length === 0 && (
          <div className="empty-projects">No projects yet.<br />Click + to add one.</div>
        )}
        <div className="project-add-buttons">
          <button className="add-project-btn" onClick={onOpenMakeProject} title="Create new project from scratch">+ make</button>
          <button className="add-project-btn" onClick={onAddProject} title="Add existing project folder">+ add</button>
        </div>
      </div>

      <BeadsPanel
        projectPath={beadsProjectPath}
        isExpanded={beadsExpanded}
        onToggle={() => setBeadsExpanded(!beadsExpanded)}
        onStartTaskInNewTab={(prompt) => {
          if (beadsProjectPath) onOpenSession(beadsProjectPath, undefined, undefined, prompt)
        }}
        onSendToCurrentTab={(prompt) => {
          if (focusedTabPtyId) {
            window.electronAPI.writePty(focusedTabPtyId, prompt)
            setTimeout(() => window.electronAPI.writePty(focusedTabPtyId, '\r'), 100)
          }
        }}
        currentTabPtyId={focusedTabPtyId}
      />

      {voiceOutputEnabled && (
        <div className="voice-options">
          <div className="voice-slider-row">
            <span className="voice-option-icon" title="Volume">🔊</span>
            <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="voice-slider" />
            <span className="voice-slider-value">{Math.round(volume * 100)}%</span>
          </div>
          <div className="voice-slider-row">
            <span className="voice-option-icon" title="Speed">⏩</span>
            <input type="range" min="0.5" max="2" step="0.1" value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} className="voice-slider" />
            <span className="voice-slider-value">{speed.toFixed(1)}x</span>
          </div>
          <label className="voice-option-checkbox" title="Skip to latest message instead of queuing">
            <input type="checkbox" checked={skipOnNew} onChange={(e) => setSkipOnNew(e.target.checked)} />
            <span>Skip to new</span>
          </label>
        </div>
      )}

      <div className="sidebar-actions">
        <VoiceControls
          activeTabId={activeTabId}
          onTranscription={(text) => {
            const currentTabId = activeTabIdRef.current
            if (currentTabId) {
              window.electronAPI.writePty(currentTabId, text)
              setTimeout(() => window.electronAPI.writePty(currentTabId, '\r'), 100)
            }
          }}
        />
        {(() => {
          const focusedProject = projects.find(p => p.path === focusedProjectPath)
          if (focusedProject) {
            const status = apiStatus[focusedProject.path]
            const hasPort = !!focusedProject.apiPort
            return (
              <button
                className={`action-icon-btn ${status?.running ? 'enabled' : ''}`}
                onClick={() => {
                  if (!hasPort) handleOpenProjectSettings(focusedProject)
                  else handleToggleApi(focusedProject)
                }}
                tabIndex={-1}
                title={status?.running ? `Stop API (port ${focusedProject.apiPort})` : hasPort ? `Start API (port ${focusedProject.apiPort})` : 'Configure API'}
              >
                {status?.running ? '🟢' : '🔌'}
              </button>
            )
          }
          return null
        })()}
        {isDebugMode && (
          <button className="action-icon-btn" onClick={() => window.electronAPI.refresh()} tabIndex={-1} title="Refresh (Debug Mode)">🔄</button>
        )}
        <button className="action-icon-btn" onClick={onOpenSettings} tabIndex={-1} title="Settings">⚙️</button>
      </div>
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
          onOpenSettings={() => handleOpenProjectSettings(contextMenu.project)}
          onOpenExtensions={() => {
            setExtensionBrowserModal({ project: contextMenu.project })
            setContextMenu(null)
          }}
          onEditClaudeMd={() => {
            setClaudeMdEditorModal({ project: contextMenu.project })
            setContextMenu(null)
          }}
          onUpdateColor={(color) => onUpdateProject(contextMenu.project.path, { color })}
          onMoveToCategory={(categoryId) => moveProjectToCategory(contextMenu.project.path, categoryId)}
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
          onChange={(updates) => setProjectSettingsModal(prev => prev ? { ...prev, ...updates } : null)}
          onToggleTool={(tool) => {
            if (!projectSettingsModal) return
            const newTools = projectSettingsModal.tools.includes(tool)
              ? projectSettingsModal.tools.filter(t => t !== tool)
              : [...projectSettingsModal.tools, tool]
            setProjectSettingsModal({ ...projectSettingsModal, tools: newTools })
          }}
          onAllowAll={() => {
            if (!projectSettingsModal) return
            const allTools = COMMON_TOOLS.map(t => t.value)
            setProjectSettingsModal({ ...projectSettingsModal, tools: allTools, permissionMode: 'bypassPermissions' })
          }}
          onClearAll={() => {
            if (!projectSettingsModal) return
            setProjectSettingsModal({ ...projectSettingsModal, tools: [], permissionMode: 'default' })
          }}
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
