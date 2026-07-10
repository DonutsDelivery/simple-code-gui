import React, { useEffect, useState, useCallback, useRef } from 'react'
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
export function Terminal({ ptyId, isActive, theme, onFocus, projectPath, backend, api, isMobile, onOpenFileBrowser }: TerminalProps): React.ReactElement {
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
  const handleBackendChange = useCallback((newBackend: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok') => {
    if (newBackend === 'default') return
    api?.setPtyBackend?.(ptyId, newBackend)
    window.electronAPI?.setPtyBackend?.(ptyId, newBackend)
  }, [api, ptyId])

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
    currentLineInputRef,
    inputSuppressedRef,
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

          // Force repaint on reactivation (fixes grey frame from WebGL
          // context loss when the terminal was hidden via display:none)
          terminalRef.current.refresh(0, terminalRef.current.rows - 1)

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

      // OpenCode runs a full-screen alternate-buffer TUI that only repaints
      // on a real SIGWINCH. Hermes is intentionally excluded: its initial
      // screen is actively streamed, and an extra resize during that paint can
      // leave cursor-addressed cells scattered across the viewport.
      if (backend === 'opencode') {
        setTimeout(() => {
          if (!fitAddonRef.current || !terminalRef.current) return
          fitAddonRef.current.fit()
          const dims = fitAddonRef.current.proposeDimensions()
          if (dims && dims.cols > 0 && dims.rows > 1) {
            terminalRef.current.resize(dims.cols, dims.rows - 1)
            window.electronAPI?.resizePty(ptyId, dims.cols, dims.rows - 1)
            terminalRef.current.refresh(0, terminalRef.current.rows - 1)
            setTimeout(() => {
              if (!terminalRef.current) return
              terminalRef.current.resize(dims.cols, dims.rows)
              window.electronAPI?.resizePty(ptyId, dims.cols, dims.rows)
              terminalRef.current.refresh(0, terminalRef.current.rows - 1)
            }, 150)
          }
        }, 200)
      }
    }
  }, [isActive, ptyId, backend, containerRef, terminalRef, fitAddonRef, userScrolledUpRef])

  // Allow keyboard tile-focus navigation to move xterm focus to this terminal
  useEffect(() => {
    const onFocusEvent = (e: Event) => {
      if ((e as CustomEvent).detail?.ptyId === ptyId) {
        terminalRef.current?.focus()
      }
    }
    window.addEventListener('ct-focus-terminal', onFocusEvent)
    return () => window.removeEventListener('ct-focus-terminal', onFocusEvent)
  }, [ptyId, terminalRef])

  // Check if a drag event is a tile/sidebar/sub-tab drag (not a file drop)
  const isTileDrag = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer.types
    return types.includes('application/x-sidebar-project') ||
           types.includes('application/x-subtab') ||
           // text/plain without Files = tile drag; text/plain with Files = file manager drag
           (types.includes('text/plain') && !types.includes('Files') && !types.includes('text/uri-list'))
  }, [])

  // Handle file drop from file manager (let tile/sidebar drags pass through to parent handlers)
  const handleDrop = useCallback((e: React.DragEvent) => {
    if (isTileDrag(e)) return // Let tile/sidebar drags bubble to tiled view handlers

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
  }, [ptyId, backend, isTileDrag])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (isTileDrag(e)) return // Let tile/sidebar drags bubble to tiled view handlers

    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [isTileDrag])

  // Track if a clear/compact operation is in progress to prevent double-triggering
  const clearInProgressRef = useRef(false)

  // Special handlers for /clear and /compact that preserve user input
  const handleClearWithRestore = useCallback(() => {
    // Debounce: prevent multiple rapid triggers
    if (clearInProgressRef.current) return
    clearInProgressRef.current = true

    const savedInput = currentLineInputRef.current

    // Suppress user keyboard input to prevent race conditions
    inputSuppressedRef.current = true

    // Send Ctrl+C to cancel any input (works for multiline too).
    // Skip for backends that don't handle SIGINT gracefully (e.g. OpenCode exits on Ctrl+C).
    const skipCtrlC = backend === 'opencode'
    if (!skipCtrlC) {
      writePty(ptyId, '\x03')
    }
    currentLineInputRef.current = ''

    // Send /clear command
    const backendCommand = resolveBackendCommand(backend, 'clear')
    if (backendCommand) {
      setTimeout(() => {
        writePty(ptyId, backendCommand)
        setTimeout(() => {
          writePty(ptyId, '\r')
          // Restore input after command processes
          if (savedInput) {
            setTimeout(() => {
              writePty(ptyId, savedInput)
              currentLineInputRef.current = savedInput
              // Re-enable input and allow next operation
              setTimeout(() => {
                inputSuppressedRef.current = false
                clearInProgressRef.current = false
              }, 100)
            }, skipCtrlC ? 200 : 500) // Shorter wait without Ctrl+C
          } else {
            setTimeout(() => {
              inputSuppressedRef.current = false
              clearInProgressRef.current = false
            }, skipCtrlC ? 200 : 500)
          }
        }, 100)
      }, skipCtrlC ? 100 : 300) // Shorter delay without Ctrl+C
    } else {
      inputSuppressedRef.current = false
      clearInProgressRef.current = false
    }
  }, [backend, ptyId, writePty, currentLineInputRef, inputSuppressedRef])

  const handleCompactWithRestore = useCallback(() => {
    // Debounce: prevent multiple rapid triggers
    if (clearInProgressRef.current) return
    clearInProgressRef.current = true

    const savedInput = currentLineInputRef.current

    // Suppress user keyboard input to prevent race conditions
    inputSuppressedRef.current = true

    // Send Ctrl+C to cancel any input (works for multiline too).
    // Skip for backends that don't handle SIGINT gracefully (e.g. OpenCode exits on Ctrl+C).
    const skipCtrlC = backend === 'opencode'
    if (!skipCtrlC) {
      writePty(ptyId, '\x03')
    }
    currentLineInputRef.current = ''

    // Send /compact command
    const backendCommand = resolveBackendCommand(backend, 'compact')
    if (backendCommand) {
      setTimeout(() => {
        writePty(ptyId, backendCommand)
        setTimeout(() => {
          writePty(ptyId, '\r')
          // Restore input after command processes
          if (savedInput) {
            setTimeout(() => {
              writePty(ptyId, savedInput)
              currentLineInputRef.current = savedInput
              // Re-enable input and allow next operation
              setTimeout(() => {
                inputSuppressedRef.current = false
                clearInProgressRef.current = false
              }, 100)
            }, skipCtrlC ? 200 : 500) // Shorter wait without Ctrl+C
          } else {
            setTimeout(() => {
              inputSuppressedRef.current = false
              clearInProgressRef.current = false
            }, skipCtrlC ? 200 : 500)
          }
        }, 100)
      }, skipCtrlC ? 100 : 300) // Shorter delay without Ctrl+C
    } else {
      inputSuppressedRef.current = false
      clearInProgressRef.current = false
    }
  }, [backend, ptyId, writePty, currentLineInputRef, inputSuppressedRef])

  // Handle menu commands
  const handleMenuCommand = useCallback((command: string, options?: AutoWorkOptions) => {
    // Route clear/compact to special handlers that preserve user input
    if (command === 'clear') {
      handleClearWithRestore()
      return
    }
    if (command === 'compact') {
      handleCompactWithRestore()
      return
    }

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
  }, [sendBackendCommand, triggerSummarize, startAutoWork, continueAutoWork, stopAutoWork, cancelAutoWork, handleClearWithRestore, handleCompactWithRestore])

  return (
    <div className="terminal-content-wrapper">
      <div
        ref={containerRef}
        className="terminal-xterm"
        onMouseDown={onFocus}
        onClick={() => {
          // Focus terminal on click (important for mobile touch)
          terminalRef.current?.focus()
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      />
      <TerminalBar
        ptyId={ptyId}
        onCommand={handleMenuCommand}
        onInput={(data) => writePty(ptyId, data)}
        currentBackend={(backend || 'claude') as 'default' | 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok'}
        onBackendChange={handleBackendChange}
        isMobile={isMobile}
        onOpenFileBrowser={onOpenFileBrowser}
        onClearWithRestore={handleClearWithRestore}
        onCompactWithRestore={handleCompactWithRestore}
      />
      <CustomCommandModal
        isOpen={showCustomCommandModal}
        onClose={() => setShowCustomCommandModal(false)}
        projectPath={projectPath || null}
      />
    </div>
  )
}
