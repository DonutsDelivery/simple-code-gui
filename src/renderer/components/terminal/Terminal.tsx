import React, { useEffect, useState, useCallback } from 'react'
import '@xterm/xterm/css/xterm.css'
import { TerminalBar } from '../TerminalBar.js'
import { AutoWorkOptions } from '../TerminalMenu.js'
import { CustomCommandModal } from '../CustomCommandModal.js'
import { resolveBackendCommand } from '../../utils/backendCommands.js'
import type { TerminalProps } from './types.js'
import { useTerminalSetup } from './useTerminalSetup.js'
import { useTTS } from './useTTS.js'
import { useAutoWork } from './useAutoWork.js'
import { useSummaryCapture } from './useSummaryCapture.js'
import { clearTerminalBuffer, cleanupOrphanedBuffers, formatPathsForBackend } from './utils.js'

// Re-export buffer utilities for external use
export { clearTerminalBuffer, cleanupOrphanedBuffers }

/**
 * Terminal component that wraps xterm.js with PTY integration.
 * Supports TTS, auto work loop, summary capture, and backend-specific commands.
 */
export function Terminal({ ptyId, isActive, theme, onFocus, projectPath, backend, api }: TerminalProps): React.ReactElement {
  // Custom command modal state
  const [showCustomCommandModal, setShowCustomCommandModal] = useState(false)

  // PTY write helper - uses api if provided, otherwise window.electronAPI
  const writePty = useCallback((id: string, data: string) => {
    if (api) {
      api.writePty(id, data)
    } else {
      window.electronAPI?.writePty(id, data)
    }
  }, [api])

  // Backend change handler
  const handleBackendChange = useCallback((newBackend: string) => {
    window.electronAPI?.setPtyBackend?.(ptyId, newBackend)
  }, [ptyId])

  // Send backend-specific command
  const sendBackendCommand = useCallback((commandId: string): boolean => {
    const backendCommand = resolveBackendCommand(backend, commandId)
    if (!backendCommand) {
      return false
    }
    writePty(ptyId, backendCommand)
    setTimeout(() => {
      writePty(ptyId, '\r')
    }, 100)
    return true
  }, [backend, ptyId, writePty])

  // TTS hook
  const {
    processTTSChunk,
    handleUserInput,
    resetTTSState,
    prePopulateSpokenContent,
  } = useTTS({ ptyId, isActive })

  // Auto work hook (needs summary capture's triggerSummarize)
  // We'll wire it up after summary capture is created
  const autoWorkHookPlaceholder = useAutoWork({
    ptyId,
    sendBackendCommand,
    triggerSummarize: () => {}, // Will be replaced
  })

  // Summary capture hook
  const {
    processSummaryChunk,
    triggerSummarize,
  } = useSummaryCapture({
    ptyId,
    sendBackendCommand,
    autoWorkWithSummary: autoWorkHookPlaceholder.autoWorkState.withSummary,
    buildAutoWorkPrompt: autoWorkHookPlaceholder.buildAutoWorkPrompt,
  })

  // Reconnect auto work with actual triggerSummarize
  const {
    autoWorkState,
    awaitingUserReview,
    handleAutoWorkMarker,
    startAutoWork,
    continueAutoWork,
    stopAutoWork,
    cancelAutoWork,
  } = useAutoWork({
    ptyId,
    sendBackendCommand,
    triggerSummarize,
  })

  // Terminal setup hook
  const {
    containerRef,
    terminalRef,
    fitAddonRef,
    userScrolledUpRef,
  } = useTerminalSetup({
    ptyId,
    theme,
    backend,
    api,
    onTTSChunk: processTTSChunk,
    onUserInput: handleUserInput,
    onSummaryChunk: processSummaryChunk,
    onAutoWorkMarker: handleAutoWorkMarker,
    prePopulateSpokenContent,
    resetTTSState,
  })

  // Refit when tab becomes active
  useEffect(() => {
    if (isActive && fitAddonRef.current && containerRef.current && terminalRef.current) {
      const doFit = () => {
        if (!fitAddonRef.current || !containerRef.current || !terminalRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        if (rect.width > 50 && rect.height > 50) {
          const wasAtBottom = !userScrolledUpRef.current

          fitAddonRef.current.fit()
          const dims = fitAddonRef.current.proposeDimensions()
          if (dims && dims.cols > 0 && dims.rows > 0) {
            window.electronAPI?.resizePty(ptyId, dims.cols, dims.rows)
          }
          if (wasAtBottom) {
            requestAnimationFrame(() => {
              terminalRef.current?.scrollToBottom()
            })
          }
        }
        terminalRef.current?.focus()
      }

      requestAnimationFrame(doFit)
      setTimeout(doFit, 50)
      setTimeout(doFit, 150)
    }
  }, [isActive, ptyId, containerRef, terminalRef, fitAddonRef, userScrolledUpRef])

  // Update terminal theme when theme changes
  useEffect(() => {
    if (terminalRef.current) {
      const t = theme.terminal
      terminalRef.current.options.theme = {
        background: t.background,
        foreground: t.foreground,
        cursor: t.cursor,
        cursorAccent: t.cursorAccent,
        selectionBackground: t.selection,
        black: t.black,
        red: t.red,
        green: t.green,
        yellow: t.yellow,
        blue: t.blue,
        magenta: t.magenta,
        cyan: t.cyan,
        white: t.white,
        brightBlack: t.brightBlack,
        brightRed: t.brightRed,
        brightGreen: t.brightGreen,
        brightYellow: t.brightYellow,
        brightBlue: t.brightBlue,
        brightMagenta: t.brightMagenta,
        brightCyan: t.brightCyan,
        brightWhite: t.brightWhite,
      }
    }
  }, [theme, terminalRef])

  // Handle file drop from file manager
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const paths: string[] = []

    // Try Files array first (KDE Dolphin uses this)
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        try {
          const filePath = window.electronAPI?.getPathForFile(files[i])
          if (filePath) {
            paths.push(filePath)
          }
        } catch {
          // getPathForFile not available
        }
      }
    }

    // Fallback: text/uri-list
    if (paths.length === 0) {
      const uriList = e.dataTransfer?.getData('text/uri-list')
      if (uriList) {
        uriList.split('\n')
          .map(uri => uri.trim())
          .filter(uri => uri.startsWith('file://'))
          .forEach(uri => {
            paths.push(decodeURIComponent(uri.replace('file://', '')))
          })
      }
    }

    if (paths.length > 0) {
      window.electronAPI?.writePty(ptyId, formatPathsForBackend(paths, backend))
    }
  }, [ptyId, backend])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  // Handle menu commands
  const handleMenuCommand = useCallback((command: string, options?: AutoWorkOptions) => {
    if (sendBackendCommand(command)) {
      return
    }

    switch (command) {
      case 'summarize':
        triggerSummarize()
        break

      case 'autowork':
        startAutoWork(options)
        break

      case 'continuework':
        continueAutoWork()
        break

      case 'stopwork':
        stopAutoWork()
        break

      case 'cancel':
        cancelAutoWork()
        break

      case 'addcommand':
        setShowCustomCommandModal(true)
        break
    }
  }, [sendBackendCommand, triggerSummarize, startAutoWork, continueAutoWork, stopAutoWork, cancelAutoWork])

  return (
    <div className="terminal-content-wrapper">
      <div
        ref={containerRef}
        className="terminal-xterm"
        onMouseDown={onFocus}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      />
      <TerminalBar
        ptyId={ptyId}
        onCommand={handleMenuCommand}
        currentBackend={backend || 'claude'}
        onBackendChange={handleBackendChange}
      />
      <CustomCommandModal
        isOpen={showCustomCommandModal}
        onClose={() => setShowCustomCommandModal(false)}
        projectPath={projectPath || null}
      />
    </div>
  )
}
