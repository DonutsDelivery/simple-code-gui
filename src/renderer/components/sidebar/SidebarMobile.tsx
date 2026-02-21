import React from 'react'
import { Project } from '../../stores/workspace.js'
import { SidebarContent, SidebarContentProps } from './SidebarContent.js'
import { SidebarState } from './useSidebarState.js'
import { SidebarHandlers } from './useSidebarHandlers.js'

export interface SidebarMobileProps extends Omit<SidebarContentProps, 'state' | 'handlers'> {
  state: SidebarState
  handlers: SidebarHandlers
  isMobileOpen: boolean | undefined
  onMobileClose: (() => void) | undefined
  onDisconnect: (() => void) | undefined
}

export function SidebarMobile(props: SidebarMobileProps): React.ReactElement {
  const { state, handlers, isMobileOpen, onMobileClose, onDisconnect, ...contentProps } = props
  const { sidebarRef } = state
  const { handleAddCategory, handleBackdropClick } = handlers

  const sidebarClasses = `sidebar ${isMobileOpen ? 'mobile-drawer-open' : ''}`

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className={`mobile-drawer-backdrop ${isMobileOpen ? 'visible' : ''}`}
        onClick={handleBackdropClick}
      />

      {/* Sidebar drawer */}
      <div className={sidebarClasses} ref={sidebarRef}>
        {/* Close button for mobile drawer */}
        <button
          className="mobile-drawer-close"
          onClick={onMobileClose}
          title="Close sidebar"
          aria-label="Close sidebar"
        >
          ✕
        </button>

        <SidebarContent state={state} handlers={handlers} {...contentProps} />

        {/* Disconnect button for mobile */}
        {onDisconnect && (
          <div className="sidebar-disconnect">
            <button
              className="disconnect-btn"
              onClick={onDisconnect}
              title="Disconnect from desktop"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    </>
  )
}
