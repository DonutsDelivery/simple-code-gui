import React, { useCallback, useMemo } from 'react'
import { Project } from '../../stores/workspace.js'
import { useIsMobile } from '../../hooks/useIsMobile.js'
import { SidebarProps } from './types.js'
import { ProjectItem } from './ProjectItem.js'
import { useSidebarState } from './useSidebarState.js'
import { useSidebarEffects } from './useSidebarEffects.js'
import { useSidebarHandlers } from './useSidebarHandlers.js'
import { useProjectItemCallbacks, useProjectItemDependencies } from './useProjectItemCallbacks.js'
import { SidebarMobile } from './SidebarMobile.js'
import { SidebarDesktop, SidebarCollapsed } from './SidebarDesktop.js'

export function Sidebar({
  projects,
  openTabs,
  activeTabId,
  lastFocusedTabId,
  onAddProject,
  onAddProjectsFromParent,
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
  isMobileOpen,
  onMobileClose,
  onOpenMobileConnect,
  onDisconnect,
}: SidebarProps): React.ReactElement | null {
  // Mobile detection
  const { isMobile } = useIsMobile()

  // Initialize state
  const state = useSidebarState({
    projects,
    openTabs,
    activeTabId,
    lastFocusedTabId,
    onOpenSession,
    onSwitchToTab,
    onUpdateProject,
  })

  // Initialize effects
  useSidebarEffects({
    state,
    projects,
    isMobile,
    isMobileOpen,
    onMobileClose,
    onWidthChange,
  })

  // Initialize handlers
  const handlers = useSidebarHandlers({
    state,
    onUpdateProject,
    onOpenSession,
    isMobile,
    onMobileClose,
  })

  // Initialize project item callbacks
  const callbacks = useProjectItemCallbacks({
    state,
    handlers,
    projects,
    openTabs,
    onCloseProjectTabs,
  })

  // Get dependencies for renderProjectItem memoization
  const projectItemDeps = useProjectItemDependencies(state, callbacks, handlers, openTabs)

  // Render project item - memoized with all dependencies
  const renderProjectItem = useCallback(
    (project: Project) => (
      <ProjectItem
        key={project.path}
        project={project}
        isExpanded={state.expandedProject === project.path}
        isFocused={state.focusedProjectPath === project.path}
        hasOpenTab={openTabs.some((t) => t.projectPath === project.path)}
        isDragging={state.draggedProject === project.path}
        isEditing={state.editingProject?.path === project.path}
        editingName={state.editingProject?.path === project.path ? state.editingProject.name : ''}
        sessions={state.sessions[project.path] || []}
        taskCounts={state.taskCounts[project.path]}
        dropTarget={state.dropTarget}
        editInputRef={state.editInputRef}
        onToggleExpand={(e) => callbacks.handleProjectToggleExpand(e, project.path)}
        onOpenSession={(sessionId, slug, isNewSession) =>
          callbacks.handleProjectOpenSession(project.path, sessionId, slug, isNewSession)
        }
        onRunExecutable={() => callbacks.handleProjectRunExecutable(project.path)}
        onCloseProjectTabs={() => callbacks.handleProjectCloseProjectTabs(project.path)}
        onContextMenu={(e) => callbacks.handleProjectContextMenu(e, project)}
        onDragStart={(e) => callbacks.handleProjectItemDragStart(e, project.path)}
        onDragEnd={state.handleProjectDragEnd}
        onDragOver={(e) => callbacks.handleProjectItemDragOver(e, project.path)}
        onDrop={(e) => callbacks.handleProjectItemDrop(e, project.path, project.categoryId)}
        onStartRename={(e) => callbacks.handleProjectStartRename(e, project)}
        onEditingChange={callbacks.handleProjectEditingChange}
        onRenameSubmit={handlers.handleRenameSubmit}
        onRenameKeyDown={handlers.handleRenameKeyDown}
      />
    ),
    projectItemDeps
  )

  // Common content props
  const contentProps = {
    projects,
    openTabs,
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
  }

  // On mobile, don't render collapsed state - use drawer instead
  if (collapsed && !isMobile) {
    return <SidebarCollapsed sidebarRef={state.sidebarRef} onCollapsedChange={onCollapsedChange} />
  }

  // Mobile: render backdrop + drawer
  if (isMobile) {
    return (
      <SidebarMobile
        state={state}
        handlers={handlers}
        isMobileOpen={isMobileOpen}
        onMobileClose={onMobileClose}
        onDisconnect={onDisconnect}
        {...contentProps}
      />
    )
  }

  // Desktop: render standard sidebar
  return (
    <SidebarDesktop
      state={state}
      handlers={handlers}
      width={width}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      {...contentProps}
    />
  )
}

export default Sidebar
