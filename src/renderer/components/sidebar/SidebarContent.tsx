import React from 'react'
import { Project, useWorkspaceStore } from '../../stores/workspace.js'
import { BeadsPanel } from '../BeadsPanel.js'
import { GSDStatus } from '../GSDStatus.js'
import { ExtensionBrowser } from '../ExtensionBrowser.js'
import { ClaudeMdEditor } from '../ClaudeMdEditor.js'
import {
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
} from './index.js'
import { SidebarState } from './useSidebarState.js'
import { SidebarHandlers } from './useSidebarHandlers.js'
import { SidebarProps, OpenTab } from './types.js'

export interface SidebarContentProps {
  state: SidebarState
  handlers: SidebarHandlers
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
  onOpenSession: SidebarProps['onOpenSession']
  onRemoveProject: SidebarProps['onRemoveProject']
  onUpdateProject: SidebarProps['onUpdateProject']
  onAddProject: SidebarProps['onAddProject']
  onAddProjectsFromParent: SidebarProps['onAddProjectsFromParent']
  onOpenSettings: SidebarProps['onOpenSettings']
  onOpenMakeProject: SidebarProps['onOpenMakeProject']
  onOpenMobileConnect: SidebarProps['onOpenMobileConnect']
  renderProjectItem: (project: Project) => React.ReactElement
}

export function SidebarContent(props: SidebarContentProps): React.ReactElement {
  const {
    state,
    handlers,
    projects,
    activeTabId,
    onOpenSession,
    onRemoveProject,
    onUpdateProject,
    onAddProject,
    onAddProjectsFromParent,
    onOpenSettings,
    onOpenMakeProject,
    onOpenMobileConnect,
    renderProjectItem,
  } = props

  const {
    // Voice options
    volume,
    setVolume,
    speed,
    setSpeed,
    skipOnNew,
    setSkipOnNew,
    voiceOutputEnabled,

    // State
    sortedCategories,
    projectsByCategory,
    expandedProject,
    sessions,
    dropTarget,
    draggedCategory,
    draggedProject,
    editingCategory,
    categoryEditInputRef,
    contextMenu,
    setContextMenu,
    categoryContextMenu,
    setCategoryContextMenu,
    deleteConfirmModal,
    setDeleteConfirmModal,
    projectSettingsModal,
    setProjectSettingsModal,
    extensionBrowserModal,
    setExtensionBrowserModal,
    claudeMdEditorModal,
    setClaudeMdEditorModal,
    beadsExpanded,
    setBeadsExpanded,
    beadsProjectPath,
    focusedTabPtyId,
    focusedProject,
    focusedProjectPath,
    apiStatus,
    isDebugMode,
    categories,
    addCategory,
    moveProjectToCategory,
    removeCategory,
    globalPermissions,
    globalVoiceSettings,
    installedVoices,
    handleOpenProjectSettings,
    handleSaveProjectSettings,
    handleProjectSettingsChange,
    handleToggleTool,
    handleAllowAll,
    handleClearAll,
    handleToggleApi,
    handleCategoryDragStart,
    handleCategoryDragEnd,
    handleCategoryHeaderDragOver,
    handleCategoryDragOver,
    handleCategoryHeaderDrop,
    handleCategoryDrop,
    setEditingCategory,
  } = state

  const {
    handleAddCategory,
    handleOpenAllProjects,
    handleOpenCategoryAsProject,
    handleStartCategoryRename,
    handleCategoryRenameSubmit,
    handleCategoryRenameKeyDown,
    toggleCategoryCollapse,
    handleRunExecutable,
    handleSelectExecutable,
    handleClearExecutable,
  } = handlers

  return (
    <>
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
        {/* All Projects meta-entry at top */}
        <div
          className="meta-project-header"
          role="button"
          tabIndex={0}
          onClick={handleOpenAllProjects}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleOpenAllProjects()
            }
          }}
        >
          <span className="meta-project-icon">⚡</span>
          <span className="meta-project-name">All Projects</span>
        </div>

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
                onOpenAsProject={() => handleOpenCategoryAsProject(category.name)}
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
          <button
            className="add-project-btn"
            onClick={onAddProject}
            title="Add existing project folder"
          >
            + add
          </button>
          <button
            className="add-project-btn"
            onClick={onAddProjectsFromParent}
            title="Add all projects from a parent folder"
          >
            + folder
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
            window.electronAPI?.writePty(focusedTabPtyId, prompt)
            setTimeout(() => window.electronAPI?.writePty(focusedTabPtyId, '\r'), 100)
          }
        }}
        currentTabPtyId={focusedTabPtyId}
      />

      <GSDStatus
        projectPath={beadsProjectPath}
        onCommand={(cmd) => {
          if (focusedTabPtyId) {
            window.electronAPI?.writePty(focusedTabPtyId, cmd)
            setTimeout(() => window.electronAPI?.writePty(focusedTabPtyId, '\r'), 100)
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
        onOpenMobileConnect={onOpenMobileConnect}
      />

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
    </>
  )
}
